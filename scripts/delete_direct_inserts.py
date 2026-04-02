#!/usr/bin/env python3
"""Delete directly inserted nodes and related data, then re-add using proper workflow."""

import sqlite3
import json

DB_PATH = "storage/knowledge.sqlite"
DATASET_ID = "v5"


def delete_direct_inserts():
    """Delete nodes added directly on 2026-04-01."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Get nodes to delete
    cursor.execute(
        """
        SELECT id FROM nodes 
        WHERE dataset_id=? AND created_at LIKE '2026-04-01%'
    """,
        (DATASET_ID,),
    )

    nodes_to_delete = [row[0] for row in cursor.fetchall()]

    if not nodes_to_delete:
        print("No nodes to delete")
        conn.close()
        return []

    print(f"Found {len(nodes_to_delete)} nodes to delete")

    # Delete edges with these nodes
    placeholders = ",".join(["?" for _ in nodes_to_delete])

    cursor.execute(
        f"""
        DELETE FROM edges 
        WHERE dataset_id=? 
          AND (from_id IN ({placeholders}) OR to_id IN ({placeholders}))
    """,
        [DATASET_ID] + nodes_to_delete + nodes_to_delete,
    )
    edges_deleted = cursor.rowcount
    print(f"Deleted {edges_deleted} edges")

    # Delete profiles
    cursor.execute(
        f"""
        DELETE FROM profiles 
        WHERE dataset_id=? AND node_id IN ({placeholders})
    """,
        [DATASET_ID] + nodes_to_delete,
    )
    profiles_deleted = cursor.rowcount
    print(f"Deleted {profiles_deleted} profiles")

    # Delete mentions
    cursor.execute(
        f"""
        DELETE FROM mentions 
        WHERE dataset_id=? AND target_id IN ({placeholders})
    """,
        [DATASET_ID] + nodes_to_delete,
    )
    mentions_deleted = cursor.rowcount
    print(f"Deleted {mentions_deleted} mentions")

    # Delete evidence (created today)
    cursor.execute(
        """
        SELECT id FROM evidence 
        WHERE dataset_id=? AND id LIKE '%2026-04-01%'
    """,
        (DATASET_ID,),
    )
    evidence_to_delete = [row[0] for row in cursor.fetchall()]

    if evidence_to_delete:
        ev_placeholders = ",".join(["?" for _ in evidence_to_delete])
        cursor.execute(
            f"""
            DELETE FROM evidence 
            WHERE dataset_id=? AND id IN ({ev_placeholders})
        """,
            [DATASET_ID] + evidence_to_delete,
        )
        evidence_deleted = cursor.rowcount
    else:
        # Try to delete by matching mention source_refs
        cursor.execute(
            """
            DELETE FROM evidence 
            WHERE dataset_id=? AND locator LIKE 'struct:chem-highschool-compulsory-1:lesson:2-%'
              AND id LIKE '%-chlor%'
        """,
            (DATASET_ID,),
        )
        evidence_deleted = cursor.rowcount

    print(f"Deleted {evidence_deleted} evidence records")

    # Delete nodes
    cursor.execute(
        f"""
        DELETE FROM nodes 
        WHERE dataset_id=? AND id IN ({placeholders})
    """,
        [DATASET_ID] + nodes_to_delete,
    )
    nodes_deleted = cursor.rowcount
    print(f"Deleted {nodes_deleted} nodes")

    conn.commit()
    conn.close()

    return nodes_to_delete


if __name__ == "__main__":
    print("=" * 50)
    print("Deleting directly inserted data")
    print("=" * 50)
    deleted = delete_direct_inserts()
    print(f"\nDeleted nodes: {deleted}")
