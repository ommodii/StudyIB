from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pdfplumber
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject

from .models import PageRegion, PaperRecord, QuestionRecord


NUMBER_TOKEN_RE = re.compile(r"^(?P<number>[A-Z]?\d{1,3})(?:[.)])?$")
LINE_START_RE = re.compile(r"(?m)^\s*(?P<number>[A-Z]?\d{1,3})(?:[.)])?\s+(?=[A-Z\[(])")
REPEATED_HEADER_RE = re.compile(
    r"(?im)^.*(?:international baccalaureate|candidate session number|turn over|question\s+\d+\s+continued|\b[MN]\d{2}/\d+/[A-Z0-9/()_-]+).*$"
)


@dataclass(frozen=True)
class Boundary:
    question_number: str
    page_index: int
    top: float
    source: str
    x0: float = 0.0


def normalize_text(text: str) -> str:
    text = text.replace("\u00ad", "").replace("\u00a0", " ")
    text = REPEATED_HEADER_RE.sub(" ", text)
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


def _word_candidates(page_words: list[list[dict[str, Any]]], page_widths: list[float]) -> list[Boundary]:
    candidates: list[Boundary] = []
    for page_index, words in enumerate(page_words):
        left_limit = min(110.0, page_widths[page_index] * 0.20)
        for word in words:
            token = str(word.get("text", "")).strip()
            match = NUMBER_TOKEN_RE.match(token)
            x0 = float(word.get("x0", 9999))
            if not match or x0 > left_limit:
                continue
            label = match.group("number").upper()
            number = int(re.sub(r"\D", "", label))
            if number < 1 or number > 99:
                continue
            # Tables, answer choices and equations frequently contain ascending
            # integers near the left margin. A real question label is normally
            # punctuated, or is followed on the same line by prose. Option labels
            # (H1, E2, A3, ...) are only credible at the main question margin.
            top = float(word.get("top", 0))
            x1 = float(word.get("x1", x0))
            following = sorted(
                (
                    other for other in words
                    if float(other.get("x0", -1)) >= x1 - 0.5
                    and abs(float(other.get("top", 0)) - top) <= 2.5
                    and other is not word
                ),
                key=lambda other: float(other.get("x0", 9999)),
            )
            next_text = str(following[0].get("text", "")).strip() if following else ""
            punctuated = bool(re.search(r"[.)]$", token))
            prefixed = bool(re.match(r"^[A-Z]", label))
            if prefixed and x0 > 60:
                continue
            if not punctuated:
                if x0 > 90 or not re.match(r'^[A-Z\[(\u201c"]', next_text):
                    continue
            elif x0 > 60 and next_text and re.match(r"^[\d.,+-]", next_text):
                continue
            candidates.append(Boundary(label, page_index, top, "geometry", x0))
    return candidates


def _line_candidates(page_texts: list[str], page_heights: list[float]) -> list[Boundary]:
    candidates: list[Boundary] = []
    for page_index, text in enumerate(page_texts):
        lines = text.splitlines() or [""]
        for line_index, line in enumerate(lines):
            match = LINE_START_RE.search(line)
            if not match:
                continue
            label = match.group("number").upper()
            number = int(re.sub(r"\D", "", label))
            if 1 <= number <= 99:
                estimated_top = page_heights[page_index] * (line_index / max(len(lines), 1))
                candidates.append(Boundary(label, page_index, estimated_top, "text_fallback"))
    return candidates


def _select_monotonic(candidates: list[Boundary]) -> list[Boundary]:
    """Retain numeric and option-prefixed monotonic question sequences."""
    groups: dict[str, list[Boundary]] = {}
    for item in candidates:
        prefix_match = re.match(r"([A-Z]?)\d+", item.question_number)
        prefix = prefix_match.group(1) if prefix_match else ""
        groups.setdefault(prefix, []).append(item)
    selected_by_prefix: dict[str, list[Boundary]] = {}
    for prefix, items in groups.items():
        ordered = sorted(items, key=lambda item: (
            item.page_index, item.top, int(re.sub(r"\D", "", item.question_number))
        ))
        if not ordered:
            continue
        starts = [
            index for index, item in enumerate(ordered)
            if int(re.sub(r"\D", "", item.question_number)) == 1
        ]
        start_index = starts[0] if starts else 0
        previous = 0
        anchor_x = ordered[start_index].x0
        local: list[Boundary] = []
        for item in ordered[start_index:]:
            number = int(re.sub(r"\D", "", item.question_number))
            aligned = not anchor_x or not item.x0 or abs(item.x0 - anchor_x) <= 35
            if previous == 0 or (number == previous + 1 and aligned):
                local.append(item)
                previous = number
        # A sequence without question 1 must contain at least two consecutive
        # labels. This keeps cropped 22/23/24-style material while rejecting a
        # lone year or measurement embedded in prose.
        if not starts and len(local) < 2:
            local = []
        selected_by_prefix[prefix] = local

    # In option papers, numbered species/step lists may form a perfect 1..N
    # sequence. A real unprefixed section precedes F/G/H-style option questions;
    # a numeric sequence beginning after them is therefore internal content.
    numeric = selected_by_prefix.get("", [])
    prefixed = [item for key, values in selected_by_prefix.items() if key for item in values]
    if numeric and prefixed:
        numeric_start = (numeric[0].page_index, numeric[0].top)
        prefixed_start = min((item.page_index, item.top) for item in prefixed)
        if numeric_start > prefixed_start:
            selected_by_prefix[""] = []

    selected: list[Boundary] = []
    occupied: set[tuple[int, int]] = set()
    for values in selected_by_prefix.values():
        for item in values:
            position = (item.page_index, round(item.top))
            if position not in occupied:
                selected.append(item)
                occupied.add(position)
    return sorted(selected, key=lambda item: (item.page_index, item.top, item.question_number))


def detect_question_boundaries(
    page_texts: list[str],
    page_words: list[list[dict[str, Any]]],
    page_widths: list[float],
    page_heights: list[float],
) -> list[Boundary]:
    geometric = _select_monotonic(_word_candidates(page_words, page_widths))
    if len(geometric) >= 2:
        return geometric
    fallback = _select_monotonic(_line_candidates(page_texts, page_heights))
    return fallback if len(fallback) > len(geometric) else geometric


def build_regions(boundaries: list[Boundary], page_heights: list[float], margin: float = 8.0) -> list[list[PageRegion]]:
    all_regions: list[list[PageRegion]] = []
    for index, boundary in enumerate(boundaries):
        next_boundary = boundaries[index + 1] if index + 1 < len(boundaries) else None
        end_page = next_boundary.page_index if next_boundary else len(page_heights) - 1
        regions: list[PageRegion] = []
        for page_index in range(boundary.page_index, end_page + 1):
            page_height = page_heights[page_index]
            top = max(0.0, boundary.top - margin) if page_index == boundary.page_index else 0.0
            bottom = page_height
            shared = False
            if next_boundary and page_index == next_boundary.page_index:
                bottom = max(top + 2, min(page_height, next_boundary.top - (margin / 2)))
                shared = page_index != boundary.page_index or next_boundary.top > boundary.top
            if bottom <= top + 2:
                continue
            full_page = top <= 0.1 and bottom >= page_height - 0.1
            regions.append(PageRegion(page_index, top, bottom, full_page, shared))
        all_regions.append(regions)
    return all_regions


def stable_question_id(paper: PaperRecord, question_number: str) -> str:
    subject = paper.subject
    if subject == "mathematics":
        subject = f"mathematics_{paper.course.lower()}"
    year = str(paper.year) if paper.year else "unknown"
    session = paper.session.lower() if paper.session != "UNKNOWN" else "unknown"
    timezone = paper.timezone.lower() if paper.timezone != "UNKNOWN" else "unknown"
    level = paper.level.lower() if paper.level != "UNKNOWN" else "unknown"
    paper_number = paper.paper.lower() if paper.paper != "UNKNOWN" else "unknown"
    language = f"_{paper.language.lower()}" if paper.language != "EN" else ""
    qnum = re.sub(r"[^a-z0-9]+", "", question_number.lower())
    if qnum.isdigit():
        qnum = qnum.zfill(2)
    identifier = f"{subject}_{year}_{session}_{timezone}_{level}_{paper_number}_q{qnum}{language}"
    if "unknown" in {year, session, timezone, level, paper_number}:
        source_key = hashlib.sha256(str(paper.path.resolve()).lower().encode("utf-8")).hexdigest()[:8]
        identifier += f"_{source_key}"
    return identifier


def _load_layout(path: Path, cache_dir: Path) -> dict[str, Any]:
    source_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    cache_path = cache_dir / "text" / f"{source_hash}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))
    pages: list[dict[str, Any]] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            words = page.extract_words(use_text_flow=True, keep_blank_chars=False) or []
            pages.append({"text": text, "words": words, "width": float(page.width), "height": float(page.height)})
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    temp = cache_path.with_suffix(".tmp")
    temp.write_text(json.dumps({"source_hash": source_hash, "pages": pages}, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, cache_path)
    return {"source_hash": source_hash, "pages": pages}


def _region_text(path: Path, regions: list[PageRegion]) -> str:
    chunks: list[str] = []
    with pdfplumber.open(path) as pdf:
        for region in regions:
            page = pdf.pages[region.page_index]
            if region.full_page:
                text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            else:
                cropped = page.crop((0, region.top, float(page.width), region.bottom), strict=False)
                text = cropped.extract_text(x_tolerance=2, y_tolerance=3) or ""
            chunks.append(text)
    return "\n".join(chunks)


def _region_text_from_layout(pages: list[dict[str, Any]], regions: list[PageRegion]) -> str:
    chunks: list[str] = []
    for region in regions:
        words = [
            word for word in pages[region.page_index]["words"]
            if float(word.get("top", 0)) >= region.top - 0.5
            and float(word.get("bottom", word.get("top", 0))) <= region.bottom + 0.5
        ]
        chunks.append(" ".join(str(word.get("text", "")) for word in words))
    return "\n".join(chunks)


def _page_content_bytes(page: Any) -> bytes:
    raw = page.get("/Contents")
    if raw is None:
        return b""
    raw = raw.get_object() if hasattr(raw, "get_object") else raw
    if isinstance(raw, list):
        return b"".join(_page_content_bytes({"/Contents": item}) for item in raw)
    try:
        return raw.get_data()
    except Exception:
        return getattr(raw, "_data", b"")


def write_question_pdf(
    source_path: Path,
    regions: list[PageRegion],
    destination: Path,
    reader: PdfReader | None = None,
) -> tuple[int, str, str]:
    reader = reader or PdfReader(str(source_path), strict=False)
    writer = PdfWriter()
    fingerprint_parts: list[str] = []
    for region in regions:
        original = reader.pages[region.page_index]
        writer.add_page(original)
        page = writer.pages[-1]
        width = float(original.mediabox.width)
        height = float(original.mediabox.height)
        if not region.full_page:
            lower = max(0.0, height - region.bottom)
            upper = min(height, height - region.top)
            box = RectangleObject((0, lower, width, upper))
            page.mediabox = box
            page.cropbox = box
        content_bytes = _page_content_bytes(original)
        content_hash = hashlib.sha256(content_bytes).hexdigest()
        fingerprint_parts.append(
            f"{round(width, 2)}x{round(height, 2)}:{round(region.top, 2)}-{round(region.bottom, 2)}:{content_hash}"
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{destination.stem}.", suffix=".tmp.pdf", dir=destination.parent)
    os.close(fd)
    temp_path = Path(temp_name)
    try:
        with temp_path.open("wb") as stream:
            writer.write(stream)
        validation = PdfReader(str(temp_path), strict=False)
        if validation.is_encrypted or len(validation.pages) != len(regions) or len(validation.pages) == 0:
            raise ValueError("written question PDF failed page-count or encryption validation")
        pdf_hash = hashlib.sha256(temp_path.read_bytes()).hexdigest()
        os.replace(temp_path, destination)
        page_fingerprint = hashlib.sha256("|".join(fingerprint_parts).encode("utf-8")).hexdigest()
        return len(validation.pages), pdf_hash, page_fingerprint
    finally:
        temp_path.unlink(missing_ok=True)


def extract_questions(
    paper: PaperRecord,
    output_dir: Path,
    cache_dir: Path,
    dry_run: bool = False,
    boundary_overrides: dict[str, dict[str, Any]] | None = None,
) -> tuple[list[QuestionRecord], str | None]:
    path = Path(paper.source_path)
    try:
        layout = _load_layout(path, cache_dir)
    except Exception as exc:
        return [], f"text extraction failed: {type(exc).__name__}: {exc}"
    pages = layout["pages"]
    page_texts = [page["text"] for page in pages]
    page_words = [page["words"] for page in pages]
    widths = [float(page["width"]) for page in pages]
    heights = [float(page["height"]) for page in pages]
    paper.text_pages = sum(bool(normalize_text(text)) for text in page_texts)
    if not pages:
        return [], "source PDF has zero pages"
    if paper.text_pages == 0:
        return [], "native text extraction produced no usable text; OCR/manual review required"
    boundaries = detect_question_boundaries(page_texts, page_words, widths, heights)
    if not boundaries:
        return [], "no reliable question boundaries detected"
    region_groups = build_regions(boundaries, heights)
    # A new question often starts near the top of a fresh page. Do not attach a
    # header-only sliver of that page to the preceding question.
    for regions in region_groups:
        if not regions or not regions[-1].shared_page:
            continue
        candidate = regions[-1]
        if candidate.page_index == regions[0].page_index:
            continue
        preview = normalize_text(_region_text(path, [candidate]))
        if not preview or re.fullmatch(r"(?:question\s+\d+|\d+)", preview):
            regions.pop()
    questions: list[QuestionRecord] = []
    source_reader = PdfReader(str(path), strict=False) if not dry_run else None
    for boundary, regions in zip(boundaries, region_groups):
        question_id = stable_question_id(paper, boundary.question_number)
        override = (boundary_overrides or {}).get(question_id, {})
        if isinstance(override.get("regions"), list) and override["regions"]:
            manual_regions: list[PageRegion] = []
            for item in override["regions"]:
                page_index = int(item.get("page", 1)) - 1
                if not 0 <= page_index < len(heights):
                    raise ValueError(f"manual boundary page is outside source PDF for {question_id}")
                top = float(item.get("top", 0))
                bottom = float(item.get("bottom", heights[page_index]))
                if not 0 <= top < bottom <= heights[page_index]:
                    raise ValueError(f"invalid manual boundary coordinates for {question_id}")
                manual_regions.append(PageRegion(
                    page_index=page_index,
                    top=top,
                    bottom=bottom,
                    full_page=top == 0 and bottom == heights[page_index],
                    shared_page=bool(item.get("shared_page", False)),
                ))
            regions = manual_regions
        extracted = _region_text_from_layout(pages, regions)
        normalized = normalize_text(extracted)
        text_hash = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        question = QuestionRecord(
            question_id=question_id,
            subject=paper.subject,
            course=paper.course,
            year=paper.year,
            session=paper.session,
            timezone=paper.timezone,
            level=paper.level,
            paper=paper.paper,
            question_number=boundary.question_number,
            source_path=paper.source_path,
            source_pages=sorted({region.page_index + 1 for region in regions}),
            regions=regions,
            extracted_text=extracted,
            normalized_text=normalized,
            text_hash=text_hash,
        )
        destination = output_dir / "_questions" / paper.subject / f"{question_id}.pdf"
        question.output_path = str(destination.resolve())
        if not dry_run:
            try:
                question.page_count, question.pdf_hash, question.page_fingerprint = write_question_pdf(
                    path, regions, destination, source_reader
                )
            except Exception as exc:
                question.status = "extraction_failure"
                question.error = f"PDF extraction failed: {type(exc).__name__}: {exc}"
        else:
            question.page_count = len(regions)
            question.page_fingerprint = hashlib.sha256(
                "|".join(f"{r.page_index}:{r.top:.2f}:{r.bottom:.2f}" for r in regions).encode("utf-8")
            ).hexdigest()
        questions.append(question)
    return questions, None
