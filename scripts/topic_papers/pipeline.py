from __future__ import annotations

import json
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .classify import classification_cache_path, classify_question, load_manual_overrides, validate_classification_result
from .dedupe import mark_duplicates
from .inventory import inventory_sources
from .local_guard import LOCAL_BANNER, assert_local_only
from .models import PaperRecord, QuestionRecord
from .pdf_extract import extract_questions
from .reporting import atomic_json, build_topic_outputs, write_csv, write_reports
from .taxonomy import Taxonomy, load_taxonomy


@dataclass
class PipelineOptions:
    repo_root: Path
    output_dir: Path
    cache_dir: Path
    subjects: list[str]
    course: str | None = None
    source_dir: Path | None = None
    dry_run: bool = False
    resume: bool = False
    force_reclassify: bool = False
    include_secondary_copies: bool = False
    confidence_threshold: float = 0.80
    max_papers: int | None = None


class StructuredLogger:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)

    def emit(self, stage: str, status: str, message: str, source_file: str = "", question_id: str = "", error_type: str = "") -> None:
        event = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "stage": stage,
            "source_file": source_file,
            "question_id": question_id,
            "status": status,
            "error_type": error_type,
            "message": message,
        }
        with self.path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(event, ensure_ascii=False) + "\n")


def _taxonomy_key(subject: str, course: str) -> tuple[str, str]:
    return subject, course if subject == "mathematics" else "NONE"


def _load_taxonomies(options: PipelineOptions) -> dict[tuple[str, str], Taxonomy]:
    config_dir = options.repo_root / "config" / "curricula"
    taxonomies: dict[tuple[str, str], Taxonomy] = {}
    for subject in options.subjects:
        if subject == "mathematics":
            courses = [options.course] if options.course in {"aa", "ai"} else ["aa", "ai"]
            for course in courses:
                taxonomies[(subject, course)] = load_taxonomy(config_dir, subject, course)
        else:
            taxonomies[(subject, "NONE")] = load_taxonomy(config_dir, subject)
    return taxonomies


def _apply_cached_classification(question: QuestionRecord, data: dict[str, Any], taxonomy: Taxonomy) -> bool:
    errors = validate_classification_result(data, taxonomy)
    if errors:
        return False
    for field in (
        "primary_topic", "secondary_topics", "confidence", "classification_method", "rationale",
        "review_required", "matched_evidence", "status",
    ):
        if field in data:
            setattr(question, field, data[field])
    question.classification_method = f"cached:{question.classification_method}"
    return True


def _cache_classification(path: Path, question: QuestionRecord) -> None:
    atomic_json(path, {
        "primary_topic": question.primary_topic,
        "secondary_topics": question.secondary_topics,
        "confidence": question.confidence,
        "classification_method": question.classification_method.replace("cached:", ""),
        "rationale": question.rationale,
        "review_required": question.review_required,
        "matched_evidence": question.matched_evidence,
        "status": question.status,
    })


def _write_subject_manifests(
    output_dir: Path,
    questions: list[QuestionRecord],
    taxonomies: dict[tuple[str, str], Taxonomy],
    dry_run: bool,
) -> None:
    if dry_run:
        return
    grouped: dict[tuple[str, str], list[QuestionRecord]] = defaultdict(list)
    for question in questions:
        grouped[_taxonomy_key(question.subject, question.course)].append(question)
    for key, records in grouped.items():
        taxonomy = taxonomies.get(key)
        if not taxonomy:
            continue
        base = output_dir / taxonomy.subject
        if taxonomy.course:
            base /= taxonomy.course
        ordered = sorted(records, key=lambda item: item.order_key())
        atomic_json(base / "subject_manifest.json", {
            "subject": taxonomy.subject,
            "course": taxonomy.course,
            "curriculum_version": taxonomy.curriculum_version,
            "sources": taxonomy.sources,
            "questions": [record.to_dict() for record in ordered],
        })
        write_csv(base / "subject_index.csv", [record.to_dict() for record in ordered], [
            "question_id", "year", "session", "timezone", "level", "paper", "question_number",
            "source_path", "source_pages", "primary_topic", "secondary_topics", "confidence", "status",
        ])


def run_pipeline(options: PipelineOptions) -> dict[str, Any]:
    assert_local_only(options.repo_root, options.output_dir)
    print(LOCAL_BANNER)
    options.output_dir.mkdir(parents=True, exist_ok=True)
    options.cache_dir.mkdir(parents=True, exist_ok=True)
    logger = StructuredLogger(options.output_dir / "reports" / "run.log.jsonl")
    taxonomies = _load_taxonomies(options)
    manual_overrides = load_manual_overrides(options.repo_root / "config" / "manual_overrides.json")
    logger.emit("startup", "ok", LOCAL_BANNER)

    inventory = inventory_sources(
        options.repo_root,
        options.subjects,
        source_dir=options.source_dir,
        hash_files=True,
    )
    logger.emit("inventory", "ok", f"Discovered {len(inventory)} source PDFs")
    candidates = [
        record for record in inventory
        if record.role == "question_paper" and record.inventory_status == "discovered"
    ]
    if options.course in {"aa", "ai"}:
        for record in candidates:
            if record.subject == "mathematics" and record.course == "UNKNOWN" and options.source_dir:
                record.course = options.course
    candidates.sort(key=lambda record: (
        record.subject, record.year or 9999, record.session, record.timezone, record.level, record.paper, record.source_path.lower()
    ))
    if options.max_papers is not None:
        selected = set(record.source_path for record in candidates[:options.max_papers])
        for record in candidates:
            if record.source_path not in selected:
                record.inventory_status = "skipped"
                record.reason = "excluded by --max-papers sample limit"
        candidates = candidates[:options.max_papers]

    questions: list[QuestionRecord] = []
    paper_failures: list[dict[str, str]] = []
    checkpoint: dict[str, Any] = {"version": 1, "papers": {}}
    checkpoint_path = options.cache_dir / "state.json"
    if options.resume and checkpoint_path.exists():
        try:
            checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            checkpoint = {"version": 1, "papers": {}}

    for paper in candidates:
        key = _taxonomy_key(paper.subject, paper.course)
        if key not in taxonomies:
            paper.inventory_status = "skipped"
            paper.reason = "course taxonomy is UNKNOWN; manual course identification required"
            logger.emit("extract", "skipped", paper.reason, paper.source_path)
            continue
        paper_questions, failure = extract_questions(
            paper,
            options.output_dir,
            options.cache_dir,
            options.dry_run,
            boundary_overrides=manual_overrides,
        )
        if failure:
            paper.inventory_status = "failed"
            paper.reason = failure
            paper_failures.append({"source_path": paper.source_path, "status": "failed", "error": failure, "reason": failure})
            logger.emit("extract", "failed", failure, paper.source_path, error_type="extraction")
        else:
            paper.inventory_status = "processed"
            questions.extend(paper_questions)
            logger.emit("extract", "ok", f"Detected {len(paper_questions)} questions", paper.source_path)
        checkpoint["papers"][paper.source_path] = {
            "file_hash": paper.file_hash,
            "status": paper.inventory_status,
            "reason": paper.reason,
            "question_ids": [question.question_id for question in paper_questions],
        }
        atomic_json(checkpoint_path, checkpoint)

    for question in questions:
        if question.status == "extraction_failure":
            continue
        taxonomy = taxonomies[_taxonomy_key(question.subject, question.course)]
        cache_path = classification_cache_path(options.cache_dir, taxonomy, question)
        overridden = question.question_id in manual_overrides
        cache_used = False
        if cache_path.exists() and not options.force_reclassify and not overridden:
            try:
                cache_used = _apply_cached_classification(
                    question, json.loads(cache_path.read_text(encoding="utf-8")), taxonomy
                )
            except (json.JSONDecodeError, OSError):
                cache_used = False
        if not cache_used:
            classify_question(question, taxonomy, options.confidence_threshold, manual_overrides)
            if not overridden:
                _cache_classification(cache_path, question)
        logger.emit("classification", question.status, question.rationale, question.source_path, question.question_id)

    possible_duplicates = mark_duplicates(questions)
    paper_by_path: dict[str, PaperRecord] = {paper.source_path: paper for paper in inventory}
    validations = build_topic_outputs(
        options.output_dir,
        taxonomies,
        questions,
        paper_by_path,
        options.include_secondary_copies,
        options.dry_run,
    )
    _write_subject_manifests(options.output_dir, questions, taxonomies, options.dry_run)
    summary = write_reports(
        options.output_dir,
        inventory,
        questions,
        possible_duplicates,
        validations,
        paper_failures,
        options.dry_run,
    )
    logger.emit("complete", "ok", f"Review report: {options.output_dir / 'reports' / 'run_summary.md'}")
    print(f"Review report: {options.output_dir / 'reports' / 'run_summary.md'}")
    return summary
