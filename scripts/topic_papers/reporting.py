from __future__ import annotations

import csv
import json
import os
import re
import shutil
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

from pypdf import PdfReader, PdfWriter

from .models import PaperRecord, QuestionRecord
from .taxonomy import Taxonomy


def safe_segment(value: str) -> str:
    value = re.sub(r"[<>:\"/\\|?*]", "", value).strip().rstrip(".")
    return value or "UNKNOWN"


def atomic_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    os.replace(temp, path)


def write_csv(path: Path, rows: Iterable[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            normalized = {
                key: json.dumps(value, ensure_ascii=False) if isinstance(value, (list, dict)) else value
                for key, value in row.items()
            }
            writer.writerow(normalized)
    os.replace(temp, path)


def topic_directory(output_dir: Path, taxonomy: Taxonomy, code: str) -> Path:
    topic = taxonomy.by_code[code]
    subject_parts = [taxonomy.subject]
    if taxonomy.course:
        subject_parts.append(taxonomy.course)
    return output_dir.joinpath(
        *subject_parts,
        safe_segment(topic["parent"]),
        safe_segment(f"{code} {topic['title']}"),
    )


def _copy_atomic(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.with_suffix(destination.suffix + ".tmp")
    shutil.copy2(source, temp)
    os.replace(temp, destination)


def _write_master(path: Path, questions: list[QuestionRecord]) -> dict[str, Any]:
    writer = PdfWriter()
    expected_pages = 0
    for question in sorted(questions, key=lambda item: item.order_key()):
        source = Path(question.output_path)
        reader = PdfReader(str(source), strict=False)
        expected_pages += len(reader.pages)
        writer.append(str(source), outline_item=question.question_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.stem}.", suffix=".tmp.pdf", dir=path.parent)
    os.close(fd)
    temp = Path(temp_name)
    try:
        with temp.open("wb") as stream:
            writer.write(stream)
        check = PdfReader(str(temp), strict=False)
        actual_pages = len(check.pages)
        if check.is_encrypted or actual_pages != expected_pages or actual_pages == 0:
            raise ValueError(f"master validation failed: expected {expected_pages} pages, found {actual_pages}")
        os.replace(temp, path)
        return {"expected_pages": expected_pages, "actual_pages": actual_pages, "valid": True}
    finally:
        temp.unlink(missing_ok=True)


def build_topic_outputs(
    output_dir: Path,
    taxonomies: dict[tuple[str, str], Taxonomy],
    questions: list[QuestionRecord],
    paper_by_path: dict[str, PaperRecord],
    include_secondary_copies: bool,
    dry_run: bool,
) -> list[dict[str, Any]]:
    topic_groups: dict[tuple[str, str, str], list[QuestionRecord]] = defaultdict(list)
    topic_reviews: dict[tuple[str, str, str], list[QuestionRecord]] = defaultdict(list)
    for question in questions:
        course = question.course if question.subject == "mathematics" else "NONE"
        if question.primary_topic:
            key = (question.subject, course, question.primary_topic)
            if question.status == "included":
                topic_groups[key].append(question)
            elif question.review_required:
                topic_reviews[key].append(question)
        if include_secondary_copies and question.status == "included":
            for secondary in question.secondary_topics:
                topic_groups[(question.subject, course, secondary)].append(question)

    validations: list[dict[str, Any]] = []
    all_keys = sorted(set(topic_groups) | set(topic_reviews))
    for subject, course, code in all_keys:
        taxonomy = taxonomies[(subject, course)]
        directory = topic_directory(output_dir, taxonomy, code)
        included = sorted(topic_groups.get((subject, course, code), []), key=lambda item: item.order_key())
        review = sorted(topic_reviews.get((subject, course, code), []), key=lambda item: item.order_key())
        manifest_questions: list[dict[str, Any]] = []
        for question in included:
            paper = paper_by_path.get(question.source_path)
            data = question.to_dict()
            data["markscheme_path"] = paper.paired_markscheme if paper else None
            data["secondary_cross_references"] = question.secondary_topics
            manifest_questions.append(data)
            if not dry_run:
                _copy_atomic(Path(question.output_path), directory / "questions" / f"{question.question_id}.pdf")
        validation = {"topic": code, "question_count": len(included), "expected_pages": 0, "actual_pages": 0, "valid": True}
        if included and not dry_run:
            validation.update(_write_master(directory / "master.pdf", included))
        validations.append(validation)
        if not dry_run:
            atomic_json(directory / "manifest.json", {
                "topic": taxonomy.by_code[code],
                "curriculum_version": taxonomy.curriculum_version,
                "ordering": "year, session (May then November), timezone, level (SL then HL), paper, question number",
                "secondary_copy_mode": include_secondary_copies,
                "questions": manifest_questions,
            })
            write_csv(directory / "index.csv", manifest_questions, [
                "question_id", "year", "session", "timezone", "level", "paper", "question_number",
                "source_path", "source_pages", "primary_topic", "secondary_topics", "confidence", "markscheme_path",
            ])
            atomic_json(directory / "review.json", [question.to_dict() for question in review])
    return validations


QUESTION_CSV_FIELDS = [
    "question_id", "subject", "course", "year", "session", "timezone", "level", "paper",
    "question_number", "source_path", "source_pages", "regions", "output_path", "page_count", "extracted_text",
    "normalized_text", "primary_topic",
    "secondary_topics", "confidence", "classification_method", "review_required", "duplicate_status",
    "duplicate_of", "status", "error", "rationale", "matched_evidence", "manual_note",
]


def write_reports(
    output_dir: Path,
    inventory: list[PaperRecord],
    questions: list[QuestionRecord],
    possible_duplicates: list[dict[str, Any]],
    validations: list[dict[str, Any]],
    paper_failures: list[dict[str, str]],
    dry_run: bool,
) -> dict[str, Any]:
    reports = output_dir / "reports"
    inventory_rows = [record.to_dict() for record in inventory]
    question_rows = [question.to_dict() for question in questions]
    counts = Counter(question.status for question in questions)
    discovered = len(questions)
    accounted = sum(counts[status] for status in (
        "included", "exact_duplicate", "awaiting_review", "intentionally_excluded", "extraction_failure"
    ))
    coverage_ok = discovered == accounted
    topic_counts = Counter(
        (question.subject, question.course, question.primary_topic or "UNCLASSIFIED", question.status)
        for question in questions
    )
    summary = {
        "mode": "dry-run" if dry_run else "local-sample",
        "source_files_discovered": len(inventory),
        "question_papers_discovered": sum(record.role == "question_paper" for record in inventory),
        "markschemes_discovered": sum(record.role == "markscheme" for record in inventory),
        "unmatched_question_papers": sum(
            record.role == "question_paper" and not record.paired_markscheme for record in inventory
        ),
        "unmatched_markschemes": sum(
            record.role == "markscheme" and not any(
                question.paired_markscheme == record.source_path for question in inventory if question.role == "question_paper"
            ) for record in inventory
        ),
        "papers_processed": sum(record.inventory_status == "processed" for record in inventory),
        "papers_failed": sum(record.inventory_status == "failed" for record in inventory),
        "papers_skipped": sum(record.inventory_status in {"skipped", "duplicated"} for record in inventory),
        "candidate_questions_discovered": discovered,
        "included_unique_questions": counts["included"],
        "exact_duplicates_suppressed": counts["exact_duplicate"],
        "questions_awaiting_review": counts["awaiting_review"],
        "intentionally_excluded_questions": counts["intentionally_excluded"],
        "extraction_failures": counts["extraction_failure"],
        "likely_duplicate_pairs": len(possible_duplicates),
        "paper_level_failures": len(paper_failures),
        "coverage_invariant": {
            "discovered_questions": discovered,
            "accounted_questions": accounted,
            "holds": coverage_ok,
            "equation": "discovered = included + exact duplicates + awaiting review + intentionally excluded + extraction failures",
        },
        "pdf_validations": validations,
    }
    atomic_json(reports / "run_summary.json", summary)
    write_csv(reports / "all_questions.csv", question_rows, QUESTION_CSV_FIELDS)
    write_csv(reports / "unclassified_questions.csv", [row for row in question_rows if not row["primary_topic"]], QUESTION_CSV_FIELDS)
    write_csv(reports / "low_confidence_questions.csv", [row for row in question_rows if row["review_required"]], QUESTION_CSV_FIELDS)
    write_csv(reports / "possible_duplicates.csv", possible_duplicates, ["left_question_id", "right_question_id", "similarity", "status"])
    extraction_rows = [row for row in question_rows if row["status"] == "extraction_failure"] + paper_failures
    write_csv(reports / "extraction_failures.csv", extraction_rows, ["question_id", "source_path", "status", "error", "reason"])
    write_csv(reports / "source_inventory.csv", inventory_rows, [
        "source_path", "subject", "course", "year", "session", "timezone", "level", "paper", "role",
        "language", "specimen", "file_hash", "page_count", "text_pages", "paired_markscheme",
        "inventory_status", "reason",
    ])
    topic_rows = [
        {"subject": key[0], "course": key[1], "topic": key[2], "status": key[3], "count": value}
        for key, value in sorted(topic_counts.items())
    ]
    write_csv(reports / "topic_counts.csv", topic_rows, ["subject", "course", "topic", "status", "count"])
    markdown = f"""# Local topic-paper run summary

- Mode: {summary['mode']}
- Source files discovered: {summary['source_files_discovered']}
- Unmatched question papers/markschemes: {summary['unmatched_question_papers']} / {summary['unmatched_markschemes']}
- Question papers processed: {summary['papers_processed']}
- Candidate questions discovered: {discovered}
- Included unique questions: {counts['included']}
- Awaiting manual review: {counts['awaiting_review']}
- Exact duplicates suppressed: {counts['exact_duplicate']}
- Likely duplicate pairs: {len(possible_duplicates)}
- Extraction failures: {counts['extraction_failure']} question-level; {len(paper_failures)} paper-level
- Coverage invariant: {'PASS' if coverage_ok else 'FAIL'} ({accounted}/{discovered} accounted)

## Safety

This run was local-only. It did not call R2, Wrangler, deployment commands, or remote storage APIs.

## Review files

- `unclassified_questions.csv`
- `low_confidence_questions.csv`
- `possible_duplicates.csv`
- `extraction_failures.csv`
- `source_inventory.csv`
"""
    (reports / "run_summary.md").write_text(markdown, encoding="utf-8")
    if not coverage_ok:
        raise RuntimeError(f"Coverage invariant failed: {accounted} accounted != {discovered} discovered")
    return summary
