#!/usr/bin/env python3
"""Ensure data integrity between SQLite tables - cross-reference validation."""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from knowledge_store_common import connect_db, DEFAULT_DB_PATH


def check_foreign_key_integrity(
    conn: sqlite3.Connection, dataset_id: str
) -> dict[str, list[str]]:
    """Check all foreign key relationships."""
    issues = {
        "orphaned_profiles": [],
        "orphaned_mentions": [],
        "orphaned_edges_from": [],
        "orphaned_edges_to": [],
        "orphaned_cards": [],
        "orphaned_evidence_links": [],
    }

    # Check profiles -> nodes
    rows = conn.execute(
        """
        SELECT p.id, p.node_id
        FROM profiles p
        LEFT JOIN nodes n ON p.dataset_id = n.dataset_id AND p.node_id = n.id
        WHERE p.dataset_id = ? AND n.id IS NULL
        """,
        (dataset_id,),
    ).fetchall()
    for row in rows:
        issues["orphaned_profiles"].append(f"{row['id']} -> node {row['node_id']}")

    # Check mentions -> nodes (for node targets)
    rows = conn.execute(
        """
        SELECT m.id, m.target_id
        FROM mentions m
        LEFT JOIN nodes n ON m.dataset_id = n.dataset_id AND m.target_id = n.id
        WHERE m.dataset_id = ? AND m.target_type = 'node' AND n.id IS NULL
        """,
        (dataset_id,),
    ).fetchall()
    for row in rows:
        issues["orphaned_mentions"].append(f"{row['id']} -> node {row['target_id']}")

    # Check edges -> nodes (from_id)
    rows = conn.execute(
        """
        SELECT e.id, e.from_id
        FROM edges e
        LEFT JOIN nodes n ON e.dataset_id = n.dataset_id AND e.from_id = n.id
        WHERE e.dataset_id = ? AND n.id IS NULL
        """,
        (dataset_id,),
    ).fetchall()
    for row in rows:
        issues["orphaned_edges_from"].append(
            f"{row['id']} -> from_node {row['from_id']}"
        )

    # Check edges -> nodes (to_id)
    rows = conn.execute(
        """
        SELECT e.id, e.to_id
        FROM edges e
        LEFT JOIN nodes n ON e.dataset_id = n.dataset_id AND e.to_id = n.id
        WHERE e.dataset_id = ? AND n.id IS NULL
        """,
        (dataset_id,),
    ).fetchall()
    for row in rows:
        issues["orphaned_edges_to"].append(f"{row['id']} -> to_node {row['to_id']}")

    # Check node_cards -> nodes
    rows = conn.execute(
        """
        SELECT nc.node_id
        FROM node_cards nc
        LEFT JOIN nodes n ON nc.dataset_id = n.dataset_id AND nc.node_id = n.id
        WHERE nc.dataset_id = ? AND n.id IS NULL
        """,
        (dataset_id,),
    ).fetchall()
    for row in rows:
        issues["orphaned_cards"].append(f"card for node {row['node_id']}")

    # Check evidence_links -> evidence
    rows = conn.execute(
        """
        SELECT el.evidence_id, el.owner_id
        FROM evidence_links el
        LEFT JOIN evidence e ON el.evidence_id = e.id
        WHERE e.id IS NULL
        """,
    ).fetchall()
    for row in rows:
        issues["orphaned_evidence_links"].append(
            f"link from {row['owner_id']} -> evidence {row['evidence_id']}"
        )

    return issues


def check_card_consistency(conn: sqlite3.Connection, dataset_id: str) -> list[str]:
    """Check node_cards are properly linked to nodes."""
    issues = []

    # Check backbone nodes without cards
    rows = conn.execute(
        """
        SELECT n.id, n.canonical_name
        FROM nodes n
        LEFT JOIN node_cards nc ON n.dataset_id = nc.dataset_id AND n.id = nc.node_id
        WHERE n.dataset_id = ? AND n.node_layer = 'backbone' AND nc.node_id IS NULL
        """,
        (dataset_id,),
    ).fetchall()
    for row in rows:
        issues.append(
            f"Backbone node '{row['canonical_name']}' ({row['id']}) has no card"
        )

    # Check nodes with card_ref but no actual card
    rows = conn.execute(
        """
        SELECT n.id, n.card_ref
        FROM nodes n
        LEFT JOIN node_cards nc ON n.dataset_id = nc.dataset_id AND n.id = nc.node_id
        WHERE n.dataset_id = ? AND n.card_ref IS NOT NULL AND nc.node_id IS NULL
        """,
        (dataset_id,),
    ).fetchall()
    for row in rows:
        issues.append(
            f"Node {row['id']} has card_ref '{row['card_ref']}' but no card exists"
        )

    return issues


def check_evidence_completeness(conn: sqlite3.Connection, dataset_id: str) -> list[str]:
    """Check evidence is properly linked."""
    issues = []

    # Check mentions without evidence links or source_refs
    rows = conn.execute(
        """
        SELECT m.id, m.target_id
        FROM mentions m
        LEFT JOIN evidence_links el ON m.id = el.owner_id
        WHERE m.dataset_id = ? AND el.owner_id IS NULL AND m.source_refs_json = '[]'
        """,
        (dataset_id,),
    ).fetchall()
    for row in rows:
        issues.append(
            f"Mention {row['id']} (target: {row['target_id']}) has no evidence"
        )

    return issues


def check_fts_consistency(conn: sqlite3.Connection, dataset_id: str) -> list[str]:
    """Check FTS indexes match main tables."""
    issues = []

    tables = [
        ("nodes", "node_search"),
        ("node_cards", "card_search"),
        ("profiles", "profile_search"),
        ("evidence", "evidence_search"),
    ]

    for table, fts_table in tables:
        main_count = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE dataset_id = ?", (dataset_id,)
        ).fetchone()[0]

        fts_count = conn.execute(
            f"SELECT COUNT(*) FROM {fts_table} WHERE dataset_id = ?", (dataset_id,)
        ).fetchone()[0]

        if main_count != fts_count:
            issues.append(
                f"{table} ({main_count}) vs {fts_table} ({fts_count}) mismatch"
            )

    return issues


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ensure data integrity in SQLite knowledge store."
    )
    parser.add_argument(
        "--dataset-id",
        required=True,
        help="Dataset ID to validate",
    )
    parser.add_argument(
        "--db",
        default=str(DEFAULT_DB_PATH),
        help="Path to SQLite database",
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Attempt to fix minor issues",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    db_path = Path(args.db).expanduser().resolve()
    if not db_path.exists():
        print(f"Error: Database not found: {db_path}")
        return 1

    conn = connect_db(db_path)

    print(f"Ensuring integrity for dataset: {args.dataset_id}")
    print(f"Database: {db_path}\n")

    all_issues = []

    # 1. Foreign key integrity
    print("[1/4] Checking foreign key integrity...")
    fk_issues = check_foreign_key_integrity(conn, args.dataset_id)
    total_fk = sum(len(v) for v in fk_issues.values())
    if total_fk == 0:
        print("  ✓ All foreign keys valid")
    else:
        for category, issues in fk_issues.items():
            if issues:
                print(f"  ✗ {category}: {len(issues)} issues")
                all_issues.extend([f"{category}: {i}" for i in issues[:3]])
                if len(issues) > 3:
                    print(f"    ... and {len(issues) - 3} more")

    # 2. Card consistency
    print("\n[2/4] Checking node card consistency...")
    card_issues = check_card_consistency(conn, args.dataset_id)
    if not card_issues:
        print("  ✓ Cards consistent with nodes")
    else:
        print(f"  ✗ {len(card_issues)} card consistency issues")
        all_issues.extend(card_issues[:3])
        if len(card_issues) > 3:
            print(f"    ... and {len(card_issues) - 3} more")

    # 3. Evidence completeness
    print("\n[3/4] Checking evidence completeness...")
    evidence_issues = check_evidence_completeness(conn, args.dataset_id)
    if not evidence_issues:
        print("  ✓ Evidence properly linked")
    else:
        print(f"  ✗ {len(evidence_issues)} evidence issues")
        all_issues.extend(evidence_issues[:3])
        if len(evidence_issues) > 3:
            print(f"    ... and {len(evidence_issues) - 3} more")

    # 4. FTS consistency
    print("\n[4/4] Checking FTS index consistency...")
    fts_issues = check_fts_consistency(conn, args.dataset_id)
    if not fts_issues:
        print("  ✓ FTS indexes consistent")
    else:
        print(f"  ✗ {len(fts_issues)} FTS inconsistencies")
        for issue in fts_issues:
            print(f"    - {issue}")
        all_issues.extend(fts_issues)

        if args.fix:
            print("\n  Attempting to fix FTS indexes...")
            # Rebuild FTS indexes
            for fts_table in [
                "node_search",
                "card_search",
                "profile_search",
                "evidence_search",
            ]:
                conn.execute(
                    f"DELETE FROM {fts_table} WHERE dataset_id = ?", (args.dataset_id,)
                )

            # Rebuild node_search
            for row in conn.execute(
                "SELECT id, canonical_name, definition FROM nodes WHERE dataset_id = ?",
                (args.dataset_id,),
            ).fetchall():
                conn.execute(
                    "INSERT INTO node_search (dataset_id, id, searchable_content) VALUES (?, ?, ?)",
                    (
                        args.dataset_id,
                        row["id"],
                        f"{row['canonical_name']}\n{row['definition']}",
                    ),
                )

            # Rebuild card_search
            for row in conn.execute(
                "SELECT node_id, title, summary, sections_json FROM node_cards WHERE dataset_id = ?",
                (args.dataset_id,),
            ).fetchall():
                import json

                sections = json.loads(row["sections_json"])
                searchable = "\n".join(
                    [
                        row["title"],
                        row["summary"],
                        *[
                            s.get("content", "")
                            for s in sections
                            if isinstance(s, dict)
                        ],
                    ]
                )
                conn.execute(
                    "INSERT INTO card_search (dataset_id, id, searchable_content) VALUES (?, ?, ?)",
                    (args.dataset_id, row["node_id"], searchable),
                )

            conn.commit()
            print("  ✓ FTS indexes rebuilt")

    # Summary
    print("\n" + "=" * 60)
    if not all_issues:
        print("✅ INTEGRITY CHECK PASSED")
        print("=" * 60)
        return 0
    else:
        print(f"❌ FOUND {len(all_issues)} INTEGRITY ISSUES")
        print("=" * 60)
        print("\nFirst few issues:")
        for issue in all_issues[:5]:
            print(f"  - {issue}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
