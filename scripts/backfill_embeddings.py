#!/usr/bin/env python3
"""Backfill embeddings for nodes that have NULL embedding vectors.

Supports both canonical `nodes` and `staging_nodes` tables.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types import TypeInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from embedding_client import embed_texts
from knowledge_store_common import connect_db, ensure_pg_schema


def register_vector_type(connection: psycopg.Connection) -> None:
    """Register the pgvector type so psycopg3 can handle ::vector casts."""
    info = TypeInfo.fetch(connection, "vector")
    if info is not None:
        info.register(connection)


# ── Canonical nodes ────────────────────────────────────────────────

def backfill_canonical(conn: psycopg.Connection, batch_size: int) -> int:
    """Backfill NULL embeddings in the `nodes` table. Returns count updated."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, canonical_name, definition, aliases_json FROM nodes "
            "WHERE embedding IS NULL"
        )
        rows = cur.fetchall()

    if not rows:
        print("[nodes] All nodes already have embeddings. Nothing to do.")
        return 0

    print(f"[nodes] Found {len(rows)} nodes needing embeddings.")
    return _backfill_rows(conn, rows, "nodes", "id", batch_size)


# ── Staging nodes ──────────────────────────────────────────────────

def backfill_staging(conn: psycopg.Connection, batch_size: int) -> int:
    """Backfill NULL embeddings in the `staging_nodes` table. Returns count updated."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT dataset_id, lesson_run_id, raw_node_id, canonical_name, "
            "definition, aliases_json FROM staging_nodes "
            "WHERE embedding IS NULL"
        )
        rows = cur.fetchall()

    if not rows:
        print("[staging_nodes] All nodes already have embeddings. Nothing to do.")
        return 0

    print(f"[staging_nodes] Found {len(rows)} nodes needing embeddings.")
    return _backfill_rows(conn, rows, "staging_nodes", "raw_node_id", batch_size)


# ── Shared logic ───────────────────────────────────────────────────

def _compose_text(row: dict) -> str:
    """Compose embedding input text: canonical_name + definition + aliases."""
    aliases = row.get("aliases_json") or []
    if isinstance(aliases, str):
        import json
        try:
            aliases = json.loads(aliases)
        except (json.JSONDecodeError, ValueError):
            aliases = []
    alias_str = "\u3001".join(str(a) for a in aliases if a) if aliases else ""
    parts = [row.get("canonical_name", ""), row.get("definition", "")]
    if alias_str:
        parts.append(alias_str)
    return " ".join(p for p in parts if p.strip())


def _backfill_rows(
    conn: psycopg.Connection,
    rows: list[dict],
    table: str,
    pk_col: str,
    batch_size: int,
) -> int:
    """Backfill embeddings for a list of rows. Returns count updated."""
    updated = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        texts = [_compose_text(r) for r in batch]

        print(f"  Embedding batch {i // batch_size + 1}: {len(batch)} texts ...")
        vectors = embed_texts(texts)

        for r, vec in zip(batch, vectors):
            if vec:
                with conn.cursor() as cur:
                    cur.execute(
                        f"UPDATE {table} SET embedding = %s::vector "
                        f"WHERE {pk_col} = %s",
                        (vec, r[pk_col]),
                    )
                    updated += cur.rowcount
            else:
                name = r.get("canonical_name", r.get("raw_node_id", "?"))
                print(f"  WARNING: empty vector for {r[pk_col]} ({name})")

        conn.commit()
        print(f"  Committed {len(batch)} embeddings.")

        if i + batch_size < len(rows):
            time.sleep(0.5)

    return updated


# ── Main ───────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill embeddings for nodes with NULL embedding vectors."
    )
    parser.add_argument(
        "--db",
        default=None,
        help="PostgreSQL connection URL (default: $DATABASE_URL)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Number of texts per embedding batch (default: 32)",
    )
    parser.add_argument(
        "--table",
        choices=["nodes", "staging_nodes", "both"],
        default="both",
        help="Which table(s) to backfill (default: both)",
    )
    args = parser.parse_args()

    db_url = args.db or os.environ.get("DATABASE_URL")
    if not db_url:
        print("Error: No database URL provided. Set DATABASE_URL or pass --db.")
        sys.exit(1)

    conn = connect_db(db_url)
    ensure_pg_schema(conn)
    register_vector_type(conn)

    total_updated = 0

    if args.table in ("nodes", "both"):
        total_updated += backfill_canonical(conn, args.batch_size)

    if args.table in ("staging_nodes", "both"):
        total_updated += backfill_staging(conn, args.batch_size)

    # Verify
    for table in ("nodes", "staging_nodes"):
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) AS total, COUNT(embedding) AS with_emb FROM {table}")
            row = cur.fetchone()
        null_count = row["total"] - row["with_emb"]
        print(f"[{table}] {row['with_emb']}/{row['total']} have embeddings, {null_count} still NULL.")

    print(f"Total embeddings updated: {total_updated}")
    conn.close()


if __name__ == "__main__":
    main()
