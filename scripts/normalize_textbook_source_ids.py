#!/usr/bin/env python3
"""Normalize textbook source_id values to canonical outline book_id."""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    ensure_sqlite_schema,
    normalize_textbook_source_id,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Normalize textbook source_id values in SQLite using anchor_ref book_id.",
    )
    parser.add_argument("--dataset-id", required=True, help="Dataset ID to repair.")
    parser.add_argument(
        "--db",
        default=str(DEFAULT_DB_PATH),
        help="Path to SQLite database.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the normalized source_id values back to SQLite.",
    )
    return parser.parse_args()


def find_updates(connection, dataset_id: str, table: str) -> list[tuple[str, str, str]]:
    rows = connection.execute(
        f"""
        SELECT id, source_type, source_id, anchor_ref
        FROM {table}
        WHERE dataset_id = ?
          AND source_type = 'textbook'
        ORDER BY id
        """,
        (dataset_id,),
    ).fetchall()

    updates: list[tuple[str, str, str]] = []
    for row in rows:
        normalized_source_id = normalize_textbook_source_id(
            row["source_type"],
            row["source_id"],
            row["anchor_ref"],
        )
        if normalized_source_id and normalized_source_id != row["source_id"]:
            updates.append((normalized_source_id, dataset_id, row["id"]))
    return updates


def main() -> int:
    args = parse_args()
    connection = connect_db(Path(args.db))
    ensure_sqlite_schema(connection)

    updates_by_table = {
        "mentions": find_updates(connection, args.dataset_id, "mentions"),
        "evidence": find_updates(connection, args.dataset_id, "evidence"),
    }

    total_updates = sum(len(items) for items in updates_by_table.values())
    print(f"Dataset: {args.dataset_id}")
    print(f"Pending textbook source_id repairs: {total_updates}")

    for table, updates in updates_by_table.items():
        if not updates:
            print(f"  {table}: 0")
            continue
        target_counts = Counter(item[0] for item in updates)
        print(f"  {table}: {len(updates)}")
        for source_id, count in sorted(target_counts.items()):
            print(f"    -> {source_id}: {count}")

    if not args.apply or total_updates == 0:
        if not args.apply:
            print("Dry run only. Re-run with --apply to write changes.")
        return 0

    with connection:
        for table, updates in updates_by_table.items():
            connection.executemany(
                f"UPDATE {table} SET source_id = ? WHERE dataset_id = ? AND id = ?",
                updates,
            )

    print("Applied textbook source_id normalization.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
