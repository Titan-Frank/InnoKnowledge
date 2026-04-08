#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, UTC
from pathlib import Path


KIND_PATTERNS = [
    (
        "theme",
        re.compile(r"^\s*(主题[一二三四五六七八九十百千万0-9]+)\s+(.+?)\s*/\s*(\d+)\s*$"),
    ),
    (
        "topic",
        re.compile(r"^\s*(专题\s*[一二三四五六七八九十百千万0-9]+)\s+(.+?)\s*/\s*(\d+)\s*$"),
    ),
    (
        "lesson",
        re.compile(r"^\s*(课题\s*[一二三四五六七八九十百千万0-9]+)\s+(.+?)\s*/\s*(\d+)\s*$"),
    ),
    (
        "activity",
        re.compile(
            r"^\s*(跨学科实践活动|活动体验|实验活动)\s+(.+?)\s*/\s*(\d+)\s*$"
        ),
    ),
    (
        "review",
        re.compile(r"^\s*(专题复习|课题复习|单元复习|章末复习)\s*/\s*(\d+)\s*$"),
    ),
]

LEVELS = {"theme": 1, "topic": 2, "lesson": 3, "activity": 3, "review": 3}


def derive_book_id(pdf_path: Path) -> str:
    stem = pdf_path.stem.lower()
    stem = re.sub(r"[^a-z0-9]+", "-", stem)
    stem = re.sub(r"-{2,}", "-", stem).strip("-")
    if stem:
        return stem[:80]
    digest = hashlib.sha1(str(pdf_path.resolve()).encode("utf-8")).hexdigest()[:8]
    return f"book-{digest}"


def extract_text(pdf_path: Path, start_page: int, end_page: int) -> str:
    cmd = [
        "pdftotext",
        "-layout",
        "-f",
        str(start_page),
        "-l",
        str(end_page),
        str(pdf_path),
        "-",
    ]
    try:
        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        raise SystemExit("pdftotext is required but was not found in PATH.")
    except subprocess.CalledProcessError as exc:
        raise SystemExit(exc.stderr.strip() or "pdftotext failed.")
    return result.stdout


def iter_candidate_lines(text: str) -> list[str]:
    seen_toc = False
    candidates: list[str] = []
    for page in text.split("\f"):
        for raw_line in page.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            compact = re.sub(r"\s+", "", line)
            if "目录" in compact:
                seen_toc = True
                continue
            if not seen_toc:
                continue
            candidates.append(raw_line.rstrip())
    return candidates


def parse_outline(lines: list[str], book_id: str) -> list[dict]:
    items: list[dict] = []
    counters = defaultdict(int)
    current_theme_id: str | None = None
    current_topic_id: str | None = None
    current_theme_index = 0
    current_topic_index = 0
    topic_lesson_index = 0

    for raw_line in lines:
        parsed = None
        for kind, pattern in KIND_PATTERNS:
            match = pattern.match(raw_line)
            if match:
                parsed = (kind, match.groups())
                break

        if not parsed:
            continue

        kind, groups = parsed
        counters[kind] += 1

        if kind == "theme":
            label, title, page = groups
            current_theme_index += 1
            current_topic_index = 0
            topic_lesson_index = 0
            current_theme_id = f"struct:{book_id}:theme:{current_theme_index}"
            current_topic_id = None
            item_id = current_theme_id
            order_path = f"{current_theme_index}"
            parent_id = None
        elif kind == "topic":
            label, title, page = groups
            current_topic_index += 1
            topic_lesson_index = 0
            item_id = f"struct:{book_id}:topic:{current_theme_index}-{current_topic_index}"
            current_topic_id = item_id
            order_path = f"{current_theme_index}.{current_topic_index}"
            parent_id = current_theme_id
        elif kind == "lesson":
            label, title, page = groups
            topic_lesson_index += 1
            item_id = (
                f"struct:{book_id}:lesson:"
                f"{current_theme_index}-{current_topic_index}-{topic_lesson_index}"
            )
            order_path = f"{current_theme_index}.{current_topic_index}.{topic_lesson_index}"
            parent_id = current_topic_id or current_theme_id
        elif kind == "activity":
            label, title, page = groups
            topic_lesson_index += 1
            item_id = (
                f"struct:{book_id}:activity:"
                f"{current_theme_index}-{current_topic_index}-{topic_lesson_index}"
            )
            order_path = f"{current_theme_index}.{current_topic_index}.{topic_lesson_index}"
            parent_id = current_topic_id or current_theme_id
        else:
            label, page = groups
            title = label
            topic_lesson_index += 1
            item_id = (
                f"struct:{book_id}:review:"
                f"{current_theme_index}-{current_topic_index}-{topic_lesson_index}"
            )
            order_path = f"{current_theme_index}.{current_topic_index}.{topic_lesson_index}"
            parent_id = current_topic_id or current_theme_id

        item = {
            "id": item_id,
            "kind": kind,
            "label": re.sub(r"\s+", " ", label).strip(),
            "title": re.sub(r"\s+", " ", title).strip(),
            "page_start": int(page),
            "level": LEVELS[kind],
            "order_path": order_path,
            "raw_line": raw_line.strip(),
        }
        if parent_id:
            item["parent_id"] = parent_id
        items.append(item)

    return items


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract a textbook outline from the table of contents."
    )
    parser.add_argument("--pdf", required=True, help="Path to the textbook PDF.")
    parser.add_argument(
        "--book-id",
        help="Stable ASCII book id. Recommended for reruns.",
    )
    parser.add_argument("--title", help="Optional book title override.")
    parser.add_argument(
        "--start-page",
        type=int,
        default=1,
        help="First PDF page to scan for the table of contents.",
    )
    parser.add_argument(
        "--end-page",
        type=int,
        default=20,
        help="Last PDF page to scan for the table of contents.",
    )
    parser.add_argument(
        "--out",
        required=True,
        help="Output path for the outline JSON file.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Write indented JSON.",
    )
    args = parser.parse_args()

    pdf_path = Path(args.pdf).expanduser().resolve()
    if not pdf_path.exists():
        raise SystemExit(f"PDF not found: {pdf_path}")

    book_id = args.book_id or derive_book_id(pdf_path)
    text = extract_text(pdf_path, args.start_page, args.end_page)
    lines = iter_candidate_lines(text)
    items = parse_outline(lines, book_id)

    if not items:
        raise SystemExit(
            "No outline items were parsed. Adjust the scanned page range or inspect the PDF TOC."
        )

    payload = {
        "book_id": book_id,
        "title": args.title or pdf_path.stem,
        "source_path": str(pdf_path),
        "generated_at": datetime.now(UTC).isoformat(),
        "toc_pages": {"start": args.start_page, "end": args.end_page},
        "items": items,
    }

    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2 if args.pretty else None)
        handle.write("\n")

    print(f"Wrote {len(items)} outline items to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
