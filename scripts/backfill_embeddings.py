#!/usr/bin/env python3
"""Backfill embeddings for world_nodes and world_staging_nodes."""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import psycopg
from psycopg.types import TypeInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from embedding_client import embed_texts
from knowledge_store_common import connect_db, ensure_pg_schema


def register_vector_type(connection: psycopg.Connection) -> None:
    info = TypeInfo.fetch(connection, "vector")
    if info is not None:
        info.register(connection)


def _compose_text(row: dict) -> str:
    aliases = row.get("aliases_json") or []
    domains = row.get("domains_json") or []
    alias_str = "、".join(str(a) for a in aliases if a) if aliases else ""
    domain_str = "、".join(str(d) for d in domains if d) if domains else ""
    parts = [row.get("name", ""), row.get("definition", ""), alias_str, domain_str]
    return " ".join(part for part in parts if part.strip())


def _backfill_rows(conn: psycopg.Connection, rows: list[dict], table: str, pk_col: str, batch_size: int) -> int:
    updated = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        vectors = embed_texts([_compose_text(row) for row in batch])
        for row, vector in zip(batch, vectors):
            if not vector:
                continue
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {table} SET embedding = %s::vector WHERE {pk_col} = %s",
                    (vector, row[pk_col]),
                )
                updated += cur.rowcount
        conn.commit()
        if i + batch_size < len(rows):
            time.sleep(0.5)
    return updated


def backfill_canonical(conn: psycopg.Connection, batch_size: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, definition, aliases_json, domains_json FROM world_nodes WHERE embedding IS NULL"
        )
        rows = cur.fetchall()
    if not rows:
        return 0
    return _backfill_rows(conn, rows, "world_nodes", "id", batch_size)


def backfill_staging(conn: psycopg.Connection, batch_size: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT raw_node_id, name, definition, aliases_json, domains_json FROM world_staging_nodes WHERE embedding IS NULL"
        )
        rows = cur.fetchall()
    if not rows:
        return 0
    return _backfill_rows(conn, rows, "world_staging_nodes", "raw_node_id", batch_size)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill embeddings for world knowledge nodes.")
    parser.add_argument("--db", default=None)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--table", choices=["world_nodes", "world_staging_nodes", "both"], default="both")
    args = parser.parse_args()
    db_url = args.db or os.environ.get("DATABASE_URL")
    if not db_url:
        print("Error: No database URL provided.")
        sys.exit(1)
    conn = connect_db(db_url)
    ensure_pg_schema(conn)
    register_vector_type(conn)
    total = 0
    if args.table in ("world_nodes", "both"):
        total += backfill_canonical(conn, args.batch_size)
    if args.table in ("world_staging_nodes", "both"):
        total += backfill_staging(conn, args.batch_size)
    print(f"Total embeddings updated: {total}")


if __name__ == "__main__":
    main()
