#!/usr/bin/env python3
"""Backfill embeddings for canonical nodes that have NULL embedding vectors."""

from __future__ import annotations

import argparse
import os
import sys
import time

import psycopg
from psycopg.rows import dict_row
from psycopg.types import TypeInfo

sys.path.insert(0, ".")
from scripts.embedding_client import embed_texts
from knowledge_store_common import connect_db, ensure_pg_schema


def register_vector_type(connection: psycopg.Connection) -> None:
    """Register the pgvector type so psycopg3 can handle ::vector casts."""
    info = TypeInfo.fetch(connection, "vector")
    if info is not None:
        info.register(connection)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill embeddings for canonical nodes that have NULL embedding vectors."
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
    args = parser.parse_args()

    db_url = args.db or os.environ.get("DATABASE_URL")
    if not db_url:
        print("Error: No database URL provided. Set DATABASE_URL or pass --db.")
        sys.exit(1)

    conn = connect_db(db_url)
    ensure_pg_schema(conn)
    register_vector_type(conn)

    batch_size = args.batch_size

    # Find nodes with NULL embeddings
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, canonical_name, definition, aliases_json FROM nodes "
            "WHERE embedding IS NULL"
        )
        rows = cur.fetchall()

    if not rows:
        print("All nodes already have embeddings. Nothing to do.")
        conn.close()
        return

    print(f"Found {len(rows)} nodes needing embeddings.")

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        texts = []
        for r in batch:
            # aliases_json is JSONB — already a Python list
            aliases = r["aliases_json"] if isinstance(r["aliases_json"], list) else []
            alias_str = "\u3001".join(aliases) if aliases else ""
            parts = [r["canonical_name"], r["definition"]]
            if alias_str:
                parts.append(alias_str)
            texts.append(" ".join(parts))

        print(f"Embedding batch {i // batch_size + 1}: {len(batch)} texts ...")
        vectors = embed_texts(texts)

        for r, vec in zip(batch, vectors):
            if vec:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE nodes SET embedding = %s::vector WHERE id = %s",
                        (vec, r["id"]),
                    )
            else:
                print(f"  WARNING: empty vector for {r['id']} ({r['canonical_name']})")

        conn.commit()
        print(f"  Committed {len(batch)} embeddings.")

        # Small delay between batches to avoid overwhelming the API
        if i + batch_size < len(rows):
            time.sleep(0.5)

    # Verify
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM nodes WHERE embedding IS NULL")
        remaining = cur.fetchone()["count"]
        cur.execute("SELECT COUNT(*) FROM nodes")
        total = cur.fetchone()["count"]
    with_emb = total - remaining
    print(f"Done. {with_emb}/{total} nodes now have embeddings.")

    conn.close()


if __name__ == "__main__":
    main()
