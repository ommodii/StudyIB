from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from pathlib import Path

from pypdf import PdfReader

from .models import PaperRecord


SOURCE_ROOTS = {
    "physics": Path("Content/Exam_Papers/IB_Physics"),
    "chemistry": Path("Content/Exam_Papers/IB_Chemistry"),
    "biology": Path("Content/IB_Biology"),
    "mathematics": Path("Content/IB_Math"),
}

SESSION_RE = re.compile(r"(?P<year>\d{4})\s+(?P<session>May|November)\s+Examination\s+Session", re.I)
PAPER_RE = re.compile(r"(?:^|_)paper[_\s-]*(?P<paper>\d+|[A-Za-z]+)(?:_|\.|$)", re.I)
TZ_RE = re.compile(r"(?:^|[_\s-])TZ(?P<tz>\d+)(?:[_\s.-]|$)", re.I)
LEVEL_RE = re.compile(r"(?:^|[_\s-])(?P<level>HL|SL)(?:[_\s.-]|$)", re.I)
LANGUAGES = {"french": "FR", "spanish": "ES", "german": "DE"}


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def _session_metadata(path: Path) -> tuple[int | None, str]:
    for part in reversed(path.parts):
        match = SESSION_RE.search(part)
        if match:
            return int(match.group("year")), match.group("session").title()
    year_match = re.search(r"(?:19|20)\d{2}", path.name)
    year = int(year_match.group()) if year_match else None
    session_match = re.search(r"\b(May|November)\b", path.name, re.I)
    return year, session_match.group().title() if session_match else "UNKNOWN"


def _math_course(filename: str, year: int | None) -> str:
    lowered = filename.lower()
    if "analysis_and_approaches" in lowered or re.search(r"(?:^|_)aa(?:_|\.)", lowered):
        return "aa"
    if "applications_and_interpretation" in lowered or re.search(r"(?:^|_)ai(?:_|\.)", lowered):
        return "ai"
    # Pre-2021 Mathematics HL/SL predates AA/AI. It is intentionally not guessed.
    return "UNKNOWN"


def parse_paper_metadata(path: Path, subject: str) -> PaperRecord:
    filename = path.name
    lowered = filename.lower()
    year, session = _session_metadata(path)
    paper_match = PAPER_RE.search(filename)
    timezone_match = TZ_RE.search(filename)
    level_match = LEVEL_RE.search(filename)
    language = next((code for token, code in LANGUAGES.items() if token in lowered), "EN")
    role = "markscheme" if "markscheme" in lowered or "mark_scheme" in lowered else "question_paper"
    specimen = "specimen" in lowered or "sample" in lowered
    course = _math_course(filename, year) if subject == "mathematics" else "NONE"
    record = PaperRecord(
        source_path=str(path.resolve()),
        subject=subject,
        course=course,
        year=year,
        session=session,
        timezone=f"TZ{timezone_match.group('tz')}" if timezone_match else "UNKNOWN",
        level=level_match.group("level").upper() if level_match else "UNKNOWN",
        paper=f"P{paper_match.group('paper').upper()}" if paper_match else "UNKNOWN",
        role=role,
        language=language,
        specimen=specimen,
    )
    missing = [
        key for key, value in (("year", year), ("session", session), ("level", record.level), ("paper", record.paper))
        if value is None or value == "UNKNOWN"
    ]
    if subject == "mathematics" and course == "UNKNOWN":
        missing.append("course")
    if missing:
        record.reason = f"ambiguous metadata: {', '.join(missing)}"
    return record


def pairing_key(record: PaperRecord) -> tuple[str, ...]:
    name = Path(record.source_path).stem.lower()
    name = re.sub(r"_?mark_?scheme", "", name)
    name = re.sub(r"_?markscheme", "", name)
    return (record.subject, str(record.year), record.session, name)


def inventory_sources(
    repo_root: Path,
    subjects: list[str],
    source_dir: Path | None = None,
    hash_files: bool = True,
) -> list[PaperRecord]:
    records: list[PaperRecord] = []
    for subject in subjects:
        root = source_dir if source_dir is not None else repo_root / SOURCE_ROOTS[subject]
        if not root.exists():
            records.append(PaperRecord(
                source_path=str(root.resolve()), subject=subject, course="UNKNOWN", year=None,
                session="UNKNOWN", timezone="UNKNOWN", level="UNKNOWN", paper="UNKNOWN",
                role="missing_source", language="UNKNOWN", specimen=False,
                inventory_status="failed", reason="source directory not found",
            ))
            continue
        for path in sorted(root.rglob("*.pdf"), key=lambda item: item.as_posix().lower()):
            if any(part.lower().startswith("sorted_topics") for part in path.parts):
                continue
            record = parse_paper_metadata(path, subject)
            try:
                if hash_files:
                    record.file_hash = sha256_file(path)
                reader = PdfReader(str(path), strict=False)
                record.page_count = len(reader.pages)
                if reader.is_encrypted:
                    record.inventory_status = "failed"
                    record.reason = "encrypted PDF"
            except Exception as exc:  # inventory must retain corrupt files
                record.inventory_status = "failed"
                record.reason = f"PDF open failed: {type(exc).__name__}: {exc}"
            records.append(record)

    markschemes = {pairing_key(record): record for record in records if record.role == "markscheme"}
    for record in records:
        if record.role == "question_paper":
            match = markschemes.get(pairing_key(record))
            if match:
                record.paired_markscheme = match.source_path

    paired_markscheme_paths = {
        record.paired_markscheme for record in records if record.role == "question_paper" and record.paired_markscheme
    }
    for record in records:
        if record.role == "markscheme" and record.inventory_status == "discovered":
            record.inventory_status = "processed"
            record.reason = "paired to question paper" if record.source_path in paired_markscheme_paths else "unmatched markscheme"

    by_hash: dict[str, list[PaperRecord]] = defaultdict(list)
    for record in records:
        if record.file_hash:
            by_hash[record.file_hash].append(record)
    for duplicate_group in by_hash.values():
        if len(duplicate_group) < 2:
            continue
        retained = sorted(duplicate_group, key=lambda item: item.source_path.lower())[0]
        for duplicate in duplicate_group:
            if duplicate is retained:
                continue
            duplicate.inventory_status = "duplicated"
            duplicate.reason = f"exact source duplicate of {retained.source_path}"
    return records
