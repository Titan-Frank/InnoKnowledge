#!/usr/bin/env python3
"""Backfill edge_layer and backbone_expand from node layers for existing edges."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from export_snapshot import export_dataset
from knowledge_store_common import DEFAULT_DB_PATH, connect_db, ensure_sqlite_schema, require_dataset_row, resolve_dataset_id
from promote_relation_proposals import infer_edge_presentation, load_node_layers


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill stale edge presentation fields from endpoint node layers."
    )
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument("--output-root")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--include-support-support",
        action="store_true",
        help="Also rewrite support-support edges from backbone to support when inferred.",
    )
    parser.add_argument("--export-snapshot", action="store_true")
    return parser.parse_args()


def should_update_edge(
    current_edge_layer: str,
    current_backbone_expand: int,
    inferred_edge_layer: str,
    inferred_backbone_expand: int,
    from_layer: str | None,
    to_layer: str | None,
    *,
    include_support_support: bool,
) -> bool:
    if current_edge_layer == inferred_edge_layer and current_backbone_expand == inferred_backbone_expand:
        return False

    node_layers = {from_layer, to_layer}
    if node_layers == {"backbone", "support"}:
        return True
    if include_support_support and node_layers == {"support"} and inferred_edge_layer == "support":
        return True
    return False


def main() -> int:
    args = parse_args()
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, args.output_root)
    require_dataset_row(connection, dataset_id)
    node_layers = load_node_layers(connection, dataset_id)

    rows = connection.execute(
        """
        SELECT id, from_id, to_id, edge_layer, backbone_expand, properties_json
        FROM edges
        WHERE dataset_id = ?
        ORDER BY id
        """,
        (dataset_id,),
    ).fetchall()

    updates: list[tuple[str, int, str]] = []
    stats: Counter[str] = Counter()
    for row in rows:
        properties = json.loads(row["properties_json"] or "{}")
        inferred_edge_layer, inferred_backbone_expand = infer_edge_presentation(
            properties,
            node_layers.get(row["from_id"]),
            node_layers.get(row["to_id"]),
        )
        if not should_update_edge(
            row["edge_layer"],
            int(row["backbone_expand"]),
            inferred_edge_layer,
            inferred_backbone_expand,
            node_layers.get(row["from_id"]),
            node_layers.get(row["to_id"]),
            include_support_support=args.include_support_support,
        ):
            continue
        updates.append((inferred_edge_layer, inferred_backbone_expand, row["id"]))
        stats["edges_to_update"] += 1

    if not args.apply:
        print(f"Dataset '{dataset_id}' edges needing presentation backfill: {stats['edges_to_update']}")
        for edge_layer, backbone_expand, edge_id in updates[:20]:
            print(
                json.dumps(
                    {
                        "edge_id": edge_id,
                        "edge_layer": edge_layer,
                        "backbone_expand": bool(backbone_expand),
                    },
                    ensure_ascii=False,
                )
            )
        return 0

    with connection:
        connection.executemany(
            """
            UPDATE edges
            SET edge_layer = ?,
                backbone_expand = ?
            WHERE dataset_id = ? AND id = ?
            """,
            [
                (edge_layer, backbone_expand, dataset_id, edge_id)
                for edge_layer, backbone_expand, edge_id in updates
            ],
        )

    print(f"Updated {len(updates)} edges in dataset '{dataset_id}'.")
    if args.export_snapshot and args.output_root:
        export_stats = export_dataset(connection, dataset_id, Path(args.output_root).expanduser().resolve())
        print(json.dumps({"snapshot_exported": True, **export_stats}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
