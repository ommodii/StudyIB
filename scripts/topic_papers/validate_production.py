from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from pypdf import PdfReader

from .pdf_extract import _page_content_bytes
from .reporting import atomic_json


def _stream_hash(page: Any) -> str:
    return hashlib.sha256(_page_content_bytes(page)).hexdigest()


def validate(output_dir: Path) -> dict[str, Any]:
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    questions_by_source: dict[str, list[tuple[dict[str, Any], Path]]] = defaultdict(list)
    topic_count = question_count = topic_page_count = 0

    for manifest_path in sorted(output_dir.rglob("manifest.json")):
        if "_raw" in manifest_path.parts:
            continue
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        questions = payload.get("questions", [])
        if not questions:
            continue
        topic_count += 1
        question_count += len(questions)
        master_path = manifest_path.parent / "master.pdf"
        try:
            master_pages = len(PdfReader(str(master_path), strict=False).pages)
        except Exception as exc:
            errors.append({"file": str(master_path), "error": f"master open failed: {exc}"})
            master_pages = -1
        expected_pages = sum(int(question.get("page_count", 0)) for question in questions)
        topic_page_count += max(master_pages, 0)
        if master_pages != expected_pages:
            errors.append({"file": str(master_path), "error": f"master page count {master_pages} != {expected_pages}"})
        for question in questions:
            topic_copy = manifest_path.parent / "questions" / f'{question["question_id"]}.pdf'
            raw_path = Path(question["output_path"])
            if not raw_path.exists() or not topic_copy.exists():
                errors.append({"question_id": question["question_id"], "error": "raw or topic PDF missing"})
                continue
            if hashlib.sha256(raw_path.read_bytes()).digest() != hashlib.sha256(topic_copy.read_bytes()).digest():
                errors.append({"question_id": question["question_id"], "error": "topic PDF differs from raw slice"})
            questions_by_source[question["source_path"]].append((question, raw_path))

    validated_pages = 0
    minimum_crop_height = float("inf")
    for source_string, items in sorted(questions_by_source.items()):
        source_path = Path(source_string)
        try:
            source_reader = PdfReader(str(source_path), strict=False)
        except Exception as exc:
            errors.append({"file": source_string, "error": f"source open failed: {exc}"})
            continue
        source_hashes: dict[int, str] = {}
        for question, raw_path in items:
            try:
                slice_reader = PdfReader(str(raw_path), strict=False)
            except Exception as exc:
                errors.append({"question_id": question["question_id"], "error": f"slice open failed: {exc}"})
                continue
            regions = question.get("regions", [])
            if len(slice_reader.pages) != len(regions) or len(slice_reader.pages) != int(question.get("page_count", 0)):
                errors.append({"question_id": question["question_id"], "error": "slice/region page-count mismatch"})
                continue
            for output_page, region in zip(slice_reader.pages, regions):
                page_index = int(region["page_index"])
                if page_index >= len(source_reader.pages):
                    errors.append({"question_id": question["question_id"], "error": f"source page {page_index + 1} out of range"})
                    continue
                source_hash = source_hashes.setdefault(page_index, _stream_hash(source_reader.pages[page_index]))
                if _stream_hash(output_page) != source_hash:
                    errors.append({"question_id": question["question_id"], "error": f"content stream differs on source page {page_index + 1}"})
                crop_height = float(output_page.mediabox.height)
                minimum_crop_height = min(minimum_crop_height, crop_height)
                if crop_height < 40:
                    warnings.append({"question_id": question["question_id"], "warning": f"very small crop height {crop_height:.2f}"})
                validated_pages += 1

    unclassified_path = output_dir / "reports" / "unclassified_questions.csv"
    unclassified_rows = list(csv.DictReader(unclassified_path.open(encoding="utf-8-sig")))
    unclassified_pages = 0
    for row in unclassified_rows:
        path = Path(row["output_path"])
        try:
            actual_pages = len(PdfReader(str(path), strict=False).pages)
        except Exception as exc:
            errors.append({"question_id": row["question_id"], "error": f"unclassified slice open failed: {exc}"})
            continue
        expected_pages = int(row["page_count"])
        if actual_pages != expected_pages or actual_pages == 0:
            errors.append({"question_id": row["question_id"], "error": f"unclassified page count {actual_pages} != {expected_pages}"})
        unclassified_pages += actual_pages

    review_summary_path = output_dir / "reports" / "review_render_summary.json"
    if review_summary_path.exists():
        review_summary = json.loads(review_summary_path.read_text(encoding="utf-8"))["summary"]
        if int(review_summary["topics"]) != topic_count or int(review_summary["questions_rendered"]) != question_count:
            errors.append({"file": "review_render_summary.json", "error": "review counts do not match manifests"})
    else:
        warnings.append({"file": "review_render_summary.json", "warning": "review rendering was skipped for this production build"})

    summary = {
        "valid": not errors,
        "topic_masters_validated": topic_count,
        "classified_questions_validated": question_count,
        "classified_slice_pages_content_matched": validated_pages,
        "unclassified_questions_opened": len(unclassified_rows),
        "unclassified_slice_pages_opened": unclassified_pages,
        "topic_master_pages_validated": topic_page_count,
        "minimum_crop_height_points": None if minimum_crop_height == float("inf") else round(minimum_crop_height, 2),
        "errors": errors,
        "warnings": warnings,
        "remote_operations": 0,
    }
    atomic_json(output_dir / "reports" / "integrity_validation.json", summary)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=Path("output/local_topic_questions/production"))
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    output = args.output_dir if args.output_dir.is_absolute() else repo_root / args.output_dir
    result = validate(output.resolve())
    print(json.dumps(result, indent=2))
    return 0 if result["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
