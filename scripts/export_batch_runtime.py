#!/usr/bin/env python3
"""Export one batch's SQLite runtime records back into JSONL files for debugging."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    RUNTIME_RECORD_TYPES,
    connect_db,
    ensure_sqlite_schema,
    load_batch_runtime_records,
    require_dataset_row,
    resolve_dataset_id,
    resolve_outline_anchor,
    runtime_batch_dir,
    safe_path_token,
)


RUNTIME_FILENAMES = {
    "query": "queries.jsonl",
    "node": "nodes.jsonl",
    "profile": "profiles.jsonl",
    "mention": "mentions.jsonl",
    "evidence": "evidence.jsonl",
    "node_card": "node-cards.jsonl",
    "relation_proposal": "relation-proposals.jsonl",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export one SQLite runtime batch into JSONL debug files."
    )
    parser.add_argument("--root", required=True, help="Versioned output root, for example data/v5")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--batch-anchor", required=True)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    return parser.parse_args()


def write_jsonl(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records)
    path.write_text(payload, encoding="utf-8")


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    batch_anchor = resolve_outline_anchor(args.book_id, args.batch_anchor, strict=True)

    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, root)
    require_dataset_row(connection, dataset_id)

    target_dir = runtime_batch_dir(root, args.book_id)
    anchor_token = safe_path_token(batch_anchor)
    exported = 0
    for record_type in RUNTIME_RECORD_TYPES:
        records = load_batch_runtime_records(
            connection,
            dataset_id,
            args.book_id,
            batch_anchor,
            record_type,
        )
        if not records:
            continue
        filename = f"{anchor_token}.{RUNTIME_FILENAMES[record_type]}"
        write_jsonl(target_dir / filename, records)
        exported += len(records)
        print(f"Wrote {filename} ({len(records)})")

    if exported == 0:
        print(f"No SQLite runtime records found for batch '{batch_anchor}'.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
