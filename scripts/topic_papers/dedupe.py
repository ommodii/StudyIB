from __future__ import annotations

from collections import defaultdict
from difflib import SequenceMatcher
import hashlib
import re

from .models import QuestionRecord


def mark_duplicates(questions: list[QuestionRecord], likely_threshold: float = 0.985) -> list[dict[str, str | float]]:
    """Suppress only byte/text-identical questions; report high-similarity pairs."""
    possible: list[dict[str, str | float]] = []
    exact_groups: dict[tuple[str, str, str], list[QuestionRecord]] = defaultdict(list)
    for question in questions:
        if question.status == "extraction_failure":
            continue
        identity = question.pdf_hash or question.text_hash
        exact_groups[(question.subject, question.course, identity)].append(question)
    for group in exact_groups.values():
        if len(group) < 2:
            continue
        retained = sorted(group, key=lambda item: item.order_key())[0]
        for duplicate in group:
            if duplicate is retained:
                continue
            duplicate.duplicate_status = "exact_duplicate"
            duplicate.duplicate_of = retained.question_id
            duplicate.status = "exact_duplicate"
            duplicate.review_required = False

    candidates = [q for q in questions if q.duplicate_status == "unique" and len(q.normalized_text) >= 80]
    buckets: dict[tuple[str, str, str], list[QuestionRecord]] = defaultdict(list)
    for question in candidates:
        tokens = re.findall(r"[a-z]{3,}", question.normalized_text)
        middle = max(0, (len(tokens) // 2) - 8)
        sample = [*tokens[:16], *tokens[middle:middle + 16], *tokens[-16:]]
        signature = hashlib.sha256(" ".join(sample).encode()).hexdigest()
        length_band = str(len(question.normalized_text) // 32)
        buckets[(question.subject, question.course, f"{signature}:{length_band}")].append(question)
    for bucket in buckets.values():
        for index, left in enumerate(bucket):
            for right in bucket[index + 1:]:
                if abs(len(left.normalized_text) - len(right.normalized_text)) > max(len(left.normalized_text), len(right.normalized_text)) * 0.08:
                    continue
                ratio = SequenceMatcher(None, left.normalized_text, right.normalized_text, autojunk=False).ratio()
                if ratio >= likely_threshold:
                    left.duplicate_status = "likely_duplicate"
                    right.duplicate_status = "likely_duplicate"
                    left.review_required = True
                    right.review_required = True
                    possible.append({
                        "left_question_id": left.question_id,
                        "right_question_id": right.question_id,
                        "similarity": round(ratio, 5),
                        "status": "likely_duplicate",
                    })
    return possible
