from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


REQUIRED_TOPIC_KEYS = {
    "code", "title", "parent", "level", "keywords", "concepts", "exclusions", "legacy_topic_mappings"
}


@dataclass(frozen=True)
class Taxonomy:
    subject: str
    course: str | None
    curriculum_version: str
    first_assessment: int
    sources: list[dict[str, str]]
    topics: list[dict[str, Any]]

    @property
    def by_code(self) -> dict[str, dict[str, Any]]:
        return {topic["code"]: topic for topic in self.topics}


def validate_taxonomy(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for key in ("subject", "curriculum_version", "first_assessment", "sources", "topics"):
        if key not in data:
            errors.append(f"missing top-level key: {key}")
    if not isinstance(data.get("topics"), list) or not data.get("topics"):
        errors.append("topics must be a non-empty list")
        return errors
    seen: set[str] = set()
    for index, topic in enumerate(data["topics"]):
        missing = REQUIRED_TOPIC_KEYS - set(topic)
        if missing:
            errors.append(f"topic {index} missing: {', '.join(sorted(missing))}")
        code = topic.get("code")
        if not isinstance(code, str) or not code.strip():
            errors.append(f"topic {index} has invalid code")
        elif code in seen:
            errors.append(f"duplicate topic code: {code}")
        else:
            seen.add(code)
        levels = topic.get("level", [])
        if not levels or any(level not in {"SL", "HL"} for level in levels):
            errors.append(f"topic {code or index} has invalid level")
        for list_key in ("keywords", "concepts", "exclusions", "legacy_topic_mappings"):
            if not isinstance(topic.get(list_key), list):
                errors.append(f"topic {code or index} {list_key} must be a list")
    return errors


def load_taxonomy(config_dir: Path, subject: str, course: str | None = None) -> Taxonomy:
    filename = f"mathematics_{course}.json" if subject == "mathematics" else f"{subject}.json"
    path = config_dir / filename
    if not path.exists():
        raise FileNotFoundError(f"Curriculum taxonomy not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    errors = validate_taxonomy(data)
    if errors:
        raise ValueError(f"Invalid taxonomy {path}: {'; '.join(errors)}")
    return Taxonomy(
        subject=data["subject"],
        course=data.get("course"),
        curriculum_version=data["curriculum_version"],
        first_assessment=data["first_assessment"],
        sources=data["sources"],
        topics=data["topics"],
    )
