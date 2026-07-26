#!/usr/bin/env python3
"""
Dynamic Mock Exam PDF Compiler
Takes a JSON file containing selected question metadata, extracts the clean, original
pages from the past paper PDFs, and stitches them into a single high-quality mock paper PDF.
"""

import os
import sys
import json
from pathlib import Path
from pypdf import PdfReader, PdfWriter

def parse_page_range(pages_str):
    """Convert '15-16' (1-based, inclusive) into (14, 15) 0-based indices."""
    if not pages_str:
        return None
    try:
        parts = pages_str.split('-')
        if len(parts) == 1:
            val = int(parts[0]) - 1
            return val, val
        elif len(parts) == 2:
            return int(parts[0]) - 1, int(parts[1]) - 1
    except Exception:
        pass
    return None

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 generate_mock_pdf.py <questions_json_path> <output_pdf_path>")
        sys.exit(1)

    json_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not json_path.exists():
        print(f"Error: JSON file not found: {json_path}")
        sys.exit(1)

    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            questions = json.load(f)
    except Exception as e:
        print(f"Error reading JSON: {e}")
        sys.exit(1)

    writer = PdfWriter()
    project_root = Path(__file__).resolve().parent.parent

    # Track successfully compiled pages
    pages_added = 0

    for idx, q in enumerate(questions):
        # Resolve full paper path (might be relative to project root)
        rel_path = q.get('full_paper_path') or q.get('qp_path')
        if not rel_path:
            print(f"Warning: Question {idx} missing path metadata. Skipping.")
            continue

        full_path = project_root / rel_path
        if not full_path.exists():
            print(f"Warning: Full paper PDF not found: {full_path}. Skipping.")
            continue

        # Parse page range
        pages_meta = q.get('pages')
        page_range = parse_page_range(pages_meta)
        if not page_range:
            print(f"Warning: Question {idx} has invalid page range '{pages_meta}'. Skipping.")
            continue

        start_page, end_page = page_range

        try:
            reader = PdfReader(full_path)
            num_pages = len(reader.pages)
            
            # Bound check
            start_page = max(0, min(start_page, num_pages - 1))
            end_page = max(0, min(end_page, num_pages - 1))

            for page_idx in range(start_page, end_page + 1):
                writer.add_page(reader.pages[page_idx])
                pages_added += 1
                
        except Exception as e:
            print(f"Error processing question {idx} from {full_path}: {e}")
            continue

    if pages_added == 0:
        print("Error: No pages were extracted.")
        sys.exit(1)

    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        with open(output_path, 'wb') as out_f:
            writer.write(out_f)
        print(f"Success: Stitched {pages_added} pages into {output_path}")
    except Exception as e:
        print(f"Error writing output PDF: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
