#!/usr/bin/env python3
"""Add missing edges for isolated nodes."""

import json
import sqlite3
import uuid
from pathlib import Path
from datetime import datetime

DB_PATH = Path("storage/knowledge.sqlite")
DATASET_ID = "v5"
BOOK_ID = "chem-highschool-compulsory-1"


def generate_edge_id():
    return f"edge:auto-{uuid.uuid4().hex[:12]}"


def get_existing_nodes(cursor):
    """Get all existing node IDs."""
    cursor.execute("SELECT id FROM nodes WHERE dataset_id = ?", (DATASET_ID,))
    return {row[0] for row in cursor.fetchall()}


def get_existing_edges(cursor):
    """Get existing edge pairs."""
    cursor.execute(
        "SELECT from_id, to_id, edge_type FROM edges WHERE dataset_id = ?",
        (DATASET_ID,),
    )
    return {(row[0], row[1], row[2]) for row in cursor.fetchall()}


def add_edges():
    """Add missing edges for isolated nodes."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    existing_nodes = get_existing_nodes(cursor)
    existing_edges = get_existing_edges(cursor)

    new_edges = []
    now = datetime.utcnow().isoformat() + "Z"

    # Define edges to add: (from_id, to_id, edge_type, edge_layer, backbone_expand, evidence_anchor)
    edges_to_add = [
        # === 原子结构相关 ===
        (
            "concept:atomic-structure",
            "entity/subatomic:proton",
            "contains",
            "backbone",
            0,
            "lesson:4-2",
        ),
        (
            "concept:atomic-structure",
            "entity/subatomic:neutron",
            "contains",
            "backbone",
            0,
            "lesson:4-2",
        ),
        (
            "concept:atomic-structure",
            "entity/subatomic:electron",
            "contains",
            "backbone",
            0,
            "lesson:4-2",
        ),
        (
            "concept:electron-configuration",
            "concept:atomic-structure",
            "extends",
            "backbone",
            0,
            "lesson:4-3",
        ),
        (
            "concept:electron-configuration",
            "principle:energy-lowest",
            "follows",
            "backbone",
            0,
            "lesson:4-3",
        ),
        # === 化学键相关 ===
        (
            "concept:chemical-bond",
            "concept:ionic-bond",
            "includes",
            "backbone",
            0,
            "lesson:4-4",
        ),
        (
            "concept:chemical-bond",
            "concept:covalent-bond",
            "includes",
            "backbone",
            0,
            "lesson:4-4",
        ),
        (
            "concept:ionic-bond",
            "entity/subatomic:electron",
            "involves",
            "support",
            1,
            "lesson:4-4",
        ),
        (
            "concept:covalent-bond",
            "entity/subatomic:electron",
            "involves",
            "support",
            1,
            "lesson:4-4",
        ),
        # === 元素周期表相关 ===
        (
            "representation/periodic-table",
            "concept:period",
            "organizes",
            "backbone",
            0,
            "lesson:4-1",
        ),
        (
            "representation/periodic-table",
            "concept:group",
            "organizes",
            "backbone",
            0,
            "lesson:4-1",
        ),
        (
            "principle:periodic-law",
            "representation/periodic-table",
            "describes",
            "backbone",
            0,
            "lesson:4-1",
        ),
        (
            "principle:periodic-law",
            "concept:period",
            "relates_to",
            "support",
            1,
            "lesson:4-1",
        ),
        (
            "principle:periodic-law",
            "concept:group",
            "relates_to",
            "support",
            1,
            "lesson:4-1",
        ),
        # === 离子反应相关 ===
        (
            "concept:ion-reaction",
            "concept:ionic-bond",
            "involves",
            "support",
            0,
            "lesson:2-2",
        ),
        (
            "concept:oxidation-number",
            "concept:redox-reaction",
            "explains",
            "backbone",
            0,
            "lesson:2-2",
        ),
        # === 氮循环相关 ===
        (
            "process:nitrogen-cycle",
            "entity/substance:nitrogen",
            "involves",
            "backbone",
            0,
            "lesson:3-3",
        ),
        (
            "process:nitrogen-cycle",
            "entity/substance:ammonia",
            "involves",
            "backbone",
            0,
            "lesson:3-3",
        ),
        (
            "process:nitrogen-cycle",
            "entity/substance:nitric-acid",
            "involves",
            "backbone",
            0,
            "lesson:3-3",
        ),
        (
            "entity/substance:nitrogen",
            "entity/substance:ammonia",
            "transforms_to",
            "support",
            0,
            "lesson:3-2",
        ),
        (
            "entity/substance:ammonia",
            "entity/substance:nitric-acid",
            "transforms_to",
            "support",
            0,
            "lesson:3-2",
        ),
        # === 硫循环相关 ===
        (
            "process:sulfur-cycle",
            "entity/substance:sulfur",
            "involves",
            "backbone",
            0,
            "lesson:3-3",
        ),
        (
            "process:sulfur-cycle",
            "entity/substance:sulfur-dioxide",
            "involves",
            "backbone",
            0,
            "lesson:3-3",
        ),
        (
            "process:sulfur-cycle",
            "entity/substance:sulfuric-acid",
            "involves",
            "backbone",
            0,
            "lesson:3-3",
        ),
        (
            "entity/substance:sulfur",
            "entity/substance:sulfur-dioxide",
            "transforms_to",
            "support",
            0,
            "lesson:3-1",
        ),
        (
            "entity/substance:sulfur-dioxide",
            "entity/substance:sulfuric-acid",
            "transforms_to",
            "support",
            0,
            "lesson:3-1",
        ),
        # === 酸雨相关 ===
        (
            "concept:acid-rain",
            "entity/substance:sulfur-dioxide",
            "caused_by",
            "backbone",
            0,
            "lesson:3-1",
        ),
        (
            "concept:acid-rain",
            "process:sulfur-cycle",
            "relates_to",
            "support",
            0,
            "lesson:3-3",
        ),
        # === 实验方法相关 ===
        (
            "method:flame-test",
            "method:substance-preparation",
            "is_a",
            "support",
            0,
            "lesson:1-3",
        ),
        (
            "method:precipitation-method",
            "method:substance-preparation",
            "is_a",
            "support",
            0,
            "lesson:1-3",
        ),
        (
            "method:gas-method",
            "method:substance-preparation",
            "is_a",
            "support",
            0,
            "lesson:1-3",
        ),
        (
            "method:color-reaction",
            "method:substance-preparation",
            "is_a",
            "support",
            0,
            "lesson:1-3",
        ),
        # === 标准状况 ===
        (
            "concept:standard-condition",
            "concept:molar-volume",
            "defines",
            "support",
            0,
            "lesson:1-2",
        ),
        # === 物质循环 ===
        (
            "concept:material-cycle",
            "process:nitrogen-cycle",
            "includes",
            "backbone",
            0,
            "lesson:3-3",
        ),
        (
            "concept:material-cycle",
            "process:sulfur-cycle",
            "includes",
            "backbone",
            0,
            "lesson:3-3",
        ),
        # === 实验活动 ===
        (
            "activity/experiment:crystallization-water-determination",
            "method:crystallization",
            "uses",
            "backbone",
            0,
            "activity:3-5",
        ),
        (
            "activity/experiment:crystallization-water-determination",
            "entity/substance:sulfuric-acid",
            "uses",
            "support",
            0,
            "activity:3-5",
        ),
        # === 化学核心素养 ===
        (
            "concept:chemistry-core-competencies",
            "concept:chemistry",
            "extends",
            "backbone",
            0,
            "intro:0",
        ),
        # === 章节复习连接核心概念 ===
        (
            "concept:chapter1-review",
            "concept:matter-classification",
            "summarizes",
            "support",
            0,
            "review:1-4",
        ),
        (
            "concept:chapter1-review",
            "concept:amount-of-substance",
            "summarizes",
            "support",
            0,
            "review:1-4",
        ),
        (
            "concept:chapter2-review",
            "concept:halogen",
            "summarizes",
            "support",
            0,
            "review:2-4",
        ),
        (
            "concept:chapter2-review",
            "concept:redox-reaction",
            "summarizes",
            "support",
            0,
            "review:2-4",
        ),
        (
            "concept:chapter3-review",
            "process:sulfur-cycle",
            "summarizes",
            "support",
            0,
            "review:3-4",
        ),
        (
            "concept:chapter3-review",
            "process:nitrogen-cycle",
            "summarizes",
            "support",
            0,
            "review:3-4",
        ),
        (
            "concept:chapter4-review",
            "concept:atomic-structure",
            "summarizes",
            "support",
            0,
            "review:4-5",
        ),
        (
            "concept:chapter4-review",
            "principle:periodic-law",
            "summarizes",
            "support",
            0,
            "review:4-5",
        ),
    ]

    for from_id, to_id, edge_type, edge_layer, backbone_expand, anchor in edges_to_add:
        # Check if both nodes exist
        if from_id not in existing_nodes:
            print(f"  Warning: from_id '{from_id}' not found, skipping")
            continue
        if to_id not in existing_nodes:
            print(f"  Warning: to_id '{to_id}' not found, skipping")
            continue

        # Check if edge already exists
        if (from_id, to_id, edge_type) in existing_edges:
            print(f"  Edge {from_id} -> {to_id} ({edge_type}) already exists, skipping")
            continue

        edge_id = generate_edge_id()

        cursor.execute(
            """
            INSERT INTO edges (
                dataset_id, id, edge_type, edge_layer, backbone_expand,
                from_id, to_id, directionality, confidence,
                framework_refs_json, profile_refs_json, source_refs_json,
                properties_json, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                DATASET_ID,
                edge_id,
                edge_type,
                edge_layer,
                backbone_expand,
                from_id,
                to_id,
                "directed",
                0.9,
                "[]",
                "[]",
                json.dumps([f"evidence:{BOOK_ID}:{anchor}:{from_id.split(':')[0]}"]),
                "{}",
                "validated",
                now,
                now,
            ),
        )

        new_edges.append((edge_id, from_id, to_id, edge_type))

    conn.commit()
    conn.close()

    print(f"Added {len(new_edges)} new edges:")
    for edge_id, from_id, to_id, edge_type in new_edges:
        print(f"  {edge_id}: {from_id} -> {to_id} ({edge_type})")


if __name__ == "__main__":
    print("=" * 50)
    print("Adding missing edges for isolated nodes")
    print("=" * 50)
    add_edges()
