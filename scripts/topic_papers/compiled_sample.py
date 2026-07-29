from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable

import pdfplumber
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .local_guard import LOCAL_BANNER, assert_local_only, assert_safe_process
from .reporting import atomic_json


REFERENCE_RE = re.compile(
    r"^(?P<year>\d{4})_(?P<session>May|November)_P(?P<paper>\d+)"
    r"(?:_TZ(?P<timezone>\d+))?_Q(?P<label>[A-Z]?\d+)$",
    re.IGNORECASE,
)
QUESTION_TOKEN_RE = re.compile(r"^(?P<label>[A-Z]?\d{1,3})(?:[.)])?$")
CONTINUATION_RE = re.compile(
    r"(?:question\s+[A-Z]?\d+\s+continued|continues?\s+on\s+the\s+following\s+page)", re.IGNORECASE
)
EXAM_CODE_RE = re.compile(r"\b[MN]\d{2}/\d{3}/(?P<level>[HS])(?:L)?\([^)]*\)", re.IGNORECASE)


@dataclass(frozen=True)
class Marker:
    label: str
    page: int
    top: float
    x0: float
    score: float


@dataclass
class Region:
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    mode: str
    shared_page: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "page": self.page + 1,
            "x0": round(self.x0, 3),
            "y0": round(self.y0, 3),
            "x1": round(self.x1, 3),
            "y1": round(self.y1, 3),
            "mode": self.mode,
            "shared_page": self.shared_page,
        }


@dataclass
class SliceRecord:
    question_id: str
    subject: str
    source_file: str
    reference_file: str
    year: int | None
    session: str
    timezone: int | str
    level: str
    paper: int | str
    section: str
    question_number: str
    examination_code: str
    source_regions: list[Region]
    output_pdf: str
    page_count: int
    extracted_text: str
    boundary_confidence: float
    boundary_review_required: bool
    boundary_note: str
    primary_topic: str
    secondary_topics: list[str] = field(default_factory=list)
    classification_confidence: float = 0.0
    classification_rationale: str = ""
    classification_review_required: bool = True
    duplicate_status: str = "unique"
    duplicate_of: str | None = None
    visual_fingerprint: str = ""
    normalized_text_hash: str = ""
    status: str = "success"
    error: str = ""
    manual_note: str = ""

    def as_dict(self, include_text: bool = True) -> dict[str, Any]:
        data = dict(vars(self))
        data["source_regions"] = [region.as_dict() for region in self.source_regions]
        if not include_text:
            data.pop("extracted_text", None)
        return data


def normalize_text(text: str) -> str:
    text = text.replace("\u00ad", "").replace("\u00a0", " ")
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def _plain_reference_files(directory: Path) -> list[Path]:
    return sorted(path for path in directory.glob("*.pdf") if not re.search(r" \d+\.pdf$", path.name))


def _reference_metadata(path: Path) -> dict[str, Any]:
    match = REFERENCE_RE.match(path.stem)
    if not match:
        return {
            "year": None, "session": "unknown", "timezone": "unknown", "paper": "unknown",
            "label": "unknown", "section": "unknown",
        }
    values = match.groupdict()
    label = values["label"].upper()
    section = label[0] if label[0].isalpha() else "unknown"
    return {
        "year": int(values["year"]),
        "session": values["session"].lower(),
        "timezone": int(values["timezone"]) if values["timezone"] else "unknown",
        "paper": int(values["paper"]),
        "label": label,
        "section": section,
    }


def _page_signature(page: Any) -> str:
    text = normalize_text(page.extract_text() or "")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_reference_map(source_pdf: Path, reference_dir: Path) -> list[tuple[Path, int, int]]:
    """Map local provenance chunks onto the compilation, refusing a guessed alignment."""
    source = PdfReader(str(source_pdf), strict=False)
    references = _plain_reference_files(reference_dir)
    mapped: list[tuple[Path, int, int]] = []
    cursor = 0
    for reference in references:
        reader = PdfReader(str(reference), strict=False)
        start = cursor
        for page in reader.pages:
            if cursor >= len(source.pages) or _page_signature(source.pages[cursor]) != _page_signature(page):
                raise ValueError(
                    f"reference alignment failed at compilation page {cursor + 1} for {reference.name}; "
                    "the run is stopped instead of guessing boundaries"
                )
            cursor += 1
        mapped.append((reference, start, cursor))
    if cursor != len(source.pages):
        raise ValueError(f"reference alignment accounts for {cursor}/{len(source.pages)} compilation pages")
    return mapped


def _layout(source_pdf: Path) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    with pdfplumber.open(source_pdf) as pdf:
        for page in pdf.pages:
            words = page.extract_words(use_text_flow=True, keep_blank_chars=False, extra_attrs=["fontname", "size"])
            pages.append({
                "width": float(page.width),
                "height": float(page.height),
                "text": page.extract_text(x_tolerance=2, y_tolerance=3) or "",
                "words": words or [],
            })
    return pages


def _markers(page: dict[str, Any], page_index: int) -> list[Marker]:
    words = page["words"]
    result: list[Marker] = []
    for index, word in enumerate(words):
        token = str(word.get("text", "")).strip()
        match = QUESTION_TOKEN_RE.match(token)
        if not match:
            continue
        x0 = float(word.get("x0", 9999))
        top = float(word.get("top", 0))
        if x0 > min(82.0, page["width"] * 0.14) or top < 20 or top > page["height"] - 45:
            continue
        label = match.group("label").upper()
        number = int(re.sub(r"\D", "", label))
        if number < 1 or number > 99:
            continue
        # Main numbers are normally left-aligned and followed by prose or a subpart.
        following = words[index + 1:index + 5]
        rightward = any(float(item.get("x0", 0)) > x0 + 12 for item in following)
        score = 0.55 + (0.20 if x0 < 75 else 0) + (0.15 if rightward else 0)
        font = str(word.get("fontname", "")).lower()
        if "bold" in font:
            score += 0.05
        result.append(Marker(label, page_index, top, x0, min(score, 0.99)))
    # Collapse duplicate word extraction at the same visual position.
    unique: dict[tuple[str, int], Marker] = {}
    for marker in result:
        key = (marker.label, round(marker.top))
        if key not in unique or marker.score > unique[key].score:
            unique[key] = marker
    return sorted(unique.values(), key=lambda item: (item.page, item.top, item.x0))


def _target_numeric(label: str) -> str:
    digits = re.sub(r"\D", "", label)
    return str(int(digits)) if digits else label


def detect_regions(
    pages: list[dict[str, Any]], start: int, end: int, expected_label: str, margin: float = 10.0
) -> tuple[list[Region], float, bool, str]:
    candidates: list[Marker] = []
    for page_index in range(start, end):
        candidates.extend(_markers(pages[page_index], page_index))
    expected_numeric = _target_numeric(expected_label)
    target_candidates = [m for m in candidates if _target_numeric(m.label) == expected_numeric]
    if not target_candidates:
        regions = [
            Region(i, 0, 0, pages[i]["width"], pages[i]["height"], "full-page") for i in range(start, end)
        ]
        return regions, 0.35, True, "Expected question marker was not found; included the complete provenance chunk."

    target = target_candidates[0]
    # A continuation header can repeat the same main number. It belongs to the
    # current question and must never become an end boundary.
    later = [
        m for m in candidates
        if (m.page, m.top) > (target.page, target.top)
        and _target_numeric(m.label) != expected_numeric
        and abs(m.x0 - target.x0) <= 24
    ]
    next_marker = later[0] if later else None
    regions: list[Region] = []
    last_page = next_marker.page if next_marker else end - 1
    for page_index in range(target.page, last_page + 1):
        page = pages[page_index]
        y0 = max(0.0, target.top - margin) if page_index == target.page else 0.0
        # Preserve paper/section headers when the question starts near the top.
        if page_index == target.page and target.top < 175:
            y0 = 0.0
        y1 = page["height"]
        shared = False
        if next_marker and page_index == next_marker.page:
            y1 = max(y0 + 4, next_marker.top - margin)
            shared = True
        # Some provenance chunks carry the header of the following physical
        # page. A very short pre-question strip contains no answer content and
        # should not become a blank final page in the current slice.
        if shared and page_index > target.page and y1 < 100:
            continue
        if y1 <= y0 + 4:
            continue
        full = y0 <= 0.1 and y1 >= page["height"] - 0.1
        regions.append(Region(
            page_index, 0, y0, page["width"], y1, "full-page" if full else "cropped", shared
        ))

    continuation = any(CONTINUATION_RE.search(pages[i]["text"] or "") for i in range(target.page, end))
    confidence = min(target.score + (0.04 if next_marker else 0.0) + (0.03 if continuation and len(regions) > 1 else 0.0), 0.99)
    review = confidence < 0.84
    note = "Expected marker located by text coordinates."
    if len(regions) > 1:
        note += " All continuation pages in the provenance chunk were attached."
    if not next_marker:
        note += " No following main-question marker was present; the final page was conservatively retained."
    return regions, round(confidence, 3), review, note


def _region_text(source_pdf: Path, regions: list[Region]) -> str:
    chunks: list[str] = []
    with pdfplumber.open(source_pdf) as pdf:
        for region in regions:
            page = pdf.pages[region.page]
            crop = page.crop((region.x0, region.y0, region.x1, region.y1), strict=False)
            chunks.append(crop.extract_text(x_tolerance=2, y_tolerance=3) or "")
    return "\n".join(chunks)


def _region_text_from_layout(pages: list[dict[str, Any]], regions: list[Region]) -> str:
    """Read coordinate-filtered native text without reopening the source PDF."""
    chunks: list[str] = []
    for region in regions:
        selected = [
            word for word in pages[region.page]["words"]
            if float(word.get("x0", 0)) >= region.x0 - 0.5
            and float(word.get("x1", 0)) <= region.x1 + 0.5
            and float(word.get("top", 0)) >= region.y0 - 0.5
            and float(word.get("bottom", word.get("top", 0))) <= region.y1 + 0.5
        ]
        chunks.append(" ".join(str(word.get("text", "")) for word in selected))
    return "\n".join(chunks)


def _content_fingerprint(reader: PdfReader, regions: list[Region]) -> str:
    parts: list[str] = []
    for region in regions:
        page = reader.pages[region.page]
        contents = page.get_contents()
        raw = contents.get_data() if contents is not None else b""
        content_hash = hashlib.sha256(raw).hexdigest()
        parts.append(
            f"{content_hash}:{region.x0:.3f}:{region.y0:.3f}:{region.x1:.3f}:{region.y1:.3f}"
        )
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


def write_slice(
    source_pdf: Path, regions: list[Region], destination: Path, reader: PdfReader | None = None
) -> tuple[int, str]:
    reader = reader or PdfReader(str(source_pdf), strict=False)
    writer = PdfWriter()
    for region in regions:
        original = reader.pages[region.page]
        writer.add_page(original)
        output_page = writer.pages[-1]
        height = float(original.mediabox.height)
        box = RectangleObject((region.x0, height - region.y1, region.x1, height - region.y0))
        output_page.mediabox = box
        output_page.cropbox = box
        output_page.trimbox = box
    destination.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(prefix=f".{destination.stem}.", suffix=".pdf", dir=destination.parent)
    os.close(handle)
    temp = Path(temp_name)
    try:
        with temp.open("wb") as stream:
            writer.write(stream)
        check = PdfReader(str(temp), strict=False)
        if check.is_encrypted or len(check.pages) != len(regions) or not check.pages:
            raise ValueError("slice failed page-count/encryption validation")
        os.replace(temp, destination)
    finally:
        temp.unlink(missing_ok=True)
    return len(regions), _content_fingerprint(reader, regions)


def _exam_metadata(text: str) -> tuple[str, str]:
    match = EXAM_CODE_RE.search(text)
    if not match:
        return "unknown", "unknown"
    return match.group(0), "HL" if match.group("level").upper() == "H" else "SL"


def _stable_id(subject: str, metadata: dict[str, Any], level: str) -> str:
    timezone = f"tz{metadata['timezone']}" if metadata["timezone"] != "unknown" else "unknown"
    q = metadata["label"].lower()
    return (
        f"{subject}_{metadata['year'] or 'unknown'}_{metadata['session']}_{timezone}_"
        f"{level.lower()}_p{metadata['paper']}_q{q}"
    )


RATE_TERMS = {
    "rate of reaction": 4, "rate equation": 4, "rate constant": 4, "reaction order": 4,
    "activation energy": 3, "arrhenius": 4, "half-life": 2, "catalyst": 2,
    "collision theory": 4, "kinetics": 3, "slow step": 2, "mechanism": 1,
    "concentration-time": 2, "initial rate": 3, "order of reaction": 4,
}
SECONDARY_TERMS = {
    "Reactivity 2.3": ("equilibrium constant", "le chatelier", "dynamic equilibrium", "kc"),
    "Reactivity 1.1": ("enthalpy change", "exothermic", "endothermic"),
    "Reactivity 3.3": ("free radical", "homolytic"),
    "Reactivity 3.4": ("nucleophile", "electrophile", "curly arrow"),
}


def classify(text: str, source_topic: str) -> tuple[str, list[str], float, str, bool]:
    normalized = normalize_text(text)
    evidence = [(term, weight) for term, weight in RATE_TERMS.items() if term in normalized]
    score = sum(weight for _, weight in evidence)
    secondary = [code for code, terms in SECONDARY_TERMS.items() if any(term in normalized for term in terms)]
    if source_topic == "Reactivity 2.2":
        confidence = min(0.99, 0.64 + min(score, 18) / 50)
        rationale = (
            "Mapped to the current Chemistry topic Reactivity 2.2 using the compilation topic as a prior"
            + (f" and content evidence: {', '.join(term for term, _ in evidence[:6])}." if evidence else ".")
        )
        review = score < 2
        return source_topic, secondary, round(confidence, 3), rationale, review
    return source_topic, secondary, 0.55, "Mapped from the source compilation; content-rule expansion is pending.", True


def _load_overrides(path: Path, source_file: str) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [item for item in payload.get("overrides", []) if item.get("source_file") == source_file]


def _apply_override(
    record_id: str, reference_file: str, overrides: list[dict[str, Any]], pages: list[dict[str, Any]]
) -> tuple[list[Region] | None, dict[str, Any] | None]:
    for override in overrides:
        if override.get("question_id") not in (None, record_id) and override.get("reference_file") != reference_file:
            continue
        raw_regions = override.get("regions")
        if not raw_regions:
            return None, override
        regions: list[Region] = []
        for item in raw_regions:
            page = int(item["page"]) - 1
            if not 0 <= page < len(pages):
                raise ValueError(f"override page outside source: {page + 1}")
            width, height = pages[page]["width"], pages[page]["height"]
            x0, y0 = float(item.get("x0", 0)), float(item.get("y0", 0))
            x1, y1 = float(item.get("x1", width)), float(item.get("y1", height))
            if not (0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height):
                raise ValueError(f"invalid override coordinates for {record_id}")
            full = x0 == 0 and y0 == 0 and x1 == width and y1 == height
            regions.append(Region(page, x0, y0, x1, y1, "full-page" if full else "cropped"))
        return regions, override
    return None, None


def _mark_duplicates(records: list[SliceRecord]) -> list[dict[str, Any]]:
    exact: dict[tuple[str, str], SliceRecord] = {}
    report: list[dict[str, Any]] = []
    for record in sorted(records, key=lambda item: item.question_id):
        key = (record.normalized_text_hash, record.visual_fingerprint)
        if key in exact:
            record.duplicate_status = "exact_duplicate"
            record.duplicate_of = exact[key].question_id
            record.status = "exact_duplicate"
            report.append({"left": exact[key].question_id, "right": record.question_id, "relationship": "exact_duplicate", "similarity": 1.0})
        else:
            exact[key] = record
    unique = [record for record in records if record.duplicate_status == "unique" and len(record.extracted_text) > 80]
    # A near-exact pair must share its opening body vocabulary. Bucketing first
    # avoids an expensive and unnecessary all-pairs comparison on full papers.
    buckets: dict[str, list[SliceRecord]] = {}
    for record in unique:
        tokens = re.findall(r"[a-z]{3,}", normalize_text(record.extracted_text))
        key = hashlib.sha256(" ".join(tokens[:16]).encode()).hexdigest()
        buckets.setdefault(key, []).append(record)
    for bucket in buckets.values():
        for index, left in enumerate(bucket):
            for right in bucket[index + 1:]:
                if abs(len(left.extracted_text) - len(right.extracted_text)) > max(len(left.extracted_text), len(right.extracted_text)) * 0.06:
                    continue
                similarity = SequenceMatcher(None, normalize_text(left.extracted_text), normalize_text(right.extracted_text), autojunk=False).ratio()
                if similarity >= 0.985:
                    left.duplicate_status = right.duplicate_status = "likely_duplicate"
                    report.append({"left": left.question_id, "right": right.question_id, "relationship": "likely_duplicate", "similarity": round(similarity, 5)})
    return report


def _write_master(records: list[SliceRecord], destination: Path) -> None:
    writer = PdfWriter()
    expected = 0
    for record in sorted(records, key=lambda item: (
        item.year or 9999, 0 if item.session == "may" else 1, str(item.timezone), str(item.level),
        str(item.paper), int(re.sub(r"\D", "", item.question_number) or 999), item.question_number,
    )):
        if record.duplicate_status == "exact_duplicate" or record.status not in {"success", "boundary_review"}:
            continue
        reader = PdfReader(record.output_pdf, strict=False)
        expected += len(reader.pages)
        writer.append(record.output_pdf, outline_item=record.question_id)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("wb", suffix=".pdf", dir=destination.parent, delete=False) as stream:
        temp = Path(stream.name)
        writer.write(stream)
    try:
        check = PdfReader(str(temp), strict=False)
        if len(check.pages) != expected:
            raise ValueError(f"master page validation failed: {len(check.pages)} != {expected}")
        os.replace(temp, destination)
    finally:
        temp.unlink(missing_ok=True)


def _pdftoppm(explicit: Path | None) -> Path:
    candidates = [explicit, Path(shutil.which("pdftoppm") or "")]
    candidates.extend(Path.home().glob(".cache/codex-runtimes/*/dependencies/native/poppler/Library/bin/pdftoppm.exe"))
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate
    raise FileNotFoundError("pdftoppm was not found; pass --pdftoppm")


def _render_source(source_pdf: Path, render_dir: Path, executable: Path) -> None:
    render_dir.mkdir(parents=True, exist_ok=True)
    command = [str(executable), "-jpeg", "-r", "60", str(source_pdf), str(render_dir / "page")]
    assert_safe_process(command)
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def _render_review_thumbnails(
    records: list[SliceRecord], source_pdf: Path, review_dir: Path, executable: Path
) -> None:
    rendered = review_dir / "source-pages"
    _render_source(source_pdf, rendered, executable)
    thumbnails = review_dir / "thumbnails"
    thumbnails.mkdir(parents=True, exist_ok=True)
    rendered_pages = sorted(rendered.glob("page-*.jpg"))
    for record in records:
        if not record.source_regions:
            continue
        chosen = [("first", record.source_regions[0])]
        if len(record.source_regions) > 1:
            chosen.append(("last", record.source_regions[-1]))
        for label, region in chosen:
            with Image.open(rendered_pages[region.page]) as source:
                # All automatic and override regions use the source page's full
                # width, so x1 also supplies the PDF-to-image scale.
                scale_x = source.width / region.x1
                scale_y = scale_x
                box = (
                    int(region.x0 * scale_x), int(region.y0 * scale_y),
                    int(region.x1 * scale_x), int(region.y1 * scale_y),
                )
                annotated = source.convert("RGB")
                draw = ImageDraw.Draw(annotated)
                draw.rectangle(box, outline=(220, 38, 38), width=4)
                annotated.thumbnail((360, 480))
                annotated.save(thumbnails / f"{record.question_id}_{label}_source.jpg", quality=86)
                cropped = source.crop(box).convert("RGB")
                cropped.thumbnail((430, 560))
                cropped.save(thumbnails / f"{record.question_id}_{label}.jpg", quality=88)


def _write_review_html(records: list[SliceRecord], review_dir: Path) -> None:
    cards: list[str] = []
    for record in records:
        first = f"thumbnails/{record.question_id}_first.jpg"
        last_path = review_dir / "thumbnails" / f"{record.question_id}_last.jpg"
        first_source = f"thumbnails/{record.question_id}_first_source.jpg"
        images = (
            f'<img loading="lazy" src="{html.escape(first_source)}" alt="First source page with crop boundary">'
            f'<img loading="lazy" src="{html.escape(first)}" alt="First cropped page">'
        )
        if last_path.exists():
            images += (
                f'<img loading="lazy" src="thumbnails/{html.escape(record.question_id)}_last_source.jpg" alt="Last source page with crop boundary">'
                f'<img loading="lazy" src="thumbnails/{html.escape(record.question_id)}_last.jpg" alt="Last cropped page">'
            )
        regions = ", ".join(str(region.page + 1) for region in record.source_regions)
        flags = []
        if record.boundary_review_required:
            flags.append("boundary review")
        if record.classification_review_required:
            flags.append("classification review")
        cards.append(f"""
<article><header><strong>{html.escape(record.question_id)}</strong><span>{html.escape(record.status)}</span></header>
<div class="thumbs">{images}</div>
<dl><dt>Source pages</dt><dd>{regions}</dd><dt>Topic</dt><dd>{html.escape(record.primary_topic)}</dd>
<dt>Boundary</dt><dd>{record.boundary_confidence:.3f}</dd><dt>Duplicate</dt><dd>{html.escape(record.duplicate_status)}</dd>
<dt>Review</dt><dd>{html.escape(', '.join(flags) or 'none')}</dd></dl></article>""")
    document = f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Question slice review</title><style>
:root{{color-scheme:dark;font:14px system-ui;background:#0b0c0f;color:#eef0f5}}body{{margin:0;padding:24px}}h1{{margin:0 0 8px}}
p{{color:#aeb5c4}}main{{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}}article{{background:#12141a;border:1px solid #2b2f39;border-radius:12px;overflow:hidden}}header{{display:flex;justify-content:space-between;gap:12px;padding:12px;border-bottom:1px solid #2b2f39}}header span{{color:#9db8ff}}.thumbs{{display:flex;gap:8px;padding:12px;background:#20232b;overflow:auto}}img{{width:280px;height:300px;object-fit:contain;background:white}}dl{{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;padding:12px;margin:0}}dt{{color:#8f98aa}}dd{{margin:0;overflow-wrap:anywhere}}</style>
<h1>Local question-slice review</h1><p>Red crop-boundary source thumbnails are stored beside these cropped previews. No remote operation occurred.</p>
<main>{''.join(cards)}</main></html>"""
    (review_dir / "index.html").write_text(document, encoding="utf-8")


def _write_contact_sheet(records: list[SliceRecord], review_dir: Path) -> None:
    destination = review_dir / "contact_sheet.pdf"
    page_width, page_height = landscape(A4)
    pdf = canvas.Canvas(str(destination), pagesize=(page_width, page_height), invariant=1)
    margin, gap = 24, 12
    card_w = (page_width - margin * 2 - gap) / 2
    card_h = (page_height - margin * 2 - gap) / 2
    for index, record in enumerate(records):
        slot = index % 4
        if slot == 0 and index:
            pdf.showPage()
        col, row = slot % 2, slot // 2
        x = margin + col * (card_w + gap)
        y = page_height - margin - (row + 1) * card_h - row * gap
        pdf.setStrokeColorRGB(0.72, 0.74, 0.79)
        pdf.rect(x, y, card_w, card_h)
        thumb = review_dir / "thumbnails" / f"{record.question_id}_first.jpg"
        if thumb.exists():
            with Image.open(thumb) as image:
                iw, ih = image.size
            max_w, max_h = card_w * 0.58, card_h - 24
            scale = min(max_w / iw, max_h / ih)
            pdf.drawImage(ImageReader(str(thumb)), x + 8, y + 8, iw * scale, ih * scale, preserveAspectRatio=True)
        text_x = x + card_w * 0.61
        pdf.setFont("Helvetica-Bold", 7.5)
        pdf.drawString(text_x, y + card_h - 16, record.question_id[:54])
        pdf.setFont("Helvetica", 7)
        lines = [
            f"Source pages: {','.join(str(r.page + 1) for r in record.source_regions)}",
            f"Topic: {record.primary_topic}",
            f"Boundary: {record.boundary_confidence:.3f}",
            f"Duplicate: {record.duplicate_status}",
            f"Review: {'yes' if record.boundary_review_required or record.classification_review_required else 'no'}",
        ]
        for line_index, line in enumerate(lines):
            pdf.drawString(text_x, y + card_h - 31 - line_index * 11, line[:58])
    pdf.save()


def _write_csv(path: Path, records: Iterable[SliceRecord]) -> None:
    fields = [
        "question_id", "year", "session", "timezone", "level", "paper", "section", "question_number",
        "source_file", "reference_file", "source_regions", "output_pdf", "page_count", "primary_topic",
        "secondary_topics", "classification_confidence", "classification_review_required",
        "boundary_confidence", "boundary_review_required", "duplicate_status", "duplicate_of", "status", "error",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for record in records:
            data = record.as_dict(include_text=False)
            data["source_regions"] = json.dumps(data["source_regions"], ensure_ascii=False)
            data["secondary_topics"] = json.dumps(data["secondary_topics"], ensure_ascii=False)
            writer.writerow({key: data.get(key, "") for key in fields})


def process_compilation(
    repo_root: Path,
    source_pdf: Path,
    reference_dir: Path,
    output_root: Path,
    subject: str,
    source_topic: str,
    pdftoppm: Path | None = None,
) -> dict[str, Any]:
    assert_local_only(repo_root, output_root)
    print(LOCAL_BANNER)
    source_pdf = source_pdf.resolve()
    reference_dir = reference_dir.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    mapping = build_reference_map(source_pdf, reference_dir)
    pages = _layout(source_pdf)
    source_reader = PdfReader(str(source_pdf), strict=False)
    overrides = _load_overrides(repo_root / "config" / "question_slice_overrides.json", source_pdf.name)
    topic_dir = output_root / subject / source_topic
    question_dir = topic_dir / "questions"
    records: list[SliceRecord] = []

    used_ids: set[str] = set()
    for reference, start, end in mapping:
        metadata = _reference_metadata(reference)
        chunk_text = "\n".join(pages[index]["text"] for index in range(start, end))
        exam_code, level = _exam_metadata(chunk_text)
        question_id = _stable_id(subject, metadata, level)
        if question_id in used_ids:
            suffix = hashlib.sha256(reference.name.encode()).hexdigest()[:8]
            question_id = f"{question_id}_{suffix}"
        used_ids.add(question_id)
        regions, confidence, boundary_review, note = detect_regions(pages, start, end, metadata["label"])
        manual_regions, override = _apply_override(question_id, reference.name, overrides, pages)
        if manual_regions:
            regions = manual_regions
            confidence, boundary_review = 1.0, False
            note = "Persistent manual boundary override applied."
        text = _region_text_from_layout(pages, regions)
        primary, secondary, class_confidence, rationale, class_review = classify(text, source_topic)
        if override and override.get("primary_topic"):
            primary = str(override["primary_topic"])
            secondary = list(override.get("secondary_topics", secondary))
            class_confidence, class_review = 1.0, False
            rationale = "Persistent manual classification override applied."
        destination = question_dir / f"{question_id}.pdf"
        try:
            page_count, fingerprint = write_slice(source_pdf, regions, destination, source_reader)
            status = "boundary_review" if boundary_review else "success"
            error = ""
        except Exception as exc:
            page_count, fingerprint = 0, ""
            status, error = "extraction_failed", f"{type(exc).__name__}: {exc}"
        record = SliceRecord(
            question_id=question_id, subject=subject, source_file=source_pdf.name,
            reference_file=reference.name, year=metadata["year"], session=metadata["session"],
            timezone=metadata["timezone"], level=level, paper=metadata["paper"], section=metadata["section"],
            question_number=metadata["label"], examination_code=exam_code, source_regions=regions,
            output_pdf=str(destination.resolve()), page_count=page_count, extracted_text=text,
            boundary_confidence=confidence, boundary_review_required=boundary_review, boundary_note=note,
            primary_topic=primary, secondary_topics=secondary, classification_confidence=class_confidence,
            classification_rationale=rationale, classification_review_required=class_review,
            visual_fingerprint=fingerprint,
            normalized_text_hash=hashlib.sha256(normalize_text(text).encode()).hexdigest(),
            status=status, error=error, manual_note=str((override or {}).get("note", "")),
        )
        if override and override.get("duplicate_status"):
            record.duplicate_status = str(override["duplicate_status"])
        records.append(record)

    duplicate_report = _mark_duplicates(records)
    successful_unique = [r for r in records if r.status == "success" and r.duplicate_status != "exact_duplicate"]
    boundary_reviews = [r for r in records if r.status == "boundary_review"]
    exact_duplicates = [r for r in records if r.duplicate_status == "exact_duplicate"]
    failures = [r for r in records if r.status == "extraction_failed"]
    exclusions = [r for r in records if r.status == "intentionally_excluded"]
    accounted = len(successful_unique) + len(boundary_reviews) + len(exact_duplicates) + len(failures) + len(exclusions)
    if accounted != len(records):
        raise RuntimeError(f"question accounting invariant failed: {accounted} != {len(records)}")

    _write_master(records, topic_dir / "master.pdf")
    ordered = sorted(records, key=lambda item: item.question_id)
    manifest = {
        "mode": "LOCAL-ONLY",
        "coordinate_system": "top-left origin, PDF points",
        "source_pdf": str(source_pdf),
        "source_sha256": hashlib.sha256(source_pdf.read_bytes()).hexdigest(),
        "topic": source_topic,
        "questions": [record.as_dict() for record in ordered],
    }
    atomic_json(topic_dir / "manifest.json", manifest)
    _write_csv(topic_dir / "index.csv", ordered)
    atomic_json(topic_dir / "review.json", [
        record.as_dict() for record in ordered
        if record.boundary_review_required or record.classification_review_required or record.duplicate_status != "unique"
    ])
    reports = output_root / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    atomic_json(reports / "duplicate_report.json", duplicate_report)
    atomic_json(reports / "boundary_review.json", [record.as_dict() for record in boundary_reviews])
    source_page_groups: dict[str, list[int]] = {}
    for index, page in enumerate(source_reader.pages):
        contents = page.get_contents()
        digest = hashlib.sha256(contents.get_data() if contents is not None else b"").hexdigest()
        source_page_groups.setdefault(digest, []).append(index + 1)
    repeated_pages = [pages for pages in source_page_groups.values() if len(pages) > 1]
    atomic_json(reports / "repeated_source_pages.json", repeated_pages)

    review_dir = output_root / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    executable = _pdftoppm(pdftoppm)
    _render_review_thumbnails(ordered, source_pdf, review_dir, executable)
    _write_review_html(ordered, review_dir)
    _write_contact_sheet(ordered, review_dir)

    summary = {
        "mode": "LOCAL-ONLY sample",
        "source_pages": len(pages),
        "detected_questions": len(records),
        "successful_unique_slices": len(successful_unique),
        "exact_duplicates": len(exact_duplicates),
        "boundary_review_items": len(boundary_reviews),
        "extraction_failures": len(failures),
        "intentional_exclusions": len(exclusions),
        "classification_review_items": sum(record.classification_review_required for record in records),
        "likely_duplicate_pairs": sum(item["relationship"] == "likely_duplicate" for item in duplicate_report),
        "repeated_source_page_groups": len(repeated_pages),
        "accounting_invariant": {
            "holds": accounted == len(records),
            "equation": "detected = successful unique + exact duplicates + boundary review + extraction failures + intentional exclusions",
            "detected": len(records), "accounted": accounted,
        },
        "source_page_alignment": f"{len(pages)}/{len(pages)} pages matched local provenance chunks",
        "topic_master": str((topic_dir / "master.pdf").resolve()),
        "review_html": str((review_dir / "index.html").resolve()),
        "contact_sheet": str((review_dir / "contact_sheet.pdf").resolve()),
    }
    atomic_json(reports / "run_summary.json", summary)
    (reports / "run_summary.md").write_text(
        "# Local question-slice sample\n\n"
        + "\n".join(f"- {key.replace('_', ' ').title()}: {value}" for key, value in summary.items() if not isinstance(value, dict))
        + "\n\nNo question page was recreated. No R2 upload, deployment, remote write, commit, or push occurred.\n",
        encoding="utf-8",
    )
    return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Losslessly slice a local compiled question PDF.")
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--reference-dir", type=Path, required=True, help="Local provenance chunks used for metadata and alignment.")
    parser.add_argument("--subject", required=True, choices=["chemistry", "physics", "biology", "mathematics_aa", "mathematics_ai"])
    parser.add_argument("--source-topic", required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("output/local_topic_questions/sample"))
    parser.add_argument("--pdftoppm", type=Path)
    parser.add_argument("--local-only", action="store_true", default=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo_root = Path(__file__).resolve().parents[2]
    output = args.output_dir if args.output_dir.is_absolute() else repo_root / args.output_dir
    summary = process_compilation(
        repo_root, args.source_pdf, args.reference_dir, output.resolve(), args.subject,
        args.source_topic, args.pdftoppm,
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
