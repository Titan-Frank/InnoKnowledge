#!/usr/bin/env python3
"""Finalize one lesson batch by running SQLite-native normalization."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    ensure_sqlite_schema,
    require_dataset_row,
    resolve_dataset_id,
    resolve_outline_anchor,
)


REPO_ROOT = Path(__file__).resolve().parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Finalize one batch by normalizing the SQLite knowledge store."
    )
    parser.add_argument(
        "--root", required=True, help="Versioned output root, for example data/v5"
    )
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--batch-anchor", required=True)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument(
        "--auto-merge",
        action="store_true",
        help="Allow normalize_sqlite.py to auto-merge high-confidence duplicate nodes.",
    )
    parser.add_argument(
        "--similarity-threshold",
        type=float,
        default=0.85,
        help="Similarity threshold passed through to normalize_sqlite.py.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run normalization in dry-run mode without mutating SQLite.",
    )
    return parser.parse_args()


def run_step(args: list[str]) -> None:
    subprocess.run(args, check=True)


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    resolved_batch_anchor = resolve_outline_anchor(
        args.book_id, args.batch_anchor, strict=False
    )
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, root)
    require_dataset_row(connection, dataset_id)

    print(
        f"Finalizing batch '{resolved_batch_anchor}' for dataset '{dataset_id}' via normalize_sqlite.py"
    )

    normalize_cmd = [
        sys.executable,
        str(REPO_ROOT / "scripts" / "normalize_sqlite.py"),
        "--dataset-id",
        dataset_id,
        "--db",
        args.db,
        "--similarity-threshold",
        str(args.similarity_threshold),
    ]
    if args.auto_merge:
        normalize_cmd.append("--auto-merge")
    if args.dry_run:
        normalize_cmd.append("--dry-run")
    run_step(normalize_cmd)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
