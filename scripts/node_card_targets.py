#!/usr/bin/env python3
"""
List node-card expansion targets for one batch.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from knowledge_store_common import resolve_outline_anchors


def split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def load_jsonl(path: Path) -> list[dict]:
    records: list[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def safe_node_id(node_id: str) -> str:
    return node_id.replace(":", "__").replace("/", "__")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, help="Versioned output root, e.g. data/v4")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--anchors", required=True, help="Comma-separated outline anchor ids.")
    parser.add_argument("--include-support", action="store_true")
    parser.add_argument("--missing-only", action="store_true")
    parser.add_argument("--format", choices=("text", "json"), default="text")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    root = Path(args.root)
    anchor_set = set(resolve_outline_anchors(args.book_id, split_csv(args.anchors), strict=True))

    nodes = load_jsonl(root / "graph" / "knowledge.nodes.jsonl")
    mentions = load_jsonl(root / "graph" / f"{args.book_id}.mentions.jsonl")
    node_by_id = {record["id"]: record for record in nodes if record.get("id")}
    node_cards_dir = root / "node_cards"

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
            if not (node_cards_dir / f"{safe_node_id(node_id)}.json").exists()
        ]

    if args.format == "json":
        print(json.dumps(target_node_ids, ensure_ascii=False, indent=2))
    else:
        for node_id in target_node_ids:
            print(node_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
