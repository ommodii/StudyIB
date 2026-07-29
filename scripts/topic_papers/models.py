from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class PaperRecord:
    source_path: str
    subject: str
    course: str
    year: int | None
    session: str
    timezone: str
    level: str
    paper: str
    role: str
    language: str
    specimen: bool
    file_hash: str = ""
    page_count: int = 0
    text_pages: int = 0
    paired_markscheme: str | None = None
    inventory_status: str = "discovered"
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def path(self) -> Path:
        return Path(self.source_path)


@dataclass
class PageRegion:
    page_index: int
    top: float
    bottom: float
    full_page: bool = False
    shared_page: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class QuestionRecord:
    question_id: str
    subject: str
    course: str
    year: int | None
    session: str
    timezone: str
    level: str
    paper: str
    question_number: str
    source_path: str
    source_pages: list[int]
    regions: list[PageRegion]
    extracted_text: str
    normalized_text: str
    output_path: str = ""
    page_count: int = 0
    text_hash: str = ""
    pdf_hash: str = ""
    page_fingerprint: str = ""
    primary_topic: str | None = None
    secondary_topics: list[str] = field(default_factory=list)
    confidence: float = 0.0
    classification_method: str = "unclassified"
    rationale: str = ""
    review_required: bool = True
    matched_evidence: dict[str, list[str]] = field(default_factory=dict)
    duplicate_status: str = "unique"
    duplicate_of: str | None = None
    status: str = "awaiting_review"
    error: str = ""
    manual_note: str = ""

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["regions"] = [region.to_dict() for region in self.regions]
        return data

    def order_key(self) -> tuple[Any, ...]:
        session_order = {"May": 0, "November": 1, "UNKNOWN": 9}
        level_order = {"SL": 0, "HL": 1, "UNKNOWN": 9}
        digits = "".join(ch for ch in self.question_number if ch.isdigit())
        qnum = int(digits) if digits else 9999
        return (
            self.year or 9999,
            session_order.get(self.session, 9),
            self.timezone,
            level_order.get(self.level, 9),
            self.paper,
            qnum,
            self.question_number,
            self.question_id,
        )
