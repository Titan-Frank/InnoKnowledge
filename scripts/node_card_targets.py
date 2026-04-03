#!/usr/bin/env python3
"""
List node-card expansion targets for one batch.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from knowledge_store_common import load_mentions, load_node_cards_cards, load_nodes
from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    ensure_sqlite_schema,
    require_dataset_row,
    resolve_dataset_id,
    resolve_outline_anchors,
)


def split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, help="Versioned output root, e.g. data/v4")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--anchors", required=True, help="Comma-separated outline anchor ids.")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument("--include-support", action="store_true")
    parser.add_argument("--missing-only", action="store_true")
    parser.add_argument("--format", choices=("text", "json"), default="text")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    root = Path(args.root)
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, root)
    require_dataset_row(connection, dataset_id)
    anchor_set = set(resolve_outline_anchors(args.book_id, split_csv(args.anchors), strict=True))

    nodes = load_nodes(connection, dataset_id)
    mentions = [
        record
        for record in load_mentions(connection, dataset_id)
        if record.get("source_type") == "textbook" and record.get("source_id") == args.book_id
    ]
    node_by_id = {record["id"]: record for record in nodes if record.get("id")}
    node_card_ids = {record["node_id"] for record in load_node_cards_cards(connection, dataset_id)}

    target_node_ids = sorted(
        {
            mention["target_id"]
            for mention in mentions
            if mention.get("anchor_ref") in anchor_set
            and mention.get("target_type") == "node"
            and mention.get("target_id") in node_by_id
            and (
                args.include_support or node_by_id[mention["target_id"]].get("node_layer") == "backbone"
            )
        }
    )

    if args.missing_only:
        target_node_ids = [
            node_id
            for node_id in target_node_ids
            if node_id not in node_card_ids
        ]

    if args.format == "json":
        print(json.dumps(target_node_ids, ensure_ascii=False, indent=2))
    else:
        for node_id in target_node_ids:
            print(node_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
