from __future__ import annotations

import argparse
from pathlib import Path

from .pipeline import PipelineOptions, run_pipeline


SUBJECT_ALIASES = {
    "chemistry": "chemistry",
    "physics": "physics",
    "biology": "biology",
    "math": "mathematics",
    "mathematics": "mathematics",
    "business": "business",
    "economics": "economics",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build local, reviewable IB topic-paper PDFs.")
    parser.add_argument("--subject", choices=["chemistry", "physics", "biology", "math", "business", "economics", "all"], default="all")
    parser.add_argument("--course", choices=["aa", "ai"], help="Required to disambiguate Math fixture/legacy sources.")
    parser.add_argument("--source-dir", type=Path, help="Optional controlled source directory for a sample run.")
    parser.add_argument("--output-dir", type=Path, default=Path("output/local_topic_papers"))
    parser.add_argument("--cache-dir", type=Path, default=Path(".topic-papers-cache"))
    parser.add_argument("--dry-run", action="store_true", help="Inventory and detect boundaries without writing PDFs.")
    parser.add_argument("--resume", action="store_true", help="Reuse cached text/classification artifacts.")
    parser.add_argument("--force-reclassify", action="store_true")
    parser.add_argument("--include-secondary-copies", action="store_true")
    parser.add_argument("--confidence-threshold", type=float, default=0.80)
    parser.add_argument("--max-papers", type=int, help="Deterministic sample limit; does not affect inventory accounting.")
    parser.add_argument("--min-year", type=int, help="Exclude question papers older than this examination year.")
    parser.add_argument("--max-year", type=int, help="Exclude question papers newer than this examination year.")
    parser.add_argument("--english-only", action="store_true", help="Exclude non-English question papers.")
    parser.add_argument("--local-only", action="store_true", default=True, help="Accepted for explicitness; local-only is always enforced.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not 0 <= args.confidence_threshold <= 1:
        raise SystemExit("--confidence-threshold must be between 0 and 1")
    if args.source_dir and args.subject == "all":
        raise SystemExit("--source-dir requires one explicit --subject so metadata is not assigned to multiple subjects")
    repo_root = Path(__file__).resolve().parents[2]
    subjects = list(SUBJECT_ALIASES.values()) if args.subject == "all" else [SUBJECT_ALIASES[args.subject]]
    # Preserve deterministic subject order and remove aliases that point to the same subject.
    subjects = list(dict.fromkeys(subjects))
    source_dir = args.source_dir.resolve() if args.source_dir else None
    options = PipelineOptions(
        repo_root=repo_root,
        output_dir=(repo_root / args.output_dir).resolve() if not args.output_dir.is_absolute() else args.output_dir.resolve(),
        cache_dir=(repo_root / args.cache_dir).resolve() if not args.cache_dir.is_absolute() else args.cache_dir.resolve(),
        subjects=subjects,
        course=args.course,
        source_dir=source_dir,
        dry_run=args.dry_run,
        resume=args.resume,
        force_reclassify=args.force_reclassify,
        include_secondary_copies=args.include_secondary_copies,
        confidence_threshold=args.confidence_threshold,
        max_papers=args.max_papers,
        min_year=args.min_year,
        max_year=args.max_year,
        english_only=args.english_only,
    )
    run_pipeline(options)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
