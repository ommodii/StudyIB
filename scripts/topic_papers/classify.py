from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .models import QuestionRecord
from .taxonomy import Taxonomy


CLASSIFIER_VERSION = "rules_v3_word_boundaries"


def load_manual_overrides(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("questions", {})


def validate_classification_result(result: dict[str, Any], taxonomy: Taxonomy) -> list[str]:
    errors: list[str] = []
    valid_codes = set(taxonomy.by_code)
    primary = result.get("primary_topic")
    if primary is not None and primary not in valid_codes:
        errors.append(f"unknown primary topic: {primary}")
    secondary = result.get("secondary_topics", [])
    if not isinstance(secondary, list):
        errors.append("secondary_topics must be a list")
    else:
        invalid = [code for code in secondary if code not in valid_codes]
        if invalid:
            errors.append(f"unknown secondary topics: {', '.join(invalid)}")
        if primary in secondary:
            errors.append("primary topic must not also be secondary")
    confidence = result.get("confidence", 0)
    if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        errors.append("confidence must be between 0 and 1")
    return errors


def _phrase_matches(text: str, phrases: list[str]) -> list[str]:
    evidence: list[str] = []
    for phrase in phrases:
        normalized = re.sub(r"\s+", " ", phrase.lower()).strip()
        if not normalized:
            continue
        pattern = re.escape(normalized).replace(r"\ ", r"\s+")
        if normalized[0].isalnum():
            pattern = rf"(?<!\w){pattern}"
        if normalized[-1].isalnum():
            pattern = rf"{pattern}(?!\w)"
        if re.search(pattern, text):
            evidence.append(phrase)
    return evidence


def classify_question(
    question: QuestionRecord,
    taxonomy: Taxonomy,
    confidence_threshold: float,
    manual_overrides: dict[str, dict[str, Any]],
    allowed_codes: set[str] | None = None,
) -> None:
    override = manual_overrides.get(question.question_id)
    if override:
        result = {
            "primary_topic": override.get("primary_topic"),
            "secondary_topics": override.get("secondary_topics", []),
            "confidence": 1.0,
        }
        errors = validate_classification_result(result, taxonomy)
        if errors:
            question.error = "invalid manual override: " + "; ".join(errors)
            question.status = "awaiting_review"
            question.review_required = True
            return
        question.primary_topic = result["primary_topic"]
        question.secondary_topics = result["secondary_topics"]
        question.confidence = 1.0
        question.classification_method = "manual_override"
        question.rationale = "Persistent reviewer override applied."
        question.review_required = bool(override.get("review_required", False))
        question.manual_note = str(override.get("reviewer_note", ""))
        duplicate_status = str(override.get("duplicate_status", "unique"))
        if duplicate_status in {"unique", "related_but_distinct"}:
            question.duplicate_status = duplicate_status
        include = override.get("include", True)
        question.status = "included" if include and question.primary_topic else "intentionally_excluded"
        return

    text = question.normalized_text
    scored: list[tuple[float, str, dict[str, list[str]]]] = []
    for topic in taxonomy.topics:
        if allowed_codes is not None and topic["code"] not in allowed_codes:
            continue
        if question.level in {"SL", "HL"} and question.level not in topic["level"]:
            continue
        keyword_hits = _phrase_matches(text, topic["keywords"])
        concept_hits = _phrase_matches(text, topic["concepts"])
        legacy_hits = _phrase_matches(text, topic["legacy_topic_mappings"])
        exclusion_hits = _phrase_matches(text, topic["exclusions"])
        score = 2.0 * len(keyword_hits) + 1.5 * len(concept_hits) + 0.75 * len(legacy_hits) - 3.0 * len(exclusion_hits)
        if score > 0:
            scored.append((score, topic["code"], {
                "keywords": keyword_hits,
                "concepts": concept_hits,
                "legacy": legacy_hits,
                "exclusions": exclusion_hits,
            }))
    scored.sort(key=lambda item: (-item[0], item[1]))
    if not scored:
        question.primary_topic = None
        question.secondary_topics = []
        question.confidence = 0.0
        question.classification_method = "deterministic_rules"
        question.rationale = "No taxonomy evidence matched the extracted question text."
        question.review_required = True
        question.status = "awaiting_review"
        return

    top_score, top_code, top_evidence = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else 0.0
    # A single exact syllabus phrase is strong evidence when no competing topic
    # matches. Keep genuinely competing matches conservative, but do not force
    # every concise mathematics question into review merely because it contains
    # one distinctive phrase.
    confidence = min(0.99, top_score / (top_score + second_score + 0.5))
    secondary = [code for score, code, _ in scored[1:] if score >= max(2.0, top_score * 0.45)]
    question.primary_topic = top_code
    question.secondary_topics = secondary
    question.confidence = round(confidence, 4)
    question.classification_method = "deterministic_rules"
    question.matched_evidence = {top_code: top_evidence["keywords"] + top_evidence["concepts"] + top_evidence["legacy"]}
    for score, code, evidence in scored[1:]:
        if code in secondary:
            question.matched_evidence[code] = evidence["keywords"] + evidence["concepts"] + evidence["legacy"]
    question.rationale = (
        f"Primary {top_code} scored {top_score:.2f}; next candidate scored {second_score:.2f}. "
        f"Matched evidence: {', '.join(question.matched_evidence.get(top_code, [])) or 'none'}."
    )
    question.review_required = confidence < confidence_threshold
    question.status = "awaiting_review" if question.review_required else "included"


def classification_cache_path(cache_dir: Path, taxonomy: Taxonomy, question: QuestionRecord) -> Path:
    version = re.sub(r"[^a-z0-9]+", "_", taxonomy.curriculum_version.lower()).strip("_")
    level = question.level.lower() if question.level else "unknown"
    return cache_dir / "classifications" / CLASSIFIER_VERSION / version / f"{level}_{question.text_hash}.json"
