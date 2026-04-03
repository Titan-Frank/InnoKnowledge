#!/usr/bin/env python3
"""SQLite-native lesson extraction with marker support."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from knowledge_store_common import (
    connect_db,
    ensure_sqlite_schema,
    ANCHOR_ID_PATTERN,
    VALID_EDGE_TYPES,
)

DEFAULT_DB_PATH = REPO_ROOT / "storage" / "knowledge.sqlite"
OUTLINES_DIR = REPO_ROOT / "data" / "outlines"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_outline(book_id: str) -> dict[str, Any]:
    """Load outline for book."""
    outline_path = OUTLINES_DIR / f"{book_id}.outline.json"
    if not outline_path.exists():
        raise FileNotFoundError(f"Outline not found: {outline_path}")
    with open(outline_path, "r", encoding="utf-8") as f:
        return json.load(f)


def find_lesson_in_outline(outline: dict, anchor: str) -> dict | None:
    """Find lesson details by anchor ID."""
    # Direct lookup in items list (newer outline format)
    for item in outline.get("items", []):
        if item.get("id") == anchor:
            return item
    # Fallback to structure/nested children format (older outline format)
    for theme in outline.get("structure", []):
        for topic in theme.get("children", []):
            for lesson in topic.get("children", []):
                if lesson.get("id") == anchor:
                    return lesson
    return None


def extract_book_id_from_anchor(anchor: str) -> str:
    """Extract book_id from anchor."""
    match = ANCHOR_ID_PATTERN.match(anchor)
    if not match:
        raise ValueError(f"Invalid anchor format: {anchor}")
    return match.group("book_id")


def parse_lesson_by_markers(md_content: str, lesson_id: str) -> str | None:
    """Strategy 0: Extract lesson using boundary markers (most accurate)."""
    start_marker = f'<!-- LESSON_START id="{lesson_id}"'
    end_marker = f'<!-- LESSON_END id="{lesson_id}"-->'

    start_idx = md_content.find(start_marker)
    if start_idx == -1:
        return None

    start_line_end = md_content.find("\n", start_idx)
    if start_line_end == -1:
        start_line_end = len(md_content)

    end_idx = md_content.find(end_marker, start_line_end)
    if end_idx == -1:
        return None

    lesson_content = md_content[start_line_end + 1 : end_idx].strip()

    if lesson_content:
        print(f"✓ Found lesson content using markers: {len(lesson_content)} chars")

    return lesson_content if lesson_content else None


def parse_lesson_pages(
    page_start: int,
    page_end: int,
    md_content: str,
    lesson_title: str = "",
) -> str:
    """Extract text for lesson pages from markdown (fallback strategy)."""
    lines = md_content.split("\n")

    # Strategy 1: Page markers
    has_page_markers = False
    lesson_lines = []
    in_lesson = False

    for line in lines:
        page_match = re.search(r"[Pp]age[:\s]*(\d+)", line)
        if page_match:
            has_page_markers = True
            page_num = int(page_match.group(1))
            if page_start <= page_num <= page_end:
                in_lesson = True
            elif page_num > page_end:
                in_lesson = False
            continue

        if in_lesson:
            lesson_lines.append(line)

    if has_page_markers and lesson_lines:
        return "\n".join(lesson_lines)

    # Strategy 2: Title matching
    if lesson_title:
        title_pattern = re.compile(re.escape(lesson_title), re.IGNORECASE)
        for i, line in enumerate(lines):
            if title_pattern.search(line):
                lesson_lines = [line]
                for j in range(i + 1, len(lines)):
                    next_line = lines[j]
                    if re.match(r"^#{1,3}\s+", next_line) and j > i + 5:
                        if not title_pattern.search(next_line):
                            break
                    lesson_lines.append(next_line)
                return "\n".join(lesson_lines)

    # Strategy 3: Fallback
    print(f"Warning: Using fallback extraction")
    return md_content[:50000]


def main() -> int:
    args = parse_args()

    book_id = extract_book_id_from_anchor(args.batch_anchor)

    dataset_id = args.dataset_id or (
        Path(args.output_root).name if args.output_root else "v4"
    )

    outline = load_outline(book_id)
    lesson = find_lesson_in_outline(outline, args.batch_anchor)

    if not lesson:
        print(f"Error: Lesson not found: {args.batch_anchor}")
        return 1

    lesson_title = lesson.get("title", "")
    page_start = lesson.get("page_start")
    page_end = lesson.get("page_end")

    print(f"Extracting: {lesson_title} ({args.batch_anchor})")
    print(f"Pages: {page_start}-{page_end}")

    # Read original markdown
    md_path = Path(args.book_md_path)
    if not md_path.exists():
        print(f"Error: Markdown file not found: {md_path}")
        return 1

    with open(md_path, "r", encoding="utf-8") as f:
        md_content = f.read()

    # Strategy 0: Check for marked markdown (NEW)
    marked_md_path = OUTLINES_DIR / f"{book_id}.marked.md"
    if marked_md_path.exists():
        print(f"Found marked markdown: {marked_md_path}")
        with open(marked_md_path, "r", encoding="utf-8") as f:
            marked_content = f.read()

        lesson_text = parse_lesson_by_markers(marked_content, args.batch_anchor)
        if lesson_text:
            print("✓ Using marked boundaries")
        else:
            print("⚠️  Markers not found, falling back")
            if page_start and page_end:
                lesson_text = parse_lesson_pages(
                    page_start, page_end, md_content, lesson_title
                )
            else:
                lesson_text = md_content
    else:
        print("⚠️  No marked markdown, using page/title extraction")
        if page_start and page_end:
            lesson_text = parse_lesson_pages(
                page_start, page_end, md_content, lesson_title
            )
        else:
            lesson_text = md_content

    if not lesson_text.strip():
        print("Error: No lesson text found")
        return 1

    print(f"Lesson text length: {len(lesson_text)} chars")

    # TODO: Add LLM extraction logic here
    print("\n✓ Lesson extraction ready (placeholder - add LLM logic)")

    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract lesson content with marker support."
    )
    parser.add_argument(
        "--batch-anchor",
        required=True,
        help="Outline anchor ID",
    )
    parser.add_argument(
        "--book-md-path",
        required=True,
        help="Path to OCR-completed markdown",
    )
    parser.add_argument(
        "--db",
        default=str(DEFAULT_DB_PATH),
        help="Path to SQLite database",
    )
    parser.add_argument("--dataset-id", help="Dataset ID")
    parser.add_argument("--output-root", help="Output root")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
