#!/usr/bin/env python3
"""
PDF Quality Optimization & Downscaling Utility
Uses Ghostscript to compress extracted question PDFs and sorted topic PDFs
while preserving text clarity and diagram legibility.

Usage:
    python3 compress_pdfs.py                      # Default: ebook quality
    python3 compress_pdfs.py --quality screen      # Lower quality, smaller size
    python3 compress_pdfs.py --quality printer      # Higher quality, larger size
    python3 compress_pdfs.py --dry-run              # Preview savings without modifying
"""

import os
import sys
import subprocess
import argparse
import shutil
from pathlib import Path

# Ghostscript quality presets (dPDFSETTINGS)
QUALITY_PRESETS = {
    'screen':  '/screen',    # 72 DPI — smallest, may blur fine diagrams
    'ebook':   '/ebook',     # 150 DPI — good balance for text + diagrams
    'printer': '/printer',   # 300 DPI — high quality, moderate compression
}

# Directories to process (relative to project root)
TARGET_DIRS = [
    'Content/Extracted_Questions',
    'Content/Sorted_Topics',
]

# Skip files smaller than this (already tiny, no gains)
MIN_SIZE_BYTES = 10 * 1024  # 10 KB


def find_gs():
    """Locate Ghostscript binary."""
    for name in ['gs', 'ghostscript', '/opt/homebrew/bin/gs', '/usr/local/bin/gs']:
        if shutil.which(name):
            return shutil.which(name)
    return None


def compress_pdf(gs_path, input_path, output_path, quality):
    """Compress a single PDF using Ghostscript."""
    cmd = [
        gs_path,
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        f'-dPDFSETTINGS={quality}',
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        '-dColorImageResolution=150',
        '-dGrayImageResolution=150',
        '-dMonoImageResolution=300',
        '-dAutoRotatePages=/None',
        f'-sOutputFile={output_path}',
        str(input_path),
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return result.returncode == 0
    except (subprocess.TimeoutExpired, Exception) as e:
        print(f"  ⚠ Error compressing {input_path}: {e}")
        return False


def format_size(bytes_val):
    """Human-readable file size."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_val < 1024:
            return f"{bytes_val:.1f} {unit}"
        bytes_val /= 1024
    return f"{bytes_val:.1f} TB"


def main():
    parser = argparse.ArgumentParser(description='Compress PDFs using Ghostscript')
    parser.add_argument('--quality', choices=['screen', 'ebook', 'printer'],
                        default='ebook', help='Compression quality preset (default: ebook)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview compression savings without modifying files')
    args = parser.parse_args()

    gs_path = find_gs()
    if not gs_path:
        print("❌ Ghostscript not found! Install with: brew install ghostscript")
        sys.exit(1)

    print(f"🔧 Ghostscript: {gs_path}")
    print(f"📊 Quality: {args.quality} ({QUALITY_PRESETS[args.quality]})")
    print(f"{'🔍 DRY RUN — no files will be modified' if args.dry_run else '⚡ LIVE — files will be replaced if smaller'}")
    print()

    project_root = Path(__file__).resolve().parent.parent
    quality = QUALITY_PRESETS[args.quality]

    total_original = 0
    total_compressed = 0
    total_files = 0
    skipped_small = 0
    skipped_larger = 0
    errors = 0

    for target_dir in TARGET_DIRS:
        dir_path = project_root / target_dir
        if not dir_path.exists():
            print(f"⚠ Directory not found: {dir_path}")
            continue

        print(f"📁 Processing: {target_dir}/")
        dir_original = 0
        dir_compressed = 0
        dir_count = 0

        pdf_files = sorted(dir_path.rglob('*.pdf'))
        total_in_dir = len(pdf_files)

        for i, pdf_path in enumerate(pdf_files):
            original_size = pdf_path.stat().st_size

            if original_size < MIN_SIZE_BYTES:
                skipped_small += 1
                continue

            # Create temp output
            tmp_path = pdf_path.with_suffix('.tmp.pdf')

            if args.dry_run:
                # In dry-run, still compress to temp to measure savings
                success = compress_pdf(gs_path, pdf_path, tmp_path, quality)
                if success and tmp_path.exists():
                    compressed_size = tmp_path.stat().st_size
                    if compressed_size < original_size:
                        dir_original += original_size
                        dir_compressed += compressed_size
                        dir_count += 1
                    else:
                        skipped_larger += 1
                    tmp_path.unlink()  # Clean up
                else:
                    if tmp_path.exists():
                        tmp_path.unlink()
                    errors += 1
            else:
                success = compress_pdf(gs_path, pdf_path, tmp_path, quality)
                if success and tmp_path.exists():
                    compressed_size = tmp_path.stat().st_size
                    if compressed_size < original_size:
                        # Replace original with compressed version
                        tmp_path.replace(pdf_path)
                        dir_original += original_size
                        dir_compressed += compressed_size
                        dir_count += 1
                    else:
                        tmp_path.unlink()
                        skipped_larger += 1
                else:
                    if tmp_path.exists():
                        tmp_path.unlink()
                    errors += 1

            # Progress indicator every 50 files
            if (i + 1) % 50 == 0:
                print(f"  ... {i + 1}/{total_in_dir} files processed")

        saved = dir_original - dir_compressed
        pct = (saved / dir_original * 100) if dir_original > 0 else 0
        print(f"  ✅ {dir_count} files compressed: {format_size(dir_original)} → {format_size(dir_compressed)} (saved {format_size(saved)}, {pct:.1f}%)")
        
        total_original += dir_original
        total_compressed += dir_compressed
        total_files += dir_count

    print()
    print("=" * 60)
    total_saved = total_original - total_compressed
    total_pct = (total_saved / total_original * 100) if total_original > 0 else 0
    print(f"📊 TOTAL: {total_files} files compressed")
    print(f"   Original:   {format_size(total_original)}")
    print(f"   Compressed: {format_size(total_compressed)}")
    print(f"   Saved:      {format_size(total_saved)} ({total_pct:.1f}% reduction)")
    print(f"   Skipped (too small): {skipped_small}")
    print(f"   Skipped (no gain):   {skipped_larger}")
    if errors > 0:
        print(f"   ⚠ Errors: {errors}")
    print("=" * 60)


if __name__ == '__main__':
    main()
