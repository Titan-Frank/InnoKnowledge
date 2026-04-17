#!/usr/bin/env python3
"""Chunk textbook outline items into extraction units of uniform size.

Splits oversized lessons at natural heading boundaries and merges
undersized adjacent items (activities, short lessons) within the same
topic.  Outputs chunk items appended to the existing outline JSON.

Usage:
    python scripts/chunk_outline.py --book-id chem-grade8-hukj [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_MAX_LINES = 300
DEFAULT_MIN_LINES = 150
DEFAULT_TARGET_LINES = 250

SUFFIXES = "abcdefghijklmnopqrstuvwxyz"

# Sections with these title patterns are review/supplement content,
# not core knowledge. They get a single chunk (never split) and can be
# skipped by the extraction pipeline.
REVIEW_PATTERNS = re.compile(
    r"小结|习题|复习|练习巩固|归纳小结|总结|参考文献|编程作业|人物专访|Wireshark"
)

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "outlines"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def load_outline(book_id: str) -> dict[str, Any]:
    path = DATA_DIR / f"{book_id}.outline.json"
    if not path.exists():
        raise FileNotFoundError(f"Outline not found: {path}")
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_markdown(source_path: str) -> list[str]:
    p = Path(source_path)
    if not p.is_absolute():
        p = Path(__file__).resolve().parent.parent / p
    if not p.exists():
        raise FileNotFoundError(f"Markdown not found: {p}")
    with p.open("r", encoding="utf-8") as f:
        return f.readlines()


def md_span(item: dict[str, Any]) -> int:
    s, e = item.get("md_start"), item.get("md_end")
    if s is not None and e is not None:
        return e - s + 1
    return 0


def page_span(item: dict[str, Any]) -> int:
    s, e = item.get("page_start"), item.get("page_end")
    if s is not None and e is not None:
        try:
            return int(e) - int(s) + 1
        except (TypeError, ValueError):
            return 0
    return 0


def topic_id_for(item: dict[str, Any], items: list[dict[str, Any]]) -> str | None:
    """Return the topic-level parent ID for an item."""
    pid = item.get("parent_id")
    if pid is None:
        return item["id"] if item.get("kind") == "topic" else None
    by_id = {i["id"]: i for i in items if i.get("id")}
    parent = by_id.get(pid)
    if parent is None:
        return pid
    if parent.get("kind") == "topic":
        return parent["id"]
    return topic_id_for(parent, items)


# ---------------------------------------------------------------------------
# Heading parsing
# ---------------------------------------------------------------------------


def parse_headings(lines: list[str]) -> list[tuple[int, str]]:
    """Return [(1-based line_number, heading_text), ...] for # headings."""
    result = []
    for idx, line in enumerate(lines):
        m = re.match(r"^(#{1,6})\s+(.+)", line)
        if m:
            result.append((idx + 1, m.group(2).strip()))
    return result


# ---------------------------------------------------------------------------
# Split oversized
# ---------------------------------------------------------------------------


def split_oversized(
    item: dict[str, Any],
    headings: list[tuple[int, str]],
    target: int,
    max_lines: int,
) -> list[dict[str, Any]]:
    """Split a single item into one or more chunks at logical section boundaries.

    The OCR markdown uses single-hash headings (#) for everything, so we first
    group adjacent headings into "logical sections" of at least min_section lines,
    then accumulate logical sections into chunks of ~target_lines.
    """
    s = item.get("md_start", 0)
    e = item.get("md_end", 0)
    span = e - s + 1

    if span <= max_lines:
        return [_make_single_chunk(item)]

    # Find headings within [s, e]
    inner = [(ln, txt) for ln, txt in headings if s <= ln <= e]
    if not inner:
        # No headings — return as single chunk (no good split points)
        return [_make_single_chunk(item)]

    # Step 1: Build raw sections from heading positions
    boundaries = [s] + [ln for ln, _ in inner] + [e + 1]
    raw_sections: list[tuple[int, int, str]] = []
    for i in range(len(boundaries) - 1):
        sec_start = boundaries[i]
        sec_end = boundaries[i + 1] - 1
        heading_title = ""
        for ln, txt in inner:
            if sec_start <= ln <= sec_end:
                heading_title = txt
                break
        raw_sections.append((sec_start, sec_end, heading_title))

    # Step 2: Merge tiny sections into logical sections
    # Adjacent sections that together are < target/4 get merged
    min_section = max(target // 4, 30)
    logical_sections: list[tuple[int, int, str]] = []
    cur_s, cur_e, cur_title = raw_sections[0]

    for sec_s, sec_e, sec_title in raw_sections[1:]:
        cur_len = cur_e - cur_s + 1
        sec_len = sec_e - sec_s + 1
        if cur_len < min_section:
            # Merge into current logical section
            cur_e = sec_e
            if not cur_title:
                cur_title = sec_title
        else:
            logical_sections.append((cur_s, cur_e, cur_title))
            cur_s, cur_e, cur_title = sec_s, sec_e, sec_title
    logical_sections.append((cur_s, cur_e, cur_title))

    # Step 3: Greedy accumulation into chunks of ~target_lines
    chunks: list[dict[str, Any]] = []
    chunk_start = logical_sections[0][0]
    chunk_title_parts: list[str] = []
    accumulated = 0

    for idx, (sec_s, sec_e, sec_title) in enumerate(logical_sections):
        sec_len = sec_e - sec_s + 1

        # Close chunk if adding this section would exceed target * 1.3
        if accumulated > 0 and accumulated + sec_len > target * 1.3:
            chunks.append(
                _make_chunk(
                    item, chunk_start, sec_s - 1, SUFFIXES[len(chunks)],
                    chunk_title_parts,
                )
            )
            chunk_start = sec_s
            chunk_title_parts = [sec_title] if sec_title else []
            accumulated = sec_len
        else:
            if sec_title and not chunk_title_parts:
                chunk_title_parts.append(sec_title)
            accumulated += sec_len

    # Final chunk
    if accumulated > 0:
        chunks.append(
            _make_chunk(item, chunk_start, e, SUFFIXES[len(chunks)], chunk_title_parts)
        )

    # Merge tiny trailing chunks back into the previous chunk
    if len(chunks) > 1:
        merged: list[dict[str, Any]] = [chunks[0]]
        for c in chunks[1:]:
            if md_span(c) < min_section and merged:
                prev = merged[-1]
                prev["md_end"] = c["md_end"]
                prev["source_ids"] = list(set(prev.get("source_ids", []) + c.get("source_ids", [])))
                # Update page_end
                if c.get("page_end"):
                    prev["page_end"] = c["page_end"]
            else:
                merged.append(c)
        chunks = merged

    return chunks


# ---------------------------------------------------------------------------
# Merge undersized
# ---------------------------------------------------------------------------


def merge_undersized(
    items_in_topic: list[dict[str, Any]],
    min_lines: int,
    max_lines: int,
) -> list[list[dict[str, Any]]]:
    """Group consecutive undersized items within a topic for merging.

    Activities are always considered undersized regardless of line count
    (they're typically 3 pages of exercise/project content). They get
    merged into the preceding lesson unless that lesson is oversized.
    """
    groups: list[list[dict[str, Any]]] = []
    i = 0

    while i < len(items_in_topic):
        item = items_in_topic[i]
        span = md_span(item)

        # Activity: merge into preceding group if possible, else standalone
        if item.get("kind") == "activity":
            if groups and len(groups[-1]) == 1:
                prev_item = groups[-1][0]
                prev_span = md_span(prev_item)
                combined = prev_span + span
                if prev_span <= max_lines and combined <= max_lines:
                    groups[-1].append(item)
                    i += 1
                    continue
            groups.append([item])
            i += 1
            continue

        # Short lesson: try to merge with following undersized items
        if span < min_lines and item.get("kind") == "lesson":
            group = [item]
            j = i + 1
            while j < len(items_in_topic):
                next_item = items_in_topic[j]
                next_span = md_span(next_item)
                combined = sum(md_span(g) for g in group) + next_span
                is_mergeable = (
                    (next_item.get("kind") == "activity" or md_span(next_item) < min_lines)
                    and combined <= max_lines
                )
                if is_mergeable:
                    group.append(next_item)
                    j += 1
                else:
                    break
            groups.append(group)
            i = j
            continue

        # Normal or oversized — standalone group
        groups.append([item])
        i += 1

    return groups

    return groups


# ---------------------------------------------------------------------------
# Chunk builders
# ---------------------------------------------------------------------------


def _make_single_chunk(item: dict[str, Any]) -> dict[str, Any]:
    suffix = SUFFIXES[0]
    return _make_chunk(item, item.get("md_start"), item.get("md_end"), suffix, [])


def _make_chunk(
    parent: dict[str, Any],
    md_start: int | None,
    md_end: int | None,
    suffix: str,
    title_parts: list[str],
) -> dict[str, Any]:
    book_id = parent["id"].split(":")[1] if ":" in parent["id"] else ""
    local = parent["id"].rsplit(":", 1)[-1] if ":" in parent["id"] else parent["id"]
    chunk_order = f"{local}-{suffix}"

    label_suffix = {"a": "上", "b": "中", "c": "下"}.get(suffix, suffix)
    label = f"{parent.get('label', '')} ({label_suffix})"

    title = parent.get("title", "")
    if title_parts:
        subtitle = " — ".join(p for p in title_parts if p)
        if subtitle and subtitle != title:
            title = f"{title} — {subtitle}"

    # Interpolate page_end from md position if missing
    p_start = parent.get("page_start")
    p_end = parent.get("page_end")
    chunk_page_start = p_start
    chunk_page_end = p_end
    if md_start and md_end and p_start and p_end:
        try:
            parent_md_s = int(parent.get("md_start", 0))
            parent_md_e = int(parent.get("md_end", 0))
            parent_span = parent_md_e - parent_md_s
            if parent_span > 0:
                frac_s = (int(md_start) - parent_md_s) / parent_span
                frac_e = (int(md_end) - parent_md_s) / parent_span
                ps = int(p_start)
                pe = int(p_end)
                chunk_page_start = ps + round(frac_s * (pe - ps))
                chunk_page_end = ps + round(frac_e * (pe - ps))
        except (TypeError, ValueError):
            pass

    return {
        "id": f"struct:{book_id}:chunk:{chunk_order}",
        "kind": "chunk",
        "label": label,
        "title": title,
        "page_start": chunk_page_start,
        "page_end": chunk_page_end,
        "md_start": md_start,
        "md_end": md_end,
        "level": 4,
        "order_path": f"{parent.get('order_path', '')}-{suffix}",
        "parent_id": parent["id"],
        "source_ids": [parent["id"]],
        "raw_line": "",
    }


def _make_merged_chunk(
    merged_items: list[dict[str, Any]], suffix: str
) -> dict[str, Any]:
    first = merged_items[0]
    last = merged_items[-1]
    book_id = first["id"].split(":")[1] if ":" in first["id"] else ""
    local = first["id"].rsplit(":", 1)[-1] if ":" in first["id"] else first["id"]
    chunk_order = f"{local}-{suffix}"

    labels = [it.get("label", "") for it in merged_items]
    label = " + ".join(labels)

    titles = [it.get("title", "") for it in merged_items]
    title = " & ".join(titles)

    md_start = first.get("md_start")
    md_end = last.get("md_end")
    page_start = first.get("page_start")
    page_end = last.get("page_end")

    return {
        "id": f"struct:{book_id}:chunk:{chunk_order}",
        "kind": "chunk",
        "label": label,
        "title": title,
        "page_start": page_start,
        "page_end": page_end,
        "md_start": md_start,
        "md_end": md_end,
        "level": 4,
        "order_path": f"{first.get('order_path', '')}-{suffix}",
        "parent_id": first["id"],
        "source_ids": [it["id"] for it in merged_items],
        "raw_line": "",
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Chunk textbook outline items into uniform extraction units."
    )
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--max-lines", type=int, default=DEFAULT_MAX_LINES,
                        help="Split items exceeding this (default: %(default)s)")
    parser.add_argument("--min-lines", type=int, default=DEFAULT_MIN_LINES,
                        help="Merge items below this (default: %(default)s)")
    parser.add_argument("--target-lines", type=int, default=DEFAULT_TARGET_LINES,
                        help="Target chunk size in MD lines (default: %(default)s)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview without writing")
    args = parser.parse_args()

    outline = load_outline(args.book_id)
    items = outline.get("items", [])
    source_path = outline.get("source_path", "")

    # Load markdown for heading analysis
    try:
        md_lines = load_markdown(source_path)
    except FileNotFoundError:
        print(f"Warning: markdown not found at {source_path}, skipping heading analysis",
              file=sys.stderr)
        md_lines = []

    headings = parse_headings(md_lines) if md_lines else []

    # Identify leaf items (lesson, activity, review) that are candidates
    leaf_items = [it for it in items if it.get("kind") in ("lesson", "activity")]

    # Group leaf items by topic
    topic_groups: dict[str, list[dict[str, Any]]] = {}
    for it in leaf_items:
        tid = topic_id_for(it, items) or "__none__"
        topic_groups.setdefault(tid, []).append(it)

    # Process each topic group
    chunk_items: list[dict[str, Any]] = []
    stats = {"split": 0, "merged": 0, "normal": 0, "review_skipped": 0}

    for tid, topic_leaves in topic_groups.items():
        # Filter out review sections (小结, 习题, etc.)
        content_leaves = []
        for it in topic_leaves:
            if REVIEW_PATTERNS.search(it.get("title", "")):
                stats["review_skipped"] += 1
                print(f"  SKIP (review): {it.get('id','?').split(':')[-1]} "
                      f"{it.get('title','')[:40]}")
            else:
                content_leaves.append(it)

        if not content_leaves:
            continue

        # Handle merging of undersized items
        # Never merge across chapter (theme) boundaries
        by_chapter: dict[str, list[dict[str, Any]]] = {}
        for it in content_leaves:
            # Walk up to find the theme (chapter) parent
            ch_id = it.get("parent_id", "")
            # If parent is theme, use it; otherwise walk up
            by_id_map = {i["id"]: i for i in items if i.get("id")}
            p = by_id_map.get(ch_id)
            while p and p.get("kind") != "theme" and p.get("parent_id"):
                p = by_id_map.get(p["parent_id"])
            chapter_key = p["id"] if p and p.get("kind") == "theme" else ch_id
            by_chapter.setdefault(chapter_key, []).append(it)

        # Merge within each chapter
        merge_groups: list[list[dict[str, Any]]] = []
        for ch_key, ch_leaves in by_chapter.items():
            merge_groups.extend(
                merge_undersized(ch_leaves, args.min_lines, args.max_lines)
            )

        for group in merge_groups:
            if len(group) > 1:
                # Merge multiple undersized items
                chunk = _make_merged_chunk(group, SUFFIXES[len(chunk_items) % 26])
                chunk_items.append(chunk)
                stats["merged"] += 1
                spans = [str(md_span(g)) for g in group]
                print(f"  MERGE: {' + '.join(g.get('id','?').split(':')[-1] for g in group)} "
                      f"({', '.join(spans)} lines) → {chunk['id']} "
                      f"({md_span(chunk)} lines)")
            else:
                item = group[0]
                span = md_span(item)
                if span > args.max_lines:
                    # Split oversized
                    splits = split_oversized(item, headings, args.target_lines, args.max_lines)
                    chunk_items.extend(splits)
                    stats["split"] += 1
                    chunk_spans = [str(md_span(c)) for c in splits]
                    print(f"  SPLIT: {item.get('id','?').split(':')[-1]} "
                          f"({span} lines) → {len(splits)} chunks "
                          f"({', '.join(chunk_spans)} lines)")
                else:
                    # Normal size — single chunk
                    chunk = _make_single_chunk(item)
                    chunk_items.append(chunk)
                    stats["normal"] += 1

    # Summary
    print(f"\nSummary for {args.book_id}:")
    print(f"  Normal (no change):  {stats['normal']}")
    print(f"  Split (oversized):   {stats['split']}")
    print(f"  Merged (undersized): {stats['merged']}")
    print(f"  Review skipped:      {stats['review_skipped']}")
    print(f"  Total chunks:        {len(chunk_items)}")

    if not chunk_items:
        print("No chunks generated — outline may already be well-sized.")
        return 0

    # Chunk size distribution
    sizes = [md_span(c) for c in chunk_items]
    print(f"  Chunk sizes: min={min(sizes)}, max={max(sizes)}, "
          f"avg={sum(sizes)//len(sizes)}")

    if args.dry_run:
        print("\n(dry run — no changes written)")
        return 0

    # Append chunk items to outline
    outline["items"].extend(chunk_items)

    output_path = DATA_DIR / f"{args.book_id}.outline.json"
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(outline, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {len(chunk_items)} chunk items to {output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
