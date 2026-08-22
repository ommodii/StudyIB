from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image
from pypdf import PdfReader
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .classify import classify_question, load_manual_overrides
from .dedupe import mark_duplicates
from .inventory import parse_paper_metadata
from .local_guard import LOCAL_BANNER, assert_local_only, assert_safe_process
from .models import PaperRecord, QuestionRecord
from .pdf_extract import extract_questions
from .reporting import atomic_json, build_topic_outputs, topic_directory, write_reports
from .taxonomy import Taxonomy, load_taxonomy


@dataclass(frozen=True)
class SubjectSource:
    subject: str
    topic_root: Path
    paper_root: Path


@dataclass(frozen=True)
class PageCandidate:
    path: str
    page_index: int


def _stream_bytes(page: Any) -> bytes:
    raw = page.get("/Contents")
    if raw is None:
        return b""
    raw = raw.get_object() if hasattr(raw, "get_object") else raw
    if isinstance(raw, list):
        parts: list[bytes] = []
        for item in raw:
            item = item.get_object() if hasattr(item, "get_object") else item
            try:
                parts.append(item.get_data())
            except Exception:
                parts.append(getattr(item, "_data", b""))
        return b"".join(parts)
    try:
        return raw.get_data()
    except Exception:
        return getattr(raw, "_data", b"")


def page_fingerprint(page: Any) -> str:
    data = _stream_bytes(page)
    return hashlib.sha256(data).hexdigest() if data else "empty"


def _is_english_question_paper(path: Path, subject: str) -> bool:
    record = parse_paper_metadata(path, subject)
    return record.role == "question_paper" and record.language == "EN"


def _canonical_masters(root: Path) -> list[Path]:
    return sorted(
        (path for path in root.rglob("*.pdf") if not re.search(r" \d+\.pdf$", path.name)),
        key=lambda path: path.as_posix().lower(),
    )


def _build_page_index(source: SubjectSource, cache_dir: Path) -> dict[str, list[PageCandidate]]:
    cache_path = cache_dir / "page-index" / f"{source.subject}.json"
    paths = sorted(
        (path for path in source.paper_root.rglob("*.pdf") if _is_english_question_paper(path, source.subject)),
        key=lambda path: path.as_posix().lower(),
    )
    signature = hashlib.sha256(
        "|".join(f"{path}:{path.stat().st_size}:{path.stat().st_mtime_ns}" for path in paths).encode()
    ).hexdigest()
    if cache_path.exists():
        try:
            payload = json.loads(cache_path.read_text(encoding="utf-8"))
            if payload.get("signature") == signature:
                return {
                    key: [PageCandidate(**item) for item in values]
                    for key, values in payload.get("pages", {}).items()
                }
        except (OSError, json.JSONDecodeError, TypeError):
            pass
    index: dict[str, list[PageCandidate]] = defaultdict(list)
    for path in paths:
        try:
            for page_index, page in enumerate(PdfReader(str(path), strict=False).pages):
                fingerprint = page_fingerprint(page)
                if fingerprint != "empty":
                    index[fingerprint].append(PageCandidate(str(path.resolve()), page_index))
        except Exception:
            continue
    atomic_json(cache_path, {
        "signature": signature,
        "pages": {key: [vars(item) for item in values] for key, values in index.items()},
    })
    return dict(index)


def _candidate_rank(candidate: PageCandidate, subject: str) -> tuple[Any, ...]:
    record = parse_paper_metadata(Path(candidate.path), subject)
    return (
        record.specimen,
        record.year is None,
        record.timezone == "UNKNOWN",
        record.level == "UNKNOWN",
        candidate.path.lower(),
        candidate.page_index,
    )


def _collect_selected_pages(
    source: SubjectSource,
    index: dict[str, list[PageCandidate]],
) -> tuple[dict[str, dict[int, list[str]]], list[dict[str, Any]], dict[str, Any]]:
    selected: dict[str, dict[int, list[str]]] = defaultdict(lambda: defaultdict(list))
    unmatched: list[dict[str, Any]] = []
    stats = Counter()
    for master in _canonical_masters(source.topic_root):
        hint = " / ".join((*master.relative_to(source.topic_root).parts[:-1], master.stem))
        try:
            reader = PdfReader(str(master), strict=False)
        except Exception as exc:
            unmatched.append({"master": str(master), "page": None, "error": f"{type(exc).__name__}: {exc}"})
            continue
        stats["masters"] += 1
        for page_index, page in enumerate(reader.pages):
            stats["master_pages"] += 1
            candidates = index.get(page_fingerprint(page), [])
            if not candidates:
                stats["unmatched_pages"] += 1
                unmatched.append({"master": str(master), "page": page_index + 1})
                continue
            chosen = sorted(candidates, key=lambda item: _candidate_rank(item, source.subject))[0]
            selected[chosen.path][chosen.page_index].append(hint)
            stats["matched_pages"] += 1
            if len(candidates) > 1:
                stats["ambiguous_exact_matches"] += 1
    return selected, unmatched, dict(stats)


def _normalize(value: str) -> str:
    value = re.sub(r"\([^)]*\)", " ", value.lower())
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


STOPWORDS = {
    "topic", "paper", "option", "the", "and", "of", "in", "to", "a", "an", "models",
    "what", "how", "from", "for", "with", "only", "ahl", "sl", "hl",
}


MATH_SOURCE_TOPIC_CANDIDATES: dict[str, set[str]] = {
    "1 1 sequences and series": {"AA 1.2", "AA 1.3", "AA 1.4", "AA 1.8"},
    "1 2 exponents and logarithms": {"AA 1.1", "AA 1.5", "AA 1.7", "AA 2.9"},
    "1 3 binomial theorem": {"AA 1.9", "AA 1.10"},
    "1 4 complex numbers": {"AA 1.12", "AA 1.13", "AA 1.14"},
    "1 5 proof": {"AA 1.6", "AA 1.15"},
    "1 6 systems of equations": {"AA 1.11", "AA 1.16"},
    "2 1 linear and quadratic functions": {"AA 2.1", "AA 2.6", "AA 2.7"},
    "2 2 function concepts and graphs": {"AA 2.2", "AA 2.3", "AA 2.4", "AA 2.5", "AA 2.9", "AA 2.10"},
    "2 3 polynomials and rational functions": {"AA 1.11", "AA 2.8", "AA 2.12", "AA 2.13"},
    "2 4 transformations of functions": {"AA 2.11"},
    "2 5 modulus and advanced functions": {"AA 2.14", "AA 2.15", "AA 2.16"},
    "3 1 2d and 3d geometry": {"AA 3.1", "AA 3.2", "AA 3.3"},
    "3 2 circular functions and trigonometry": {"AA 3.4", "AA 3.5", "AA 3.6", "AA 3.7", "AA 3.8"},
    "3 3 advanced trigonometry": {"AA 3.9", "AA 3.10", "AA 3.11"},
    "3 4 vectors": {"AA 3.12", "AA 3.13", "AA 3.14", "AA 3.15", "AA 3.16", "AA 3.17", "AA 3.18"},
    "4 1 descriptive statistics": {"AA 4.1", "AA 4.2", "AA 4.3", "AA 4.4", "AA 4.10"},
    "4 3 probability": {"AA 4.5", "AA 4.6", "AA 4.11", "AA 4.13"},
    "4 4 probability distributions": {"AA 4.7", "AA 4.8", "AA 4.9", "AA 4.12"},
    "4 5 continuous random variables and poisson": {"AA 4.14"},
    "5 1 differential calculus": {"AA 5.1", "AA 5.2", "AA 5.3", "AA 5.4", "AA 5.6", "AA 5.7", "AA 5.8", "AA 5.9"},
    "5 2 integral calculus": {"AA 5.5", "AA 5.10", "AA 5.11"},
    "5 3 advanced calculus": {"AA 5.12", "AA 5.13", "AA 5.14", "AA 5.15", "AA 5.16", "AA 5.17", "AA 5.18", "AA 5.19"},
}


def _tokens(value: str) -> set[str]:
    return {token for token in _normalize(value).split() if token not in STOPWORDS and not token.isdigit()}


def math_source_candidates(hints: list[str]) -> set[str]:
    candidates: set[str] = set()
    for hint in hints:
        leaf = _normalize(hint.split(" / ")[-1])
        candidates.update(MATH_SOURCE_TOPIC_CANDIDATES.get(leaf, set()))
    return candidates


def topic_priors(hints: list[str], taxonomy: Taxonomy, allowed_codes: set[str] | None = None) -> dict[str, float]:
    scores: dict[str, float] = defaultdict(float)
    for hint in hints:
        hint_norm = _normalize(hint)
        leaf = _normalize(hint.split(" / ")[-1])
        hint_tokens = _tokens(leaf)
        for topic in taxonomy.topics:
            if allowed_codes is not None and topic["code"] not in allowed_codes:
                continue
            best = 0.0
            for candidate in [topic["title"], topic["parent"], *topic["legacy_topic_mappings"]]:
                candidate_norm = _normalize(candidate)
                candidate_tokens = _tokens(candidate)
                if candidate_norm and (candidate_norm in hint_norm or leaf in candidate_norm):
                    best = max(best, 1.0)
                if hint_tokens and candidate_tokens:
                    best = max(best, len(hint_tokens & candidate_tokens) / len(hint_tokens | candidate_tokens))
            if best >= 0.42:
                scores[topic["code"]] += best
    return dict(scores)


def classify_with_priors(
    question: QuestionRecord,
    taxonomy: Taxonomy,
    hints: list[str],
    confidence_threshold: float,
    manual_overrides: dict[str, dict[str, Any]] | None = None,
) -> None:
    manual_overrides = manual_overrides or {}
    if question.question_id in manual_overrides:
        classify_question(question, taxonomy, confidence_threshold, manual_overrides)
        return

    source_codes = math_source_candidates(hints) if question.subject == "mathematics" else None
    # The legacy Mathematics compilations are useful provenance, but the audit
    # found many questions filed under the wrong broad compilation. Never use
    # those labels as a hard classification constraint.
    classify_question(question, taxonomy, confidence_threshold, manual_overrides)
    rule_primary, rule_confidence = question.primary_topic, question.confidence
    ranked = sorted(topic_priors(hints, taxonomy, source_codes or None).items(), key=lambda item: (-item[1], item[0]))

    # Poisson distributions were removed from the current AA syllabus. Exclude
    # a Poisson-only legacy question, but retain a mixed structured question
    # when another current-syllabus topic is independently detected.
    if (
        question.subject == "mathematics"
        and "poisson" in question.normalized_text
        and (not rule_primary or rule_primary.startswith("AA 4."))
    ):
        question.primary_topic = None
        question.secondary_topics = []
        question.confidence = 1.0
        question.classification_method = "current_syllabus_exclusion"
        question.rationale = "Poisson-distribution content is not part of the current Mathematics AA syllabus."
        question.review_required = False
        question.status = "intentionally_excluded"
        return

    if question.subject == "mathematics" and not rule_primary:
        if len(source_codes or ()) == 1:
            question.primary_topic = next(iter(source_codes))
            question.confidence = 0.88
            question.classification_method = "single_compilation_candidate"
            question.rationale = "The source compilation maps to one current AA syllabus statement."
            question.review_required = False
            question.status = "included"
        else:
            question.primary_topic = None
            question.secondary_topics = []
            question.confidence = 0.0
            question.classification_method = "detailed_topic_review_required"
            question.rationale = "The broad source compilation maps to multiple current AA syllabus statements and text evidence was not decisive."
            question.review_required = True
            question.status = "awaiting_review"
        return
    if ranked:
        best_code, best_score = ranked[0]
        second_score = ranked[1][1] if len(ranked) > 1 else 0.0
        if rule_primary in dict(ranked):
            question.confidence = round(max(rule_confidence, min(0.97, 0.78 + best_score * 0.12)), 4)
            question.rationale += f" Source compilation also maps to {rule_primary}."
            question.review_required = question.confidence < confidence_threshold
        elif rule_primary:
            question.classification_method = "content_rules_over_legacy_compilation"
            question.rationale += f" Content evidence overrides mismatched legacy compilation hint {best_code}."
            question.review_required = rule_confidence < confidence_threshold
        elif best_score > second_score + 0.18:
            if rule_primary and rule_primary != best_code:
                question.secondary_topics = list(dict.fromkeys([rule_primary, *question.secondary_topics]))
            question.primary_topic = best_code
            question.confidence = round(min(0.91, 0.64 + best_score * 0.18), 4)
            question.classification_method = "content_rules_with_compilation_prior"
            question.rationale = f"Current topic {best_code} selected from compilation mapping; content candidate was {rule_primary or 'none'}."
            question.review_required = rule_primary not in {None, best_code} or question.confidence < confidence_threshold
        else:
            question.primary_topic = rule_primary or best_code
            question.confidence = round(max(rule_confidence, 0.58), 4)
            question.classification_method = "ambiguous_compilation_prior"
            question.rationale += " Multiple current-topic mappings remain plausible."
            question.review_required = True
    question.status = "included" if question.primary_topic and not question.review_required else "awaiting_review"
    if not question.primary_topic:
        question.review_required = True


def _taxonomy_key(question: QuestionRecord) -> tuple[str, str]:
    return question.subject, question.course if question.subject == "mathematics" else "NONE"


def _load_taxonomies(repo_root: Path) -> dict[tuple[str, str], Taxonomy]:
    config = repo_root / "config" / "curricula"
    return {
        ("physics", "NONE"): load_taxonomy(config, "physics"),
        ("chemistry", "NONE"): load_taxonomy(config, "chemistry"),
        ("biology", "NONE"): load_taxonomy(config, "biology"),
        ("mathematics", "aa"): load_taxonomy(config, "mathematics", "aa"),
        ("mathematics", "ai"): load_taxonomy(config, "mathematics", "ai"),
    }


def _sources(repo_root: Path) -> dict[str, SubjectSource]:
    return {
        "physics": SubjectSource("physics", repo_root / "Content" / "Sorted_Topics", repo_root / "Content" / "Exam_Papers" / "IB_Physics"),
        "chemistry": SubjectSource("chemistry", repo_root / "Content" / "Sorted_Topics_Chemistry", repo_root / "Content" / "Exam_Papers" / "IB_Chemistry"),
        "biology": SubjectSource("biology", repo_root / "Content" / "Sorted_Topics_Biology", repo_root / "Content" / "IB_Biology"),
        "mathematics": SubjectSource("mathematics", repo_root / "Content" / "Sorted_Topics_Math", repo_root / "Content" / "IB_Math"),
    }


def _pdftoppm(explicit: Path | None) -> Path:
    candidates = [explicit, Path(shutil.which("pdftoppm") or "")]
    candidates.extend(Path.home().glob(".cache/codex-runtimes/*/dependencies/native/poppler/Library/bin/pdftoppm.exe"))
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate
    raise FileNotFoundError("pdftoppm not found; pass --pdftoppm")


def _render_topic_review(
    output_dir: Path,
    taxonomy: Taxonomy,
    code: str,
    records: list[QuestionRecord],
    executable: Path,
) -> dict[str, Any]:
    directory = topic_directory(output_dir, taxonomy, code)
    master = directory / "master.pdf"
    if not master.exists() or not records:
        return {"topic": code, "rendered": 0}
    review_dir, pages_dir = directory / "review", directory / "review" / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    command = [str(executable), "-jpeg", "-r", "45", str(master), str(pages_dir / "page")]
    assert_safe_process(command)
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    def page_number(path: Path) -> int:
        match = re.search(r"-(\d+)$", path.stem)
        return int(match.group(1)) if match else 0

    page_images = sorted(pages_dir.glob("page-*.jpg"), key=page_number)
    ordered = sorted(records, key=lambda item: item.order_key())
    entries, cursor = [], 0
    for record in ordered:
        last = cursor + max(record.page_count, 1) - 1
        entries.append((record, cursor, last))
        cursor = last + 1
    cards: list[str] = []
    for record, first, last in entries:
        first_rel = page_images[first].relative_to(review_dir).as_posix() if first < len(page_images) else ""
        last_rel = page_images[last].relative_to(review_dir).as_posix() if last < len(page_images) else first_rel
        images = f'<img loading="lazy" src="{html.escape(first_rel)}" alt="First page">'
        if last_rel != first_rel:
            images += f'<img loading="lazy" src="{html.escape(last_rel)}" alt="Last page">'
        cards.append(
            f'<article><strong>{html.escape(record.question_id)}</strong><div>{images}</div>'
            f'<p>Source pages: {record.source_pages}<br>Confidence: {record.confidence:.3f}'
            f'<br>Review: {"yes" if record.review_required else "no"}</p></article>'
        )
    (review_dir / "index.html").write_text(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        '<style>:root{color-scheme:dark;font:14px system-ui;background:#0b0c0f;color:#eee}body{margin:24px}'
        'main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}article{border:1px solid #30343d;'
        'border-radius:10px;padding:12px;background:#14161b}article div{display:flex;gap:8px;overflow:auto}img{width:46%;height:280px;'
        'object-fit:contain;background:white}p{color:#b6bdca}</style>'
        f'<h1>{html.escape(code)} review</h1><main>{"".join(cards)}</main>', encoding="utf-8"
    )
    contact = canvas.Canvas(str(review_dir / "contact_sheet.pdf"), pagesize=landscape(A4), invariant=1)
    width, height = landscape(A4)
    margin, gap = 24, 12
    card_w, card_h = (width - margin * 2 - gap) / 2, (height - margin * 2 - gap) / 2
    for index, (record, first, _) in enumerate(entries):
        if index and index % 4 == 0:
            contact.showPage()
        slot, image_path = index % 4, page_images[first] if first < len(page_images) else None
        x = margin + (slot % 2) * (card_w + gap)
        y = height - margin - ((slot // 2) + 1) * card_h - (slot // 2) * gap
        contact.rect(x, y, card_w, card_h)
        if image_path:
            with Image.open(image_path) as image:
                iw, ih = image.size
            scale = min((card_w * 0.58) / iw, (card_h - 18) / ih)
            contact.drawImage(ImageReader(str(image_path)), x + 6, y + 6, iw * scale, ih * scale, preserveAspectRatio=True)
        tx = x + card_w * 0.61
        contact.setFont("Helvetica-Bold", 7.5)
        contact.drawString(tx, y + card_h - 16, record.question_id[:52])
        contact.setFont("Helvetica", 7)
        for line_index, line in enumerate((f"Pages: {record.source_pages}", f"Confidence: {record.confidence:.3f}", f"Review: {'yes' if record.review_required else 'no'}")):
            contact.drawString(tx, y + card_h - 31 - line_index * 11, line[:56])
    contact.save()
    return {"topic": code, "rendered": len(entries), "master_pages": len(page_images)}


def run_production(
    repo_root: Path,
    output_dir: Path,
    cache_dir: Path,
    subjects: list[str],
    confidence_threshold: float,
    pdftoppm: Path | None,
    generate_review: bool,
) -> dict[str, Any]:
    assert_local_only(repo_root, output_dir)
    print(LOCAL_BANNER)
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    sources, taxonomies = _sources(repo_root), _load_taxonomies(repo_root)
    manual_overrides = load_manual_overrides(repo_root / "config" / "manual_overrides.json")
    questions: list[QuestionRecord] = []
    paper_by_path: dict[str, PaperRecord] = {}
    inventory: list[PaperRecord] = []
    failures: list[dict[str, str]] = []
    audits: dict[str, Any] = {}

    for subject in subjects:
        source = sources[subject]
        print(f"[{subject}] indexing original paper pages")
        index = _build_page_index(source, cache_dir)
        selected, unmatched, stats = _collect_selected_pages(source, index)
        audits[subject] = {**stats, "selected_papers": len(selected), "unmatched": unmatched}
        print(f"[{subject}] {stats.get('matched_pages', 0)}/{stats.get('master_pages', 0)} compilation pages traced")
        for number, (path_string, selected_pages) in enumerate(sorted(selected.items()), 1):
            path = Path(path_string)
            paper = parse_paper_metadata(path, subject)
            if subject == "mathematics" and paper.course == "UNKNOWN":
                paper.course = "aa"
                paper.reason = (paper.reason + "; " if paper.reason else "") + "legacy Mathematics mapped to AA for review"
            paper.file_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            try:
                paper.page_count = len(PdfReader(str(path), strict=False).pages)
            except Exception as exc:
                paper.inventory_status = "failed"
                paper.reason = f"PDF open failed: {type(exc).__name__}: {exc}"
                inventory.append(paper)
                failures.append({"source_path": path_string, "status": "failed", "error": paper.reason, "reason": paper.reason})
                continue
            inventory.append(paper)
            paper_by_path[path_string] = paper
            extracted, failure = extract_questions(
                paper, output_dir / "_raw", cache_dir, dry_run=False, boundary_overrides=manual_overrides
            )
            if failure:
                paper.inventory_status = "failed"
                paper.reason = failure
                failures.append({"source_path": path_string, "status": "failed", "error": failure, "reason": failure})
                continue
            paper.inventory_status = "processed"
            selected_set = set(selected_pages)
            for question in extracted:
                region_pages = {region.page_index for region in question.regions}
                if not region_pages & selected_set:
                    continue
                hints = [hint for page_index in region_pages & selected_set for hint in selected_pages[page_index]]
                classify_with_priors(
                    question, taxonomies[_taxonomy_key(question)], hints, confidence_threshold, manual_overrides
                )
                question.manual_note = "Source compilation hints: " + " | ".join(sorted(set(hints)))
                questions.append(question)
            if number % 25 == 0:
                print(f"[{subject}] processed {number}/{len(selected)} traced papers")

    duplicates = mark_duplicates(questions)
    validations = build_topic_outputs(output_dir, taxonomies, questions, paper_by_path, False, False)
    summary = write_reports(output_dir, inventory, questions, duplicates, validations, failures, False)
    atomic_json(output_dir / "reports" / "source_page_audit.json", audits)

    review_results: list[dict[str, Any]] = []
    if generate_review:
        executable = _pdftoppm(pdftoppm)
        grouped: dict[tuple[str, str, str], list[QuestionRecord]] = defaultdict(list)
        for question in questions:
            if question.status == "included" and question.duplicate_status != "exact_duplicate" and question.primary_topic:
                grouped[(*_taxonomy_key(question), question.primary_topic)].append(question)
        for (subject, course, code), records in sorted(grouped.items()):
            review_results.append(_render_topic_review(output_dir, taxonomies[(subject, course)], code, records, executable))
        atomic_json(output_dir / "reports" / "review_render_summary.json", review_results)

    production = {
        **summary,
        "subjects": subjects,
        "source_audits": {key: {k: v for k, v in value.items() if k != "unmatched"} for key, value in audits.items()},
        "questions_with_manual_review": sum(question.review_required for question in questions),
        "review_topics_rendered": len(review_results),
        "remote_operations": 0,
    }
    atomic_json(output_dir / "reports" / "production_summary.json", production)
    return production


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build the complete local-only IB question corpus.")
    parser.add_argument("--subjects", nargs="+", choices=["physics", "chemistry", "biology", "mathematics", "all"], default=["all"])
    parser.add_argument("--output-dir", type=Path, default=Path("output/local_topic_questions/production"))
    parser.add_argument("--cache-dir", type=Path, default=Path(".topic-papers-cache/production"))
    parser.add_argument("--confidence-threshold", type=float, default=0.80)
    parser.add_argument("--pdftoppm", type=Path)
    parser.add_argument("--skip-review-render", action="store_true")
    parser.add_argument("--local-only", action="store_true", default=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo_root = Path(__file__).resolve().parents[2]
    output = args.output_dir if args.output_dir.is_absolute() else repo_root / args.output_dir
    cache = args.cache_dir if args.cache_dir.is_absolute() else repo_root / args.cache_dir
    subjects = ["physics", "chemistry", "biology", "mathematics"] if "all" in args.subjects else list(dict.fromkeys(args.subjects))
    result = run_production(repo_root, output.resolve(), cache.resolve(), subjects, args.confidence_threshold, args.pdftoppm, not args.skip_review_render)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
