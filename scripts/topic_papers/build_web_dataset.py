from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any


SUBJECT_IDS = {
    "physics": "physics",
    "chemistry": "chemistry",
    "biology": "biology",
    "mathematics": "math",
}


def _slug(value: str) -> str:
    return "".join(character if character.isalnum() else "_" for character in value).strip("_").lower()


def _content_type(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        return "application/pdf"
    if path.suffix.lower() == ".json":
        return "application/json"
    return "application/octet-stream"


def _file_entry(local_path: Path, object_key: str) -> dict[str, Any]:
    digest = hashlib.sha256()
    with local_path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return {
        "local_path": str(local_path.resolve()),
        "object_key": object_key,
        "size": local_path.stat().st_size,
        "sha256": digest.hexdigest(),
        "content_type": _content_type(local_path),
    }


def build(repo_root: Path, corpus_root: Path, version: str, js_output: Path) -> dict[str, Any]:
    prefix = f"Content/TopicQuestionBank/{version}"
    syllabus: dict[str, dict[str, dict[str, list[dict[str, str]]]]] = {
        subject: {} for subject in SUBJECT_IDS.values()
    }
    practice: dict[str, dict[str, dict[str, list[dict[str, Any]]]]] = {
        subject: {} for subject in SUBJECT_IDS.values()
    }
    uploads: list[dict[str, Any]] = []
    topic_catalog: list[dict[str, Any]] = []
    question_total = 0

    manifests = sorted(
        path for path in corpus_root.rglob("manifest.json")
        if "_raw" not in path.parts
    )
    for manifest_path in manifests:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        questions = payload.get("questions", [])
        topic = payload.get("topic", {})
        if not questions or not topic.get("code"):
            continue
        corpus_subject = questions[0]["subject"]
        subject = SUBJECT_IDS[corpus_subject]
        code = str(topic["code"])
        title = str(topic.get("title") or code)
        category = str(topic.get("parent") or "Topics")
        subtopic = f"{code} {title}"
        topic_slug = _slug(code)

        master_path = manifest_path.parent / "master.pdf"
        master_key = f"{prefix}/{subject}/topics/{topic_slug}/master.pdf"
        syllabus[subject].setdefault(category, {})[subtopic] = [{
            "filename": f"{subtopic}.pdf",
            "filepath": master_key,
        }]
        uploads.append(_file_entry(master_path, master_key))

        web_questions: list[dict[str, Any]] = []
        for question in questions:
            question_id = question["question_id"]
            local_path = manifest_path.parent / "questions" / f"{question_id}.pdf"
            object_key = f"{prefix}/{subject}/questions/{question_id}.pdf"
            source_path = Path(question["source_path"])
            try:
                full_paper_path = source_path.resolve().relative_to(repo_root.resolve()).as_posix()
            except ValueError:
                full_paper_path = ""
            source_parts = [
                str(question.get("year") or "Unknown year"),
                str(question.get("session") or "").title(),
                str(question.get("timezone") or "").upper(),
                str(question.get("level") or "").upper(),
                str(question.get("paper") or "").upper(),
            ]
            source = " ".join(part for part in source_parts if part and part != "UNKNOWN")
            pages = [int(page) for page in question.get("source_pages", [])]
            pages_label = "-".join(map(str, (pages[0], pages[-1]))) if pages else "unknown"
            web_questions.append({
                "filename": f"{question_id}.pdf",
                "filepath": object_key,
                "source": source,
                "qnum": str(question.get("question_number") or "?"),
                "paper_type": str(question.get("paper") or "UNKNOWN").upper(),
                "full_paper_path": full_paper_path,
                "pages": pages_label,
            })
            uploads.append(_file_entry(local_path, object_key))
            question_total += 1

        practice[subject].setdefault(category, {})[subtopic] = web_questions
        topic_catalog.append({
            "subject": subject,
            "category": category,
            "code": code,
            "title": title,
            "question_count": len(web_questions),
            "master_pdf": master_key,
        })

    metadata = {
        "version": version,
        "prefix": prefix,
        "topic_count": len(topic_catalog),
        "question_count": question_total,
        "subjects": {subject: sum(1 for topic in topic_catalog if topic["subject"] == subject) for subject in syllabus},
    }
    js_output.parent.mkdir(parents=True, exist_ok=True)
    js_output.write_text(
        "const topicQuestionBankMetadata = " + json.dumps(metadata, separators=(",", ":")) + ";\n"
        "const topicQuestionSyllabusData = " + json.dumps(syllabus, separators=(",", ":")) + ";\n"
        "const topicQuestionPracticeData = " + json.dumps(practice, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )

    web_dir = corpus_root / "web"
    web_dir.mkdir(parents=True, exist_ok=True)
    catalog_path = web_dir / "catalog.json"
    catalog = {"metadata": metadata, "topics": topic_catalog}
    catalog_path.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    uploads.append(_file_entry(catalog_path, f"{prefix}/catalog.json"))
    upload_manifest = {
        "version": version,
        "prefix": prefix,
        "bucket": "studyib-content",
        "object_count": len(uploads),
        "total_bytes": sum(item["size"] for item in uploads),
        "files": uploads,
    }
    upload_path = web_dir / "upload_manifest.json"
    temporary = upload_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(upload_manifest, indent=2), encoding="utf-8")
    os.replace(temporary, upload_path)
    return {**metadata, "upload_object_count": len(uploads), "upload_bytes": upload_manifest["total_bytes"]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus-root", type=Path, default=Path("output/local_topic_questions/production"))
    parser.add_argument("--version", default="2026-07-28-v1")
    parser.add_argument("--js-output", type=Path, default=Path("topic_question_data.js"))
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    corpus_root = args.corpus_root if args.corpus_root.is_absolute() else repo_root / args.corpus_root
    js_output = args.js_output if args.js_output.is_absolute() else repo_root / args.js_output
    result = build(repo_root, corpus_root.resolve(), args.version, js_output.resolve())
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
