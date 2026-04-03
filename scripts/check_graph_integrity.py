#!/usr/bin/env python3
"""Check graph integrity: cycles, isolated nodes, connectivity."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from knowledge_store_common import connect_db, DEFAULT_DB_PATH

# Edge types that MUST NOT form cycles
HIERARCHICAL_EDGE_TYPES = {
    "is_a",
    "instance_of",
    "contains",
    "part_of",
    "prerequisite_for",
    "depends_on",
    "extends",
}

# Edge types that MAY form cycles
ASSOCIATIVE_EDGE_TYPES = {
    "related_to",
    "explains",
    "uses",
    "produces",
    "measures",
    "analogous_to",
    "same_as",
}


class GraphIntegrityChecker:
    """Check graph for cycles and isolated nodes."""

    def __init__(self, connection: sqlite3.Connection, dataset_id: str):
        self.connection = connection
        self.dataset_id = dataset_id
        self.issues: dict[str, list[dict[str, Any]]] = {
            "cycles": [],
            "isolated_nodes": [],
            "weakly_connected": [],
        }

    def check_cycles(self) -> int:
        """Check for cycles in hierarchical edges. Returns cycle count."""
        print("\n[1/3] Checking for cycles in hierarchical edges...")

        # Load hierarchical edges
        rows = self.connection.execute(
            f"""
            SELECT id, edge_type, from_id, to_id
            FROM edges
            WHERE dataset_id = ?
              AND edge_type IN ({",".join(["?"] * len(HIERARCHICAL_EDGE_TYPES))})
              AND status != 'deprecated'
            """,
            (self.dataset_id, *HIERARCHICAL_EDGE_TYPES),
        ).fetchall()

        # Build adjacency list
        graph = defaultdict(list)
        edge_map = {}  # (from, to) -> edge_id

        for row in rows:
            graph[row["from_id"]].append(row["to_id"])
            edge_map[(row["from_id"], row["to_id"])] = row["id"]

        # Detect cycles using DFS
        cycles_found = []
        visited = set()
        rec_stack = set()
        path = []

        def dfs(node: str) -> bool:
            visited.add(node)
            rec_stack.add(node)
            path.append(node)

            for neighbor in graph[node]:
                if neighbor not in visited:
                    if dfs(neighbor):
                        return True
                elif neighbor in rec_stack:
                    # Cycle detected
                    cycle_start = path.index(neighbor)
                    cycle_nodes = path[cycle_start:] + [neighbor]
                    cycle_edges = [
                        edge_map.get((cycle_nodes[i], cycle_nodes[i + 1]), "unknown")
                        for i in range(len(cycle_nodes) - 1)
                    ]
                    cycles_found.append(
                        {
                            "nodes": cycle_nodes,
                            "edges": cycle_edges,
                            "edge_types": [
                                row["edge_type"]
                                for row in rows
                                if row["id"] in cycle_edges
                            ],
                        }
                    )
                    return False

            path.pop()
            rec_stack.remove(node)
            return False

        for node in graph:
            if node not in visited:
                dfs(node)

        # Report cycles
        if cycles_found:
            print(f"  ✗ Found {len(cycles_found)} cycle(s)")
            for i, cycle in enumerate(cycles_found[:3], 1):
                print(f"    Cycle {i}: {' -> '.join(cycle['nodes'][:5])}")
                self.issues["cycles"].append(cycle)
            if len(cycles_found) > 3:
                print(f"    ... and {len(cycles_found) - 3} more cycles")
        else:
            print("  ✓ No cycles detected in hierarchical edges")

        return len(cycles_found)

    def check_isolated_nodes(self) -> int:
        """Check for nodes with no edges at all. Returns isolated node count."""
        print("\n[2/3] Checking for isolated nodes (no edges)...")

        # Find nodes with no edges (neither incoming nor outgoing)
        rows = self.connection.execute(
            """
            SELECT n.id, n.canonical_name, n.node_kind, n.node_layer
            FROM nodes n
            LEFT JOIN edges e1 ON n.id = e1.from_id AND e1.dataset_id = ?
            LEFT JOIN edges e2 ON n.id = e2.to_id AND e2.dataset_id = ?
            WHERE n.dataset_id = ?
              AND e1.id IS NULL
              AND e2.id IS NULL
              AND n.status != 'deprecated'
            """,
            (self.dataset_id, self.dataset_id, self.dataset_id),
        ).fetchall()

        isolated_nodes = []
        for row in rows:
            isolated_nodes.append(
                {
                    "id": row["id"],
                    "canonical_name": row["canonical_name"],
                    "node_kind": row["node_kind"],
                    "node_layer": row["node_layer"],
                }
            )

        # Report
        if isolated_nodes:
            print(f"  ⚠ Found {len(isolated_nodes)} isolated node(s)")
            for node in isolated_nodes[:5]:
                print(
                    f"    - {node['canonical_name']} ({node['id']}, {node['node_layer']})"
                )
                self.issues["isolated_nodes"].append(node)
            if len(isolated_nodes) > 5:
                print(f"    ... and {len(isolated_nodes) - 5} more")
        else:
            print("  ✓ All nodes have at least one edge")

        return len(isolated_nodes)

    def check_weakly_connected(self) -> int:
        """Check for weakly connected components (may indicate disconnected subgraphs)."""
        print("\n[3/3] Checking graph connectivity...")

        # Build undirected graph
        rows = self.connection.execute(
            """
            SELECT from_id, to_id
            FROM edges
            WHERE dataset_id = ? AND status != 'deprecated'
            """,
            (self.dataset_id,),
        ).fetchall()

        graph = defaultdict(set)
        all_nodes = set()

        for row in rows:
            graph[row["from_id"]].add(row["to_id"])
            graph[row["to_id"]].add(row["from_id"])
            all_nodes.add(row["from_id"])
            all_nodes.add(row["to_id"])

        # Find connected components using BFS
        visited = set()
        components = []

        def bfs(start: str) -> set[str]:
            component = set()
            queue = [start]
            while queue:
                node = queue.pop(0)
                if node not in visited:
                    visited.add(node)
                    component.add(node)
                    queue.extend(graph[node] - visited)
            return component

        for node in all_nodes:
            if node not in visited:
                component = bfs(node)
                components.append(component)

        # Check for multiple large components
        large_components = [c for c in components if len(c) > 5]

        if len(large_components) > 1:
            print(f"  ⚠ Graph has {len(large_components)} disconnected components")
            for i, component in enumerate(large_components[:3], 1):
                sample = list(component)[:3]
                print(
                    f"    Component {i}: {len(component)} nodes (e.g., {', '.join(sample)})"
                )
                self.issues["weakly_connected"].append(
                    {"size": len(component), "sample_nodes": sample}
                )
        elif len(components) == 1:
            print("  ✓ Graph is fully connected")
        else:
            print(f"  ℹ Graph has {len(components)} small components")

        return len(large_components)

    def run_all_checks(self) -> dict[str, Any]:
        """Run all integrity checks."""
        cycle_count = self.check_cycles()
        isolated_count = self.check_isolated_nodes()
        component_count = self.check_weakly_connected()

        return {
            "cycles": cycle_count,
            "isolated_nodes": isolated_count,
            "disconnected_components": component_count,
            "issues": self.issues,
        }

    def print_report(self):
        """Print summary report."""
        print("\n" + "=" * 60)
        print("GRAPH INTEGRITY REPORT")
        print("=" * 60)

        total_issues = sum(len(v) for v in self.issues.values())

        if total_issues == 0:
            print("\n✅ GRAPH INTEGRITY CHECK PASSED")
        else:
            print(f"\n⚠️  GRAPH INTEGRITY CHECK: {total_issues} issue(s) found")

            if self.issues["cycles"]:
                print(f"\n❌ CYCLES ({len(self.issues['cycles'])}):")
                for cycle in self.issues["cycles"][:2]:
                    print(f"  - {' -> '.join(cycle['nodes'][:4])}...")
                print("  Action: Review and break cycles in hierarchical edges")

            if self.issues["isolated_nodes"]:
                print(f"\n⚠️  ISOLATED NODES ({len(self.issues['isolated_nodes'])}):")
                for node in self.issues["isolated_nodes"][:3]:
                    print(f"  - {node['canonical_name']} ({node['id']})")
                print("  Action: Add edges or verify if isolation is intentional")

            if self.issues["weakly_connected"]:
                print(
                    f"\nℹ️  DISCONNECTED COMPONENTS ({len(self.issues['weakly_connected'])}):"
                )
                for comp in self.issues["weakly_connected"]:
                    print(f"  - Component with {comp['size']} nodes")

        print("\n" + "=" * 60)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check graph integrity: cycles, isolated nodes, connectivity."
    )
    parser.add_argument(
        "--dataset-id",
        required=True,
        help="Dataset ID to check",
    )
    parser.add_argument(
        "--db",
        default=str(DEFAULT_DB_PATH),
        help="Path to SQLite database",
    )
    parser.add_argument(
        "--fail-on-cycles",
        action="store_true",
        help="Exit with error code if cycles detected",
    )
    parser.add_argument(
        "--output-json",
        help="Write report to JSON file",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    db_path = Path(args.db).expanduser().resolve()
    if not db_path.exists():
        print(f"Error: Database not found: {db_path}")
        return 1

    conn = connect_db(db_path)

    # Verify dataset exists
    dataset_count = conn.execute(
        "SELECT COUNT(*) FROM datasets WHERE dataset_id = ?", (args.dataset_id,)
    ).fetchone()[0]

    if dataset_count == 0:
        print(f"Error: Dataset '{args.dataset_id}' not found")
        return 1

    print(f"Checking graph integrity for dataset: {args.dataset_id}")
    print(f"Database: {db_path}")

    checker = GraphIntegrityChecker(conn, args.dataset_id)
    results = checker.run_all_checks()
    checker.print_report()

    # Write JSON report
    if args.output_json:
        report = {
            "dataset_id": args.dataset_id,
            "summary": {
                "cycles": results["cycles"],
                "isolated_nodes": results["isolated_nodes"],
                "disconnected_components": results["disconnected_components"],
            },
            "issues": results["issues"],
        }
        with open(args.output_json, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"\nReport written to: {args.output_json}")

    conn.close()

    # Exit code
    if args.fail_on_cycles and results["cycles"] > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
