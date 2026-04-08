#!/usr/bin/env python3
"""Store one batch's runtime artifacts directly into SQLite staging tables."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    canonicalize_source_anchor,
    connect_db,
    ensure_dataset,
    ensure_sqlite_schema,
    normalize_textbook_source_id,
    resolve_dataset_id,
    resolve_outline_anchor,
    require_dataset_row,
    store_batch_runtime_records,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Store lesson runtime artifacts directly into SQLite batch_runtime_records."
    )
    parser.add_argument("--root", required=True, help="Versioned output root, for example data/v5")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--batch-anchor", required=True)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument("--queries-file")
    parser.add_argument("--queries-json")
    parser.add_argument("--nodes-file")
    parser.add_argument("--nodes-json")
    parser.add_argument("--profiles-file")
    parser.add_argument("--profiles-json")
    parser.add_argument("--mentions-file")
    parser.add_argument("--mentions-json")
    parser.add_argument("--evidence-file")
    parser.add_argument("--evidence-json")
    parser.add_argument("--node-cards-file")
    parser.add_argument("--node-cards-json")
    parser.add_argument(
        "--append",
        action="store_true",
        help="Append/update individual record ids instead of replacing each provided record type.",
    )
    return parser.parse_args()


def normalize_queries(records: list[dict], batch_anchor: str) -> list[dict]:
    normalized: list[dict] = []
    for record in records:
        payload = dict(record)
        payload.setdefault("batch_anchor", batch_anchor)
        normalized.append(payload)
    return normalized


def normalize_evidence(records: list[dict], book_id: str, batch_anchor: str) -> list[dict]:
    normalized: list[dict] = []
    for record in records:
        payload = dict(record)
        payload.setdefault("anchor_ref", batch_anchor)
        payload["source_id"] = normalize_textbook_source_id(
            payload.get("source_type"),
            payload.get("source_id"),
            payload.get("anchor_ref"),
            expected_book_id=book_id,
        )
        payload["anchor_ref"] = canonicalize_source_anchor(
            payload.get("source_type"),
            payload.get("source_id"),
            payload.get("anchor_ref"),
            expected_book_id=book_id,
        )
        normalized.append(payload)
    return normalized


def normalize_mentions(records: list[dict], book_id: str, batch_anchor: str) -> list[dict]:
    normalized: list[dict] = []
    for record in records:
        payload = dict(record)
        payload.setdefault("anchor_ref", batch_anchor)
        payload["source_id"] = normalize_textbook_source_id(
            payload.get("source_type"),
            payload.get("source_id"),
            payload.get("anchor_ref"),
            expected_book_id=book_id,
        )
        payload["anchor_ref"] = canonicalize_source_anchor(
            payload.get("source_type"),
            payload.get("source_id"),
            payload.get("anchor_ref"),
            expected_book_id=book_id,
        )
        normalized.append(payload)
    return normalized

def load_records(file_arg: str | None, json_arg: str | None, label: str) -> list[dict]:
    if file_arg and json_arg:
        raise SystemExit(f"Provide only one of --{label}-file or --{label}-json.")
    if file_arg:
        raise NotImplementedError("JSONL loading is deprecated. Use SQLite-first workflow.")
    if json_arg:
        payload = json.loads(json_arg)
        if not isinstance(payload, list):
            raise SystemExit(f"--{label}-json must be a JSON array.")
        return payload
    return []


def main() -> int:
    args = parse_args()
    _root = Path(args.root).expanduser().resolve()
    batch_anchor = resolve_outline_anchor(args.book_id, args.batch_anchor, strict=True)

    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, _root)
    ensure_dataset(connection, dataset_id, _root)
    require_dataset_row(connection, dataset_id)

    inputs: list[tuple[str, str, str | None, str | None, callable]] = [
        ("query", "queries", args.queries_file, args.queries_json, lambda rows: normalize_queries(rows, batch_anchor)),
        ("node", "nodes", args.nodes_file, args.nodes_json, lambda rows: rows),
        ("profile", "profiles", args.profiles_file, args.profiles_json, lambda rows: rows),
        (
            "mention",
            "mentions",
            args.mentions_file,
            args.mentions_json,
            lambda rows: normalize_mentions(rows, args.book_id, batch_anchor),
        ),
        (
            "evidence",
            "evidence",
            args.evidence_file,
            args.evidence_json,
            lambda rows: normalize_evidence(rows, args.book_id, batch_anchor),
        ),
        ("node_card", "node-cards", args.node_cards_file, args.node_cards_json, lambda rows: rows),
    ]

    stats: Counter[str] = Counter()
    with connection:
        for record_type, label, file_arg, json_arg, normalizer in inputs:
            records = load_records(file_arg, json_arg, label)
            if not records:
                continue
            records = normalizer(records)
            count = store_batch_runtime_records(
                connection,
                dataset_id,
                args.book_id,
                batch_anchor,
                record_type,
                records,
                replace=not args.append,
            )
            stats[f"{record_type}_records"] = count

    print(f"Stored SQLite runtime batch '{batch_anchor}' for dataset '{dataset_id}'")
    for key in sorted(stats):
        print(f"  {key}: {stats[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
