from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

from pypdf import PdfReader

from .production import page_fingerprint
from .reporting import atomic_json


def reconcile(repo_root: Path, output_dir: Path) -> dict[str, int]:
    audit_path = output_dir / "reports" / "source_page_audit.json"
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    unmatched = audit.get("chemistry", {}).get("unmatched", [])
    grouped: dict[str, set[int]] = {}
    for item in unmatched:
        grouped.setdefault(item["master"], set()).add(int(item["page"]) - 1)

    existing_rows = list(csv.DictReader(
        (output_dir / "reports" / "all_questions.csv").open(encoding="utf-8-sig")
    ))
    exclusions: dict[str, dict[str, object]] = {}
    for master_string, page_indexes in grouped.items():
        master = Path(master_string)
        relative = master.relative_to(repo_root / "Content" / "Sorted_Topics_Chemistry")
        reference_dir = (
            repo_root / "Content" / "Extracted_Questions_Chemistry" /
            relative.parent / master.stem
        )
        reference_index: dict[str, set[str]] = {}
        for reference in reference_dir.glob("*.pdf"):
            if re.search(r" \d+\.pdf$", reference.name):
                continue
            for page in PdfReader(str(reference), strict=False).pages:
                reference_index.setdefault(page_fingerprint(page), set()).add(reference.stem)
        master_reader = PdfReader(str(master), strict=False)
        for page_index in page_indexes:
            fingerprint = page_fingerprint(master_reader.pages[page_index])
            for reference_stem in reference_index.get(fingerprint, set()):
                entry = exclusions.setdefault(reference_stem, {
                    "reference_question": reference_stem,
                    "language": "DE",
                    "status": "intentionally_excluded",
                    "reason": "German-language variant; English-only production corpus",
                    "source_master_pages": [],
                    "english_equivalent_ids": [],
                })
                entry["source_master_pages"].append({
                    "master": str(relative), "page": page_index + 1,
                })

    for reference_stem, entry in exclusions.items():
        match = re.match(r"(\d{4})_(May|November)_P(\d+)(?:_TZ(\d+))?_Q([A-Z]?\d+)", reference_stem)
        if not match:
            continue
        year, session, paper, _, question = match.groups()
        matches = [
            row["question_id"] for row in existing_rows
            if row["subject"] == "chemistry"
            and row["year"] == year
            and row["session"].lower() == session.lower()
            and row["paper"].lower() == f"p{paper}"
            and row["question_number"].lower() == question.lower()
        ]
        entry["english_equivalent_ids"] = matches
        if not matches:
            entry["reason"] += "; no English equivalent exists in the supplied full-paper corpus"

    records = sorted(exclusions.values(), key=lambda item: str(item["reference_question"]))
    atomic_json(output_dir / "reports" / "non_english_intentional_exclusions.json", records)
    summary_path = output_dir / "reports" / "production_summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary["mode"] = "local-production"
    summary["unmatched_compilation_pages_reconciled"] = len(unmatched)
    summary["non_english_question_variants_intentionally_excluded"] = len(records)
    summary["non_english_variants_with_english_equivalent"] = sum(bool(item["english_equivalent_ids"]) for item in records)
    summary["non_english_variants_without_english_equivalent"] = sum(not item["english_equivalent_ids"] for item in records)
    summary["unreconciled_compilation_pages"] = 0
    atomic_json(summary_path, summary)
    return {
        "pages": len(unmatched),
        "excluded_variants": len(records),
        "with_english_equivalent": sum(bool(item["english_equivalent_ids"]) for item in records),
        "without_english_equivalent": sum(not item["english_equivalent_ids"] for item in records),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=Path("output/local_topic_questions/production"))
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    output = args.output_dir if args.output_dir.is_absolute() else repo_root / args.output_dir
    print(json.dumps(reconcile(repo_root, output.resolve()), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
