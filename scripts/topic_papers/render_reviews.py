from __future__ import annotations

import argparse
import csv
import html
import json
import subprocess
from pathlib import Path

from PIL import Image
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .models import PageRegion, QuestionRecord
from .production import _load_taxonomies, _pdftoppm, _render_topic_review
from .reporting import atomic_json


def _record(data: dict) -> QuestionRecord:
    fields = set(QuestionRecord.__dataclass_fields__)
    values = {key: value for key, value in data.items() if key in fields}
    values["regions"] = [PageRegion(**region) if isinstance(region, dict) else region for region in values.get("regions", [])]
    return QuestionRecord(**values)


def _render_unclassified(output_dir: Path, executable: Path) -> dict[str, int]:
    report = output_dir / "reports" / "unclassified_questions.csv"
    rows = list(csv.DictReader(report.open(encoding="utf-8-sig")))
    review = output_dir / "review" / "unclassified"
    thumbs = review / "thumbnails"
    thumbs.mkdir(parents=True, exist_ok=True)
    rendered: list[tuple[dict[str, str], Path]] = []
    for row in rows:
        destination = thumbs / f"{row['question_id']}.jpg"
        command = [str(executable), "-f", "1", "-singlefile", "-jpeg", "-r", "45", row["output_path"], str(destination.with_suffix(""))]
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        rendered.append((row, destination))
    width, height = landscape(A4)
    pdf = canvas.Canvas(str(review / "contact_sheet.pdf"), pagesize=(width, height), invariant=1)
    margin, gap = 24, 12
    card_w, card_h = (width - margin * 2 - gap) / 2, (height - margin * 2 - gap) / 2
    for index, (row, image_path) in enumerate(rendered):
        if index and index % 4 == 0:
            pdf.showPage()
        slot = index % 4
        x = margin + (slot % 2) * (card_w + gap)
        y = height - margin - ((slot // 2) + 1) * card_h - (slot // 2) * gap
        pdf.rect(x, y, card_w, card_h)
        with Image.open(image_path) as image:
            iw, ih = image.size
        scale = min((card_w * 0.58) / iw, (card_h - 18) / ih)
        pdf.drawImage(ImageReader(str(image_path)), x + 6, y + 6, iw * scale, ih * scale, preserveAspectRatio=True)
        pdf.setFont("Helvetica-Bold", 7.5)
        pdf.drawString(x + card_w * 0.61, y + card_h - 16, row["question_id"][:52])
        pdf.setFont("Helvetica", 7)
        pdf.drawString(x + card_w * 0.61, y + card_h - 31, f"Pages: {row['source_pages']}"[:56])
    pdf.save()
    return {"unclassified_rendered": len(rendered)}


def render_existing(repo_root: Path, output_dir: Path, explicit_poppler: Path | None) -> dict[str, object]:
    executable = _pdftoppm(explicit_poppler)
    taxonomies = _load_taxonomies(repo_root)
    results = []
    for manifest_path in sorted(output_dir.rglob("manifest.json")):
        if "_raw" in manifest_path.parts:
            continue
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        topic = payload.get("topic", {})
        code = topic.get("code")
        records = [_record(item) for item in payload.get("questions", [])]
        if not code or not records:
            continue
        subject = records[0].subject
        course = records[0].course if subject == "mathematics" else "NONE"
        result = _render_topic_review(output_dir, taxonomies[(subject, course)], code, records, executable)
        result["subject"] = subject
        result["review_index"] = (manifest_path.parent / "review" / "index.html").relative_to(output_dir).as_posix()
        results.append(result)
    unclassified = _render_unclassified(output_dir, executable)
    summary = {"topics": len(results), "questions_rendered": sum(item["rendered"] for item in results), **unclassified}
    review_root = output_dir / "review"
    review_root.mkdir(parents=True, exist_ok=True)
    links = "".join(
        f'<li><a href="../{html.escape(item["review_index"])}">'
        f'{html.escape(item["subject"].title())} — {html.escape(item["topic"])}</a> '
        f'<span>{item["rendered"]} questions</span></li>'
        for item in sorted(results, key=lambda value: (value["subject"], value["topic"]))
    )
    (review_root / "index.html").write_text(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        '<title>Local production review</title><style>:root{color-scheme:dark;font:15px system-ui;background:#0b0c0f;color:#eee}'
        'body{max-width:900px;margin:32px auto;padding:0 20px}a{color:#8ab4ff}li{margin:9px 0;padding:10px 12px;'
        'border:1px solid #30343d;border-radius:8px;background:#14161b}span{float:right;color:#aab2c0}</style>'
        f'<h1>Local production review</h1><p>{summary["questions_rendered"]} classified questions across '
        f'{summary["topics"]} topic masters. <a href="unclassified/contact_sheet.pdf">Review '
        f'{summary["unclassified_rendered"]} unclassified questions</a>.</p><ul>{links}</ul></html>',
        encoding="utf-8",
    )
    atomic_json(output_dir / "reports" / "review_render_summary.json", {"summary": summary, "topics": results})
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=Path("output/local_topic_questions/production"))
    parser.add_argument("--pdftoppm", type=Path)
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    output = args.output_dir if args.output_dir.is_absolute() else repo_root / args.output_dir
    print(json.dumps(render_existing(repo_root, output.resolve(), args.pdftoppm), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
