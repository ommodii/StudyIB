from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any


DEFAULT_VERSION = "2026-09-19-new-papers-v1"
LANGUAGE_RE = re.compile(r"(?:^|[_\s\[])(french|spanish|german)(?:[_\s.\]]|$)", re.I)
PAPER_RE = re.compile(r"paper[_\s-]*(\d+[A-Z]?)", re.I)
ZONE_RE = re.compile(r"(?:TZ|zone[_\s-]*)([0-9A-C])", re.I)
SESSION_PATTERNS = (
    re.compile(r"(20\d{2})\s+(May|November)\s+Examination Session", re.I),
    re.compile(r"(May|November)\s+(20\d{2})\s+Examination Session", re.I),
)

SUBJECTS = {
    "physics": {
        "label": "Physics HL",
        "pattern": re.compile(r"^physics[_\s-]", re.I),
        "pipeline_subject": "physics",
        "course": None,
    },
    "chemistry": {
        "label": "Chemistry HL",
        "pattern": re.compile(r"^chemistry[_\s-]", re.I),
        "pipeline_subject": "chemistry",
        "course": None,
    },
    "biology": {
        "label": "Biology HL",
        "pattern": re.compile(r"^biology[_\s-]", re.I),
        "pipeline_subject": "biology",
        "course": None,
    },
    "math": {
        "label": "Mathematics AA HL",
        "pattern": re.compile(r"^mathematics[_\s-]+analysis[_\s-]+and[_\s-]+approaches[_\s-]", re.I),
        "pipeline_subject": "mathematics",
        "course": "aa",
    },
    "math_ai": {
        "label": "Mathematics AI HL",
        "pattern": re.compile(r"^mathematics[_\s-]+applications[_\s-]+and[_\s-]+interpretation[_\s-]", re.I),
        "pipeline_subject": "mathematics",
        "course": "ai",
    },
    "economics": {
        "label": "Economics HL",
        "pattern": re.compile(r"^economics[_\s-]", re.I),
        "pipeline_subject": "economics",
        "course": None,
    },
    "business": {
        "label": "Business Management HL",
        "pattern": re.compile(r"^business[_\s-]+management[_\s-]", re.I),
        "pipeline_subject": "business",
        "course": None,
    },
    "computer_science": {
        "label": "Computer Science HL",
        "pattern": re.compile(r"^computer[_\s-]+science[_\s-]", re.I),
        "pipeline_subject": "computer_science",
        "course": None,
    },
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def slug(value: str) -> str:
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9.]+", "-", value.lower()))


def session_for(path: Path) -> tuple[int, str] | None:
    for part in reversed(path.parts):
        first = SESSION_PATTERNS[0].search(part)
        if first:
            return int(first.group(1)), first.group(2).title()
        second = SESSION_PATTERNS[1].search(part)
        if second:
            return int(second.group(2)), second.group(1).title()
    return None


def subject_for(filename: str) -> str | None:
    for subject, config in SUBJECTS.items():
        if config["pattern"].search(filename):
            return subject
    return None


def is_canonical(path: Path) -> bool:
    lowered_parts = [part.lower() for part in path.parts]
    return not any("donated papers" in part or part == "html" for part in lowered_parts)


def is_english_hl_resource(path: Path) -> bool:
    name = path.name
    lowered = name.lower()
    if LANGUAGE_RE.search(name):
        return False
    if "paper" not in lowered:
        return False
    return bool(re.search(r"(?:^|[_\s])(HL|HLSL|SLHL)(?:[_\s.]|$)", name, re.I))


def resource_role(path: Path) -> str:
    lowered = path.name.lower()
    if "markscheme" in lowered or "mark_scheme" in lowered:
        return "markscheme"
    if "case_study" in lowered:
        return "case_study"
    return "question_paper"


def pairing_stem(path: Path) -> str:
    stem = path.stem.lower()
    stem = re.sub(r"_?mark_?scheme$", "", stem)
    stem = re.sub(r"_?markscheme$", "", stem)
    return stem


def paper_label(path: Path) -> str:
    role = resource_role(path)
    if role == "case_study":
        return "Paper 3 Case Study"
    paper = PAPER_RE.search(path.name)
    paper_id = paper.group(1).upper() if paper else "Unknown"
    zone = ZONE_RE.search(path.name)
    zone_label = f" · TZ{zone.group(1).upper()}" if zone else ""
    return f"Paper {paper_id} HL{zone_label}"


def link_or_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def object_key(version: str, subject: str, year: int, session: str, filename: str) -> str:
    return f"Content/CurriculumPapers/{version}/{subject}/{year}/{session.lower()}/{slug(filename)}"


def build(source_root: Path, output_root: Path, version: str) -> dict[str, Any]:
    if not source_root.exists():
        raise FileNotFoundError(f"New-paper source not found: {source_root}")

    stage_root = output_root / "staged"
    web_root = output_root / "web"
    if output_root.exists():
        shutil.rmtree(output_root)
    stage_root.mkdir(parents=True)
    web_root.mkdir(parents=True)

    candidates: list[dict[str, Any]] = []
    excluded = defaultdict(int)
    seen_hashes: dict[tuple[str, str], Path] = {}

    for path in sorted(source_root.rglob("*.pdf"), key=lambda item: item.as_posix().lower()):
        subject = subject_for(path.name)
        if not subject:
            excluded["other_subject"] += 1
            continue
        if not is_canonical(path):
            excluded["duplicate_source_tree"] += 1
            continue
        session = session_for(path)
        if not session:
            excluded["unknown_session"] += 1
            continue
        if not is_english_hl_resource(path):
            excluded["non_english_or_non_hl"] += 1
            continue
        year, session_name = session
        digest = sha256_file(path)
        duplicate_key = (subject, digest)
        if duplicate_key in seen_hashes:
            excluded["exact_duplicate"] += 1
            continue
        seen_hashes[duplicate_key] = path
        staged = stage_root / subject / f"{year} {session_name} Examination Session" / path.name
        link_or_copy(path, staged)
        candidates.append({
            "subject": subject,
            "year": year,
            "session": session_name,
            "role": resource_role(path),
            "source_path": str(path.resolve()),
            "local_path": str(staged.resolve()),
            "filename": path.name,
            "sha256": digest,
            "size": path.stat().st_size,
        })

    by_pair = {
        (item["subject"], item["year"], item["session"], pairing_stem(Path(item["filename"]))): item
        for item in candidates
        if item["role"] == "markscheme"
    }
    paper_data: dict[str, dict[str, dict[str, list[dict[str, Any]]]]] = {
        subject: {} for subject in SUBJECTS
    }
    unmatched: list[str] = []

    for item in candidates:
        if item["role"] == "markscheme":
            continue
        subject = item["subject"]
        year = item["year"]
        session_name = item["session"]
        paper_path = Path(item["local_path"])
        markscheme = None
        if item["role"] == "question_paper":
            markscheme = by_pair.get((subject, year, session_name, pairing_stem(paper_path)))
            if not markscheme:
                unmatched.append(str(paper_path.relative_to(stage_root)))
        entry = {
            "name": paper_label(paper_path),
            "qp_path": object_key(version, subject, year, session_name, item["filename"]),
            "ms_path": (
                object_key(version, subject, year, session_name, markscheme["filename"])
                if markscheme else None
            ),
            "resource_type": item["role"],
        }
        paper_data[subject].setdefault(str(year), {}).setdefault(session_name, []).append(entry)

    for years in paper_data.values():
        for sessions in years.values():
            for entries in sessions.values():
                entries.sort(key=lambda entry: entry["name"])

    upload_files = []
    for item in candidates:
        upload_files.append({
            "local_path": item["local_path"],
            "object_key": object_key(
                version, item["subject"], item["year"], item["session"], item["filename"]
            ),
            "size": item["size"],
            "sha256": item["sha256"],
            "content_type": "application/pdf",
        })
    upload_files.sort(key=lambda item: item["object_key"])
    if len({item["object_key"] for item in upload_files}) != len(upload_files):
        raise RuntimeError("Duplicate R2 object keys detected")

    subject_audit = {}
    for subject, config in SUBJECTS.items():
        subject_items = [item for item in candidates if item["subject"] == subject]
        entries = sum(
            len(items)
            for sessions in paper_data[subject].values()
            for items in sessions.values()
        )
        subject_audit[subject] = {
            "label": config["label"],
            "assets": len(subject_items),
            "question_papers": sum(item["role"] == "question_paper" for item in subject_items),
            "markschemes": sum(item["role"] == "markscheme" for item in subject_items),
            "case_studies": sum(item["role"] == "case_study" for item in subject_items),
            "website_entries": entries,
            "years": sorted({item["year"] for item in subject_items}),
        }

    metadata = {
        "version": version,
        "prefix": f"Content/CurriculumPapers/{version}",
        "policy": "Canonical archive only; English-language HL resources; donated and HTML-export duplicates excluded.",
        "subjects": subject_audit,
        "excluded": dict(excluded),
        "unmatched_question_papers": unmatched,
    }
    data_path = Path(__file__).resolve().parents[1] / "new_papers_data.js"
    data_path.write_text(
        "const newPaperMetadata = " + json.dumps(metadata, separators=(",", ":")) + ";\n"
        "const newPaperFullPapersData = " + json.dumps(paper_data, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    (web_root / "upload_manifest.json").write_text(json.dumps({
        "version": version,
        "prefix": metadata["prefix"],
        "bucket": "studyib-content",
        "object_count": len(upload_files),
        "total_bytes": sum(item["size"] for item in upload_files),
        "files": upload_files,
    }, indent=2), encoding="utf-8")
    (web_root / "audit.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    (output_root / "source_manifest.json").write_text(json.dumps({
        "version": version,
        "source_root": str(source_root.resolve()),
        "subjects": SUBJECTS,
        "files": candidates,
    }, indent=2, default=str), encoding="utf-8")
    return {
        **metadata,
        "object_count": len(upload_files),
        "total_bytes": sum(item["size"] for item in upload_files),
        "stage_root": str(stage_root.resolve()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare canonical new IB papers for StudyIB.")
    parser.add_argument("--source-root", type=Path, default=Path.home() / "Downloads" / "newpapers")
    parser.add_argument("--output-root", type=Path, default=Path("output/newpapers_2026-09-19"))
    parser.add_argument("--version", default=DEFAULT_VERSION)
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    output_root = args.output_root if args.output_root.is_absolute() else repo_root / args.output_root
    print(json.dumps(build(args.source_root.resolve(), output_root.resolve(), args.version), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
