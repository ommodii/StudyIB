from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path

from .inventory import parse_paper_metadata
from .pdf_extract import extract_questions
from .reporting import atomic_json


def audit(inventory_csv: Path, cache_dir: Path, report_path: Path, threshold: float) -> dict[str, object]:
    rows = list(csv.DictReader(inventory_csv.open(encoding="utf-8-sig")))
    counts: Counter[str] = Counter()
    small_regions: list[dict[str, object]] = []
    failures: list[dict[str, str]] = []
    for row in rows:
        source = Path(row["source_path"])
        paper = parse_paper_metadata(source, row["subject"])
        questions, error = extract_questions(paper, report_path.parent / "_dry", cache_dir, dry_run=True)
        if error:
            failures.append({"source_path": str(source), "error": error})
            continue
        counts[row["subject"]] += len(questions)
        for question in questions:
            for region_number, region in enumerate(question.regions, 1):
                height = region.bottom - region.top
                if height < threshold:
                    small_regions.append({
                        "question_id": question.question_id,
                        "source_path": question.source_path,
                        "source_page": region.page_index + 1,
                        "region_number": region_number,
                        "height_points": round(height, 2),
                    })
    result = {
        "valid": not failures and not small_regions,
        "papers_audited": len(rows),
        "detected_questions_by_subject": dict(sorted(counts.items())),
        "small_region_threshold_points": threshold,
        "small_regions": small_regions,
        "failures": failures,
        "remote_operations": 0,
    }
    atomic_json(report_path, result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", type=Path, default=Path("output/local_topic_questions/production/reports/source_inventory.csv"))
    parser.add_argument("--cache-dir", type=Path, default=Path(".topic-papers-cache/production"))
    parser.add_argument("--report", type=Path, default=Path("output/local_topic_questions/production/reports/boundary_audit.json"))
    parser.add_argument("--minimum-height", type=float, default=40.0)
    args = parser.parse_args()
    result = audit(args.inventory.resolve(), args.cache_dir.resolve(), args.report.resolve(), args.minimum_height)
    print(json.dumps(result, indent=2))
    return 0 if result["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
