#!/usr/bin/env python3
"""One-time migration: SQLite → PostgreSQL.

Reads all data from the existing SQLite database and inserts it into
PostgreSQL, respecting foreign key order and converting types
(TEXT _json → JSONB, embedding_json → vector, etc.).
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Tables in FK-safe insertion order
TABLE_ORDER = [
    "datasets",
    "source_artifacts",
    "nodes",
    "node_terms",
    "edges",
    "profiles",
    "profile_textbooks",
    "mentions",
    "evidence",
    "evidence_links",
    "node_cards",
    "retrieval_candidates",
    "batch_runtime_records",
    "lesson_runs",
    "staging_nodes",
    "staging_edges",
    "staging_profiles",
    "staging_mentions",
    "staging_evidence",
    "staging_node_cards",
    "merge_runs",
    "canonical_node_map",
    "relation_proposals",
    "review_queue",
]

# JSONB columns per table (suffix _json, value is stored as TEXT in SQLite)
JSONB_COLUMNS: dict[str, list[str]] = {
    "source_artifacts": ["properties_json"],
    "nodes": [
        "aliases_json", "learning_modes_json", "bridge_tags_json",
        "framework_refs_json", "profile_refs_json", "same_as_refs_json",
        "properties_json",
    ],
    "edges": [
        "framework_refs_json", "profile_refs_json", "source_refs_json",
        "properties_json",
    ],
    "profiles": [
        "framework_refs_json", "textbook_refs_json", "textbook_ids_json",
        "learning_objectives_json", "assessment_signals_json",
        "source_refs_json", "properties_json",
    ],
    "mentions": ["source_refs_json", "properties_json"],
    "evidence": ["normalized_claims_json", "properties_json"],
    "node_cards": [
        "pattern_refs_json", "framework_refs_json", "profile_refs_json",
        "mention_refs_json", "source_refs_json", "sections_json",
        "properties_json",
    ],
    "retrieval_candidates": ["filters_json"],
    "batch_runtime_records": ["payload_json"],
    "lesson_runs": ["counts_json", "properties_json"],
    "staging_nodes": [
        "aliases_json", "learning_modes_json", "bridge_tags_json",
        "framework_refs_json", "profile_refs_json", "same_as_refs_json",
        "properties_json", "source_refs_json",
    ],
    "staging_edges": [
        "framework_refs_json", "profile_refs_json", "source_refs_json",
        "properties_json",
    ],
    "staging_profiles": [
        "framework_refs_json", "textbook_refs_json", "textbook_ids_json",
        "learning_objectives_json", "assessment_signals_json",
        "source_refs_json", "properties_json",
    ],
    "staging_mentions": ["source_refs_json", "properties_json"],
    "staging_evidence": ["normalized_claims_json", "properties_json"],
    "staging_node_cards": [
        "pattern_refs_json", "framework_refs_json", "profile_refs_json",
        "mention_refs_json", "source_refs_json", "sections_json",
        "properties_json",
    ],
    "merge_runs": ["selection_json", "stats_json"],
    "canonical_node_map": ["rationale_json"],
    "relation_proposals": ["evidence_refs_json", "properties_json"],
    "review_queue": ["details_json"],
}

# Embedding columns (TEXT in SQLite → vector(1024) in PG)
EMBEDDING_COLUMNS: dict[str, str] = {
    "nodes": "embedding_json",
    "staging_nodes": "embedding_json",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate SQLite data to PostgreSQL")
    parser.add_argument(
        "--sqlite",
        default=str(REPO_ROOT / "storage" / "knowledge.sqlite"),
        help="Path to SQLite database file",
    )
    parser.add_argument(
        "--pg",
        default=None,
        help="PostgreSQL connection URL (default: $DATABASE_URL)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Rows per batch insert (default: 500)",
    )
    return parser.parse_args()


def get_sqlite_tables(conn: sqlite3.Connection) -> set[str]:
    """Get all table names from SQLite."""
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return {row[0] for row in rows}


def get_sqlite_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    """Get column names for a SQLite table."""
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [row[1] for row in rows]


def convert_row(
    row: dict,
    table: str,
    jsonb_cols: list[str],
    embedding_col: str | None,
) -> dict:
    """Convert a single row from SQLite format to PG format."""
    result = dict(row)

    # Convert JSONB columns: TEXT → native Python object (psycopg3 auto-serializes to JSONB)
    for col in jsonb_cols:
        if col in result and isinstance(result[col], str):
            try:
                result[col] = json.loads(result[col])
            except json.JSONDecodeError:
                result[col] = {} if col.endswith("_json") and "properties" in col else []

    # Convert embedding columns: TEXT JSON array → Python list (will be cast to vector)
    if embedding_col and embedding_col in result:
        emb_val = result[embedding_col]
        if isinstance(emb_val, str):
            try:
                vec = json.loads(emb_val)
                if isinstance(vec, list) and len(vec) > 0:
                    result["embedding"] = vec
                else:
                    result["embedding"] = None
            except json.JSONDecodeError:
                result["embedding"] = None
        del result[embedding_col]

    return result


def migrate_table(
    sqlite_conn: sqlite3.Connection,
    pg_conn,
    table: str,
    batch_size: int,
) -> int:
    """Migrate one table from SQLite to PostgreSQL."""
    import psycopg
    from psycopg.rows import dict_row

    columns = get_sqlite_columns(sqlite_conn, table)
    if not columns:
        return 0

    jsonb_cols = JSONB_COLUMNS.get(table, [])
    embedding_col = EMBEDDING_COLUMNS.get(table)

    # Adjust column list for embedding → rename embedding_json → embedding
    pg_columns = list(columns)
    if embedding_col and embedding_col in pg_columns:
        pg_columns.remove(embedding_col)
        pg_columns.append("embedding")

    # Read all rows from SQLite
    sqlite_conn.row_factory = sqlite3.Row
    rows = sqlite_conn.execute(f"SELECT * FROM {table}").fetchall()

    if not rows:
        print(f"  {table}: 0 rows (empty)")
        return 0

    # Convert rows
    converted = []
    for row in rows:
        row_dict = dict(row)
        converted_row = convert_row(row_dict, table, jsonb_cols, embedding_col)
        # Reorder to match pg_columns
        ordered = []
        for col in pg_columns:
            ordered.append(converted_row.get(col))
        converted.append(tuple(ordered))

    # Insert into PG in batches
    col_list = ", ".join(f'"{c}"' for c in pg_columns)
    placeholders = ", ".join(["%s"] * len(pg_columns))

    with pg_conn.cursor() as cur:
        for i in range(0, len(converted), batch_size):
            batch = converted[i : i + batch_size]
            psycopg.extras.execute_values(
                cur,
                f'INSERT INTO {table} ({col_list}) VALUES %s ON CONFLICT DO NOTHING',
                batch,
                template=f"({placeholders})",
            )

    print(f"  {table}: {len(converted)} rows migrated")
    return len(converted)


def rebuild_search_tables(pg_conn) -> None:
    """Populate FTS search tables from canonical data."""
    with pg_conn.cursor() as cur:
        # node_search
        cur.execute("DELETE FROM node_search")
        cur.execute("""
            INSERT INTO node_search (dataset_id, node_id, search_vector)
            SELECT dataset_id, id,
                   to_tsvector('jiebacfg',
                     coalesce(canonical_name, '') || ' ' ||
                     coalesce(definition, '') || ' ' ||
                     coalesce(array_to_string(aliases_json, ' '), ''))
            FROM nodes WHERE status != 'deprecated'
        """)

        # profile_search
        cur.execute("DELETE FROM profile_search")
        cur.execute("""
            INSERT INTO profile_search (dataset_id, profile_id, search_vector)
            SELECT dataset_id, id,
                   to_tsvector('jiebacfg',
                     coalesce(array_to_string(learning_objectives_json, ' '), '') || ' ' ||
                     coalesce(array_to_string(assessment_signals_json, ' '), ''))
            FROM profiles
        """)

        # evidence_search
        cur.execute("DELETE FROM evidence_search")
        cur.execute("""
            INSERT INTO evidence_search (dataset_id, evidence_id, search_vector)
            SELECT dataset_id, id,
                   to_tsvector('jiebacfg',
                     coalesce(excerpt, '') || ' ' ||
                     coalesce(locator, '') || ' ' ||
                     coalesce(array_to_string(normalized_claims_json, ' '), ''))
            FROM evidence
        """)

        # card_search
        cur.execute("DELETE FROM card_search")
        cur.execute("""
            INSERT INTO card_search (dataset_id, node_id, search_vector)
            SELECT dataset_id, node_id,
                   to_tsvector('jiebacfg',
                     coalesce(title, '') || ' ' ||
                     coalesce(summary, '') || ' ' ||
                     coalesce(sections_json::text, ''))
            FROM node_cards
        """)

    print("  Search tables rebuilt with tsvector")


def verify_row_counts(
    sqlite_conn: sqlite3.Connection,
    pg_conn,
) -> dict[str, tuple[int, int]]:
    """Compare row counts between SQLite and PG for each table."""
    import psycopg

    results = {}
    with pg_conn.cursor() as cur:
        for table in TABLE_ORDER:
            sqlite_count = sqlite_conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            pg_count = cur.fetchone()[0]
            results[table] = (sqlite_count, pg_count)

    return results


def main() -> int:
    args = parse_args()

    sqlite_path = Path(args.sqlite).expanduser().resolve()
    if not sqlite_path.exists():
        print(f"Error: SQLite database not found: {sqlite_path}")
        return 1

    pg_url = args.pg or os.environ.get("DATABASE_URL")
    if not pg_url:
        print("Error: PostgreSQL URL not provided. Set DATABASE_URL or pass --pg")
        return 1

    print(f"Source: {sqlite_path}")
    import re
    safe_url = re.sub(r":[^:@]+@", ":****@", pg_url)
    print(f"Target: {safe_url}")

    # Connect to SQLite
    sqlite_conn = sqlite3.connect(str(sqlite_path))
    sqlite_conn.row_factory = sqlite3.Row

    # Connect to PostgreSQL
    import psycopg
    from psycopg.rows import dict_row

    pg_conn = psycopg.connect(pg_url, row_factory=dict_row, autocommit=False)

    # Check which tables exist in SQLite
    sqlite_tables = get_sqlite_tables(sqlite_conn)
    tables_to_migrate = [t for t in TABLE_ORDER if t in sqlite_tables]

    print(f"\nMigrating {len(tables_to_migrate)} tables...")

    total = 0
    for table in tables_to_migrate:
        try:
            count = migrate_table(sqlite_conn, pg_conn, table, args.batch_size)
            total += count
        except Exception as e:
            print(f"  ERROR migrating {table}: {e}")
            pg_conn.rollback()
            return 1

    # Rebuild search tables
    print("\nRebuilding search tables...")
    rebuild_search_tables(pg_conn)

    pg_conn.commit()

    # Verify
    print("\nVerifying row counts...")
    results = verify_row_counts(sqlite_conn, pg_conn)

    all_match = True
    for table, (sqlite_count, pg_count) in results.items():
        match = "✓" if sqlite_count == pg_count else "✗"
        if sqlite_count != pg_count:
            all_match = False
        if sqlite_count > 0 or pg_count > 0:
            print(f"  {table}: SQLite={sqlite_count}, PG={pg_count} {match}")

    sqlite_conn.close()
    pg_conn.close()

    if all_match:
        print(f"\nMigration complete! {total} rows migrated successfully.")
        return 0
    else:
        print("\nWARNING: Row count mismatch detected!")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
