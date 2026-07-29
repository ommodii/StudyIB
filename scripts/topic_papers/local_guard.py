from __future__ import annotations

import os
from pathlib import Path


LOCAL_BANNER = "LOCAL-ONLY MODE: question slices and topic PDFs will not be uploaded or deployed."
FORBIDDEN_OUTPUT_PARTS = {"content", "www", ".git"}
FORBIDDEN_COMMAND_TOKENS = ("wrangler", "r2 object", "deploy", "rclone")


class LocalOnlyViolation(RuntimeError):
    pass


def assert_local_only(repo_root: Path, output_dir: Path) -> None:
    """Reject production-facing destinations even when cloud credentials are present."""
    root = repo_root.resolve()
    destination = output_dir.resolve()
    try:
        relative = destination.relative_to(root)
    except ValueError:
        relative = None
    if relative is not None and any(part.lower() in FORBIDDEN_OUTPUT_PARTS for part in relative.parts):
        raise LocalOnlyViolation(f"Refusing local pipeline output inside production path: {destination}")
    if destination == root:
        raise LocalOnlyViolation("Refusing to write generated output into the repository root.")
    os.environ["STUDYIB_LOCAL_ONLY"] = "1"


def assert_safe_process(command: list[str] | tuple[str, ...]) -> None:
    joined = " ".join(str(part) for part in command).lower()
    if any(token in joined for token in FORBIDDEN_COMMAND_TOKENS):
        raise LocalOnlyViolation(f"Remote or deployment process blocked in local mode: {joined}")
