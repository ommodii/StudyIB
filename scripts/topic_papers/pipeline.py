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
from .pdf_extract import extract_question_text_index, extract_questions, normalize_text
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
    min_year: int | None = None
    max_year: int | None = None
    english_only: bool = False


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


def _classification_scope(question: QuestionRecord) -> set[str] | None:
    """Use the legacy Computer Science option layout as a deterministic hint.

    The 2014-2026 Paper 2 always grouped questions by option: databases,
    modelling/simulation, web science, then OOP. Restricting candidate topics
    prevents generic words such as "class", "model", and "table" from sending
    an otherwise clear option question to the wrong current-curriculum theme.
    """
    if question.subject != "computer_science" or question.paper != "P2":
        return None
    digits = "".join(character for character in question.question_number if character.isdigit())
    if not digits:
        return None
    number = int(digits)
    if 1 <= number <= 4:
        return {"CS A.3"}
    if 5 <= number <= 8:
        return {"CS B.1", "CS A.4"}
    if 9 <= number <= 12:
        return {"CS A.2"}
    if 13 <= number <= 17:
        return {"CS B.2", "CS B.3", "CS B.4"}
    return None


def _apply_computer_science_option_fallback(question: QuestionRecord) -> None:
    """Map a vocabulary-light legacy Paper 2 question by its official option."""
    if question.subject != "computer_science" or question.paper != "P2" or question.primary_topic:
        return
    digits = "".join(character for character in question.question_number if character.isdigit())
    if not digits:
        return
    number = int(digits)
    fallback = (
        "CS A.3" if 1 <= number <= 4 else
        "CS B.1" if 5 <= number <= 8 else
        "CS A.2" if 9 <= number <= 12 else
        "CS B.3" if 13 <= number <= 17 else
        None
    )
    if not fallback:
        return
    question.primary_topic = fallback
    question.secondary_topics = []
    question.confidence = 0.85
    question.classification_method = "legacy_option_structure"
    question.rationale = f"Mapped from the official 2014-2026 Paper 2 option block to {fallback}."
    question.review_required = False
    question.status = "included"


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
    manual_overrides.update(load_manual_overrides(options.repo_root / "config" / "additional_question_overrides.json"))
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
    for record in candidates:
        outside_years = (
            (options.min_year is not None and (record.year is None or record.year < options.min_year))
            or (options.max_year is not None and (record.year is None or record.year > options.max_year))
        )
        wrong_language = options.english_only and record.language != "EN"
        if outside_years or wrong_language:
            record.inventory_status = "skipped"
            record.reason = "excluded by curriculum year window" if outside_years else "excluded non-English paper"
    candidates = [record for record in candidates if record.inventory_status == "discovered"]
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
            if paper.paired_markscheme:
                try:
                    markscheme_text = extract_question_text_index(Path(paper.paired_markscheme), options.cache_dir)
                    for question in paper_questions:
                        supplemental = markscheme_text.get(question.question_number.upper(), "")
                        # Some legacy markschemes have malformed internal tables
                        # that make a detected region swallow the rest of the
                        # document. Never let that unrelated text dominate the
                        # question's classification evidence.
                        # Markscheme fallback is intentionally limited to short
                        # formula-heavy questions and short matching answers.
                        # Long prose questions already contain better evidence.
                        maximum_supplement = min(1500, max(500, len(question.extracted_text) * 3))
                        if len(question.extracted_text) <= 750 and supplemental and len(supplemental) <= maximum_supplement:
                            question.extracted_text += "\n[MARKSCHEME CLASSIFICATION TEXT]\n" + supplemental
                            question.normalized_text = normalize_text(question.extracted_text)
                except Exception as exc:
                    logger.emit("markscheme-text", "warning", f"Could not index paired markscheme: {type(exc).__name__}: {exc}", paper.paired_markscheme)
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
            classify_question(
                question,
                taxonomy,
                options.confidence_threshold,
                manual_overrides,
                allowed_codes=_classification_scope(question),
            )
            _apply_computer_science_option_fallback(question)
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
