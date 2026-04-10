#!/usr/bin/env python3
"""Backfill embeddings for canonical nodes that have empty embedding_json."""

from __future__ import annotations

import json
import sqlite3
import sys
import time

sys.path.insert(0, ".")
from scripts.embedding_client import embed_texts


def main() -> None:
    db_path = "storage/knowledge.sqlite"
    batch_size = 32

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Find nodes with empty or placeholder embeddings
    rows = conn.execute(
        "SELECT id, canonical_name, definition, aliases_json FROM nodes "
        "WHERE LENGTH(embedding_json) < 10"
    ).fetchall()

    if not rows:
        print("All nodes already have embeddings. Nothing to do.")
        conn.close()
        return

    print(f"Found {len(rows)} nodes needing embeddings.")

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        texts = []
        for r in batch:
            aliases = json.loads(r["aliases_json"]) if r["aliases_json"] else []
            alias_str = "、".join(aliases) if aliases else ""
            parts = [r["canonical_name"], r["definition"]]
            if alias_str:
                parts.append(alias_str)
            texts.append(" ".join(parts))

        print(f"Embedding batch {i // batch_size + 1}: {len(batch)} texts ...")
        vectors = embed_texts(texts)

        for r, vec in zip(batch, vectors):
            if vec:
                emb_json = json.dumps(vec, ensure_ascii=False)
                conn.execute(
                    "UPDATE nodes SET embedding_json = ? WHERE id = ?",
                    (emb_json, r["id"]),
                )
            else:
                print(f"  WARNING: empty vector for {r['id']} ({r['canonical_name']})")

        conn.commit()
        print(f"  Committed {len(batch)} embeddings.")

        # Small delay between batches to avoid overwhelming the API
        if i + batch_size < len(rows):
            time.sleep(0.5)

    # Verify
    remaining = conn.execute(
        "SELECT COUNT(*) FROM nodes WHERE LENGTH(embedding_json) < 10"
    ).fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
    with_emb = total - remaining
    print(f"Done. {with_emb}/{total} nodes now have embeddings.")

    conn.close()


if __name__ == "__main__":
    main()
