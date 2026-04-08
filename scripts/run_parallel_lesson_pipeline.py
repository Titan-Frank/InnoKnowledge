#!/usr/bin/env python3
"""Run the parallel lesson staging pipeline end to end."""

from __future__ import annotations

import argparse
import sqlite3
import subprocess
import sys
from pathlib import Path

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    ensure_dataset,
    ensure_sqlite_schema,
    resolve_dataset_id,
    utc_now,
)


REPO_ROOT = Path(__file__).resolve().parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Merge staged lesson runs, normalize the canonical graph, and run QA."
    )
    parser.add_argument("--root", required=True)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument("--book-id")
    parser.add_argument("--batch-anchor", action="append", dest="batch_anchors")
    parser.add_argument("--lesson-run-id", action="append", dest="lesson_run_ids")
    parser.add_argument("--similarity-threshold", type=float, default=0.9)
    parser.add_argument("--embedding-threshold", type=float, default=0.92)
    parser.add_argument("--normalize-auto-merge", action="store_true")
    parser.add_argument("--skip-normalize", action="store_true")
    parser.add_argument("--skip-qa", action="store_true")
    parser.add_argument("--skip-integrity", action="store_true")
    return parser.parse_args()


def run_step(args: list[str]) -> None:
    subprocess.run(args, check=True)


def mark_qa_passed(
    connection: sqlite3.Connection,
    dataset_id: str,
    lesson_run_ids: list[str],
) -> None:
    if not lesson_run_ids:
        return
    now = utc_now()
    connection.executemany(
        """
        UPDATE lesson_runs
        SET status = 'qa_passed', updated_at = ?
        WHERE dataset_id = ? AND lesson_run_id = ?
        """,
        [(now, dataset_id, lesson_run_id) for lesson_run_id in lesson_run_ids],
    )


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, root)
    ensure_dataset(connection, dataset_id, root)

    merge_cmd = [
        sys.executable,
        str(REPO_ROOT / "scripts" / "merge_staged_lessons.py"),
        "--root",
        str(root),
        "--db",
        args.db,
        "--dataset-id",
        dataset_id,
        "--similarity-threshold",
        str(args.similarity_threshold),
        "--embedding-threshold",
        str(args.embedding_threshold),
    ]
    if args.book_id:
        merge_cmd.extend(["--book-id", args.book_id])
    for batch_anchor in args.batch_anchors or []:
        merge_cmd.extend(["--batch-anchor", batch_anchor])
    for lesson_run_id in args.lesson_run_ids or []:
        merge_cmd.extend(["--lesson-run-id", lesson_run_id])
    run_step(merge_cmd)

    if not args.skip_normalize:
        normalize_cmd = [
            sys.executable,
            str(REPO_ROOT / "scripts" / "normalize_sqlite.py"),
            "--dataset-id",
            dataset_id,
            "--db",
            args.db,
        ]
        if args.normalize_auto_merge:
            normalize_cmd.append("--auto-merge")
        run_step(normalize_cmd)

    if not args.skip_qa:
        run_step(
            [
                sys.executable,
                str(REPO_ROOT / "scripts" / "strict_qa_sqlite.py"),
                "--dataset-id",
                dataset_id,
                "--db",
                args.db,
            ]
        )

    if not args.skip_integrity:
        run_step(
            [
                sys.executable,
                str(REPO_ROOT / "scripts" / "check_graph_integrity.py"),
                "--dataset-id",
                dataset_id,
                "--db",
                args.db,
            ]
        )

    if args.lesson_run_ids:
        lesson_run_ids = list(args.lesson_run_ids)
    else:
        params: list[str] = [dataset_id]
        filters = ["dataset_id = ?", "status = 'merged'"]
        if args.book_id:
            filters.append("book_id = ?")
            params.append(args.book_id)
        if args.batch_anchors:
            placeholders = ",".join(["?"] * len(args.batch_anchors))
            filters.append(f"batch_anchor IN ({placeholders})")
            params.extend(args.batch_anchors)
        selected_rows = connection.execute(
            f"""
            SELECT lesson_run_id
            FROM lesson_runs
            WHERE {' AND '.join(filters)}
            ORDER BY lesson_run_id
            """,
            params,
        ).fetchall()
        lesson_run_ids = [row["lesson_run_id"] for row in selected_rows]
    with connection:
        mark_qa_passed(connection, dataset_id, lesson_run_ids)

    print(
        f"Parallel lesson pipeline completed for dataset '{dataset_id}' with {len(lesson_run_ids)} lesson runs."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
