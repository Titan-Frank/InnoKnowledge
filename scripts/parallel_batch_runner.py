#!/usr/bin/env python3
"""Prepare parallel lesson extraction batches from textbook outlines."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from knowledge_store_common import (
    load_chunks_for_book,
    load_outline_items,
    make_lesson_run_id,
    resolve_outline_anchor,
    safe_path_token,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Partition textbook lessons into parallel extraction worker batches."
    )
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--parallel", type=int, default=4)
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1,
        help="Deprecated compatibility flag. Must be 1 because each Task processes exactly one lesson.",
    )
    parser.add_argument("--generate-tasks", action="store_true")
    parser.add_argument("--no-chunks", action="store_true",
                        help="Ignore chunk items and use lesson-level extraction units.")
    return parser.parse_args()


def chunked(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def main() -> int:
    args = parse_args()
    if args.batch_size != 1:
        raise SystemExit(
            "--batch-size must be 1. The pipeline requires one isolated Task per lesson."
        )

    # Prefer chunks when available (unless --no-chunks)
    extraction_units = []
    unit_kind = "lesson"
    if not args.no_chunks:
        chunks = load_chunks_for_book(args.book_id)
        if chunks:
            extraction_units = chunks
            unit_kind = "chunk"

    if not extraction_units:
        extraction_units = [
            item
            for item in load_outline_items(args.book_id)
            if item.get("kind") == "lesson"
        ]
        unit_kind = "lesson"

    if not extraction_units:
        raise SystemExit(f"No extraction units found for book '{args.book_id}'.")

    lesson_runs = []
    for item in extraction_units:
        batch_anchor = resolve_outline_anchor(args.book_id, item["id"], strict=True)
        lesson_runs.append(
            {
                "book_id": args.book_id,
                "batch_anchor": batch_anchor,
                "lesson_run_id": make_lesson_run_id(args.book_id, batch_anchor),
                "title": item.get("title"),
                "label": item.get("label"),
                "unit_kind": unit_kind,
            }
        )

    groups = chunked(lesson_runs, 1)
    workers: list[dict[str, Any]] = []
    for index, group in enumerate(groups):
        worker_slot = index % max(1, args.parallel)
        workers.append(
            {
                "worker_slot": worker_slot,
                "items": group,
            }
        )

    output_dir = Path(args.output_root).expanduser().resolve() / "runs" / "parallel"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{safe_path_token(args.book_id)}.parallel-plan.json"
    payload = {
        "book_id": args.book_id,
        "parallel": args.parallel,
        "batch_size": args.batch_size,
        "total_units": len(lesson_runs),
        "unit_kind": unit_kind,
        "workers": workers,
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.generate_tasks:
        for worker in workers:
            anchors = ", ".join(item["batch_anchor"] for item in worker["items"])
            print(f"worker-{worker['worker_slot']}: {anchors}")

    print(str(output_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
