#!/usr/bin/env python3
"""Run the world-knowledge lesson staging pipeline end to end."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import psycopg

from knowledge_store_common import (
    connect_db,
    ensure_pg_schema,
    ensure_dataset,
    resolve_dataset_id,
    utc_now,
)


REPO_ROOT = Path(__file__).resolve().parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Merge staged lesson runs, normalize the canonical world graph, and run QA."
    )
    parser.add_argument("--root", required=True)
    parser.add_argument("--db", default=None, help="PostgreSQL URL (default: $DATABASE_URL)")
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
    connection: psycopg.Connection,
    dataset_id: str,
    lesson_run_ids: list[str],
) -> None:
    if not lesson_run_ids:
        return
    now = utc_now()
    with connection.cursor() as cur:
        psycopg.extras.execute_values(
            cur,
            """
            UPDATE world_lesson_runs
            SET status = 'qa_passed', updated_at = %s
            WHERE dataset_id = %s AND lesson_run_id = %s
            """,
            [(now, dataset_id, lr_id) for lr_id in lesson_run_ids],
        )
    connection.commit()


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    connection = connect_db(args.db)
    ensure_pg_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, root)
    ensure_dataset(connection, dataset_id, root)

    db_url = args.db or os.environ.get("DATABASE_URL", "")

    merge_cmd = [
        sys.executable,
        str(REPO_ROOT / "scripts" / "merge_staged_lessons.py"),
        "--root",
        str(root),
        "--db",
        db_url,
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
            str(REPO_ROOT / "scripts" / "normalize.py"),
            "--dataset-id",
            dataset_id,
            "--db",
            db_url,
        ]
        if args.normalize_auto_merge:
            normalize_cmd.append("--auto-merge")
        run_step(normalize_cmd)

    if not args.skip_qa:
        run_step(
            [
                sys.executable,
                str(REPO_ROOT / "scripts" / "strict_qa.py"),
                "--dataset-id",
                dataset_id,
                "--db",
                db_url,
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
                db_url,
            ]
        )

    if args.lesson_run_ids:
        lesson_run_ids = list(args.lesson_run_ids)
    else:
        params: list[str] = [dataset_id]
        filters = ["dataset_id = %s", "status = 'merged'"]
        if args.book_id:
            filters.append("book_id = %s")
            params.append(args.book_id)
        if args.batch_anchors:
            placeholders = ",".join(["%s"] * len(args.batch_anchors))
            filters.append(f"batch_anchor IN ({placeholders})")
            params.extend(args.batch_anchors)
        with connection.cursor() as cur:
            cur.execute(
                f"""
                SELECT lesson_run_id
                FROM world_lesson_runs
                WHERE {' AND '.join(filters)}
                ORDER BY lesson_run_id
                """,
                params,
            )
            selected_rows = cur.fetchall()
        lesson_run_ids = [row["lesson_run_id"] for row in selected_rows]

    mark_qa_passed(connection, dataset_id, lesson_run_ids)

    print(
        f"Parallel lesson pipeline completed for dataset '{dataset_id}' with {len(lesson_run_ids)} lesson runs."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
