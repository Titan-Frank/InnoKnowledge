#!/usr/bin/env python3
"""Check world graph integrity: cycles, isolated nodes, connectivity."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict, deque
from typing import Any

from knowledge_store_common import HIERARCHICAL_EDGE_TYPES, connect_db, ensure_pg_schema


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check world graph integrity.")
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--db")
    parser.add_argument("--fail-on-cycles", action="store_true")
    return parser.parse_args()


class GraphIntegrityChecker:
    def __init__(self, connection, dataset_id: str):
        self.connection = connection
        self.dataset_id = dataset_id
        self.issues: dict[str, list[dict[str, Any]]] = {"cycles": [], "isolated_nodes": [], "weakly_connected": []}

    def check_cycles(self) -> int:
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT id, type, from_id, to_id
                FROM world_edges
                WHERE dataset_id = %s AND type = ANY(%s) AND status != 'deprecated'
                """,
                (self.dataset_id, list(HIERARCHICAL_EDGE_TYPES)),
            )
            rows = cur.fetchall()
        graph = defaultdict(list)
        edge_map = {}
        for row in rows:
            graph[row["from_id"]].append(row["to_id"])
            edge_map[(row["from_id"], row["to_id"])] = row["id"]
        visited: set[str] = set()
        stack: set[str] = set()
        path: list[str] = []

        def dfs(node: str) -> None:
            visited.add(node)
            stack.add(node)
            path.append(node)
            for neighbor in graph.get(node, []):
                if neighbor not in visited:
                    dfs(neighbor)
                elif neighbor in stack:
                    start = path.index(neighbor)
                    cycle_nodes = path[start:] + [neighbor]
                    self.issues["cycles"].append({"nodes": cycle_nodes})
            path.pop()
            stack.discard(node)

        for node in list(graph):
            if node not in visited:
                dfs(node)
        return len(self.issues["cycles"])

    def check_isolated_nodes(self) -> int:
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT n.id, n.name, n.kind
                FROM world_nodes n
                LEFT JOIN world_edges e1 ON n.id = e1.from_id AND e1.dataset_id = %s AND e1.status != 'deprecated'
                LEFT JOIN world_edges e2 ON n.id = e2.to_id AND e2.dataset_id = %s AND e2.status != 'deprecated'
                WHERE n.dataset_id = %s AND n.status != 'deprecated' AND e1.id IS NULL AND e2.id IS NULL
                """,
                (self.dataset_id, self.dataset_id, self.dataset_id),
            )
            rows = cur.fetchall()
        self.issues["isolated_nodes"] = [{"id": row["id"], "name": row["name"], "kind": row["kind"]} for row in rows]
        return len(rows)

    def check_weakly_connected(self) -> int:
        with self.connection.cursor() as cur:
            cur.execute(
                "SELECT from_id, to_id FROM world_edges WHERE dataset_id = %s AND status != 'deprecated'",
                (self.dataset_id,),
            )
            rows = cur.fetchall()
        graph = defaultdict(set)
        all_nodes = set()
        for row in rows:
            graph[row["from_id"]].add(row["to_id"])
            graph[row["to_id"]].add(row["from_id"])
            all_nodes.add(row["from_id"])
            all_nodes.add(row["to_id"])
        visited = set()
        components = []
        for start in all_nodes:
            if start in visited:
                continue
            queue = deque([start])
            component = set()
            while queue:
                node = queue.popleft()
                if node in visited:
                    continue
                visited.add(node)
                component.add(node)
                queue.extend(graph[node] - visited)
            components.append(component)
        large = [component for component in components if len(component) > 5]
        if len(large) > 1:
            self.issues["weakly_connected"] = [{"size": len(component), "sample_nodes": list(component)[:3]} for component in large]
        return len(large)


def main() -> int:
    args = parse_args()
    connection = connect_db(args.db)
    ensure_pg_schema(connection)
    checker = GraphIntegrityChecker(connection, args.dataset_id)
    cycle_count = checker.check_cycles()
    isolated_count = checker.check_isolated_nodes()
    weak_count = checker.check_weakly_connected()
    status = "blocked" if (args.fail_on_cycles and cycle_count > 0) else "success"
    print(
        json.dumps(
            {
                "status": status,
                "cycles": cycle_count,
                "isolated_nodes": isolated_count,
                "disconnected_components": weak_count,
                "issues": checker.issues,
            },
            ensure_ascii=False,
        )
    )
    return 2 if status == "blocked" else 0


if __name__ == "__main__":
    raise SystemExit(main())
