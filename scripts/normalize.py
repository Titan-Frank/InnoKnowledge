#!/usr/bin/env python3
"""Normalize world knowledge graph in PostgreSQL."""

from __future__ import annotations

import argparse
from collections import defaultdict
from typing import Any

from knowledge_store_common import (
    HIERARCHICAL_EDGE_TYPES,
    connect_db,
    ensure_pg_schema,
    rebuild_node_terms,
    utc_now,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalize world graph.")
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--db")
    parser.add_argument("--auto-merge", action="store_true")
    return parser.parse_args()


def normalize_cards(connection, dataset_id: str) -> int:
    updated = 0
    with connection.cursor() as cur:
        cur.execute(
            "SELECT node_id, sections_json FROM world_node_cards WHERE dataset_id = %s",
            (dataset_id,),
        )
        rows = cur.fetchall()
    for row in rows:
        sections = row["sections_json"] if isinstance(row["sections_json"], list) else []
        modified = False
        for index, section in enumerate(sections):
            if not isinstance(section, dict):
                continue
            if not section.get("id"):
                section["id"] = f"section-{index}"
                modified = True
            if not section.get("title"):
                section["title"] = section["id"]
                modified = True
            if not section.get("section_type"):
                section["section_type"] = "other"
                modified = True
            content = section.get("content")
            if isinstance(content, list):
                cleaned = [str(item).strip() for item in content if str(item).strip()]
                if cleaned != content:
                    section["content"] = cleaned
                    modified = True
        if modified:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    UPDATE world_node_cards
                    SET sections_json = %s::jsonb, updated_at = %s
                    WHERE dataset_id = %s AND node_id = %s
                    """,
                    (__import__("json").dumps(sections, ensure_ascii=False), utc_now(), dataset_id, row["node_id"]),
                )
            updated += 1
    return updated


def deduplicate_edges(connection, dataset_id: str) -> int:
    removed = 0
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT from_id, to_id, type, array_agg(id ORDER BY created_at) AS ids
            FROM world_edges
            WHERE dataset_id = %s AND status != 'deprecated'
            GROUP BY from_id, to_id, type
            HAVING COUNT(*) > 1
            """,
            (dataset_id,),
        )
        rows = cur.fetchall()
    for row in rows:
        for edge_id in row["ids"][1:]:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    UPDATE world_edges
                    SET status = 'deprecated', updated_at = %s
                    WHERE dataset_id = %s AND id = %s
                    """,
                    (utc_now(), dataset_id, edge_id),
                )
            removed += 1
    return removed


def find_cycles(connection, dataset_id: str) -> list[list[str]]:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT from_id, to_id, type
            FROM world_edges
            WHERE dataset_id = %s AND type = ANY(%s) AND status != 'deprecated'
            """,
            (dataset_id, list(HIERARCHICAL_EDGE_TYPES)),
        )
        rows = cur.fetchall()
    graph = defaultdict(list)
    for row in rows:
        graph[row["from_id"]].append(row["to_id"])
    visited: set[str] = set()
    stack: set[str] = set()
    path: list[str] = []
    cycles: list[list[str]] = []

    def dfs(node: str) -> None:
        visited.add(node)
        stack.add(node)
        path.append(node)
        for neighbor in graph.get(node, []):
            if neighbor not in visited:
                dfs(neighbor)
            elif neighbor in stack:
                start = path.index(neighbor)
                cycles.append(path[start:] + [neighbor])
        path.pop()
        stack.discard(node)

    for node in list(graph):
        if node not in visited:
            dfs(node)
    return cycles


def main() -> int:
    args = parse_args()
    connection = connect_db(args.db)
    ensure_pg_schema(connection)
    cards_updated = normalize_cards(connection, args.dataset_id)
    edges_removed = deduplicate_edges(connection, args.dataset_id)
    cycles = find_cycles(connection, args.dataset_id)
    rebuild_node_terms(connection, args.dataset_id)
    connection.commit()
    print(
        __import__("json").dumps(
            {
                "status": "success",
                "cards_updated": cards_updated,
                "edges_deduplicated": edges_removed,
                "cycle_count": len(cycles),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
