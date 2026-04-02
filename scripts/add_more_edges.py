#!/usr/bin/env python3
"""Add more missing edges to complete the knowledge graph."""

import sqlite3
import uuid
from datetime import datetime
import json

DB_PATH = "storage/knowledge.sqlite"
DATASET_ID = "v5"


def generate_edge_id():
    return f"edge:auto-{uuid.uuid4().hex[:12]}"


def get_existing_nodes(cursor):
    cursor.execute("SELECT id FROM nodes WHERE dataset_id = ?", (DATASET_ID,))
    return {row[0] for row in cursor.fetchall()}


def get_existing_edges(cursor):
    cursor.execute(
        "SELECT from_id, to_id, edge_type FROM edges WHERE dataset_id = ?",
        (DATASET_ID,),
    )
    return {(row[0], row[1], row[2]) for row in cursor.fetchall()}


def add_edges():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    existing_nodes = get_existing_nodes(cursor)
    existing_edges = get_existing_edges(cursor)

    new_edges = []
    now = datetime.utcnow().isoformat() + "Z"

    # Define additional edges: (from_id, to_id, edge_type, edge_layer, backbone_expand)
    edges_to_add = [
        # === 卤素相关 ===
        ("entity/substance:chlorine", "concept:halogen", "is_a", "backbone", 0),
        (
            "principle:halogen-trend",
            "entity/substance:chlorine",
            "applies_to",
            "support",
            1,
        ),
        (
            "principle:halogen-trend",
            "entity/substance:bromine",
            "applies_to",
            "support",
            1,
        ),
        (
            "principle:halogen-trend",
            "entity/substance:iodine",
            "applies_to",
            "support",
            1,
        ),
        # === 氯气相关 ===
        (
            "process:chlorine-bleaching",
            "entity/substance:chlorine",
            "uses",
            "backbone",
            0,
        ),
        (
            "entity/substance:hypochlorous-acid",
            "entity/substance:chlorine",
            "related_to",
            "support",
            0,
        ),
        (
            "entity/substance:bleach-powder",
            "entity/substance:hypochlorous-acid",
            "produces",
            "support",
            0,
        ),
        # === 氧化还原反应相关 ===
        ("concept:oxidizing-agent", "concept:redox-reaction", "part_of", "backbone", 0),
        ("concept:reducing-agent", "concept:redox-reaction", "part_of", "backbone", 0),
        (
            "concept:oxidation-number",
            "concept:oxidizing-agent",
            "explains",
            "support",
            1,
        ),
        (
            "concept:oxidation-number",
            "concept:reducing-agent",
            "explains",
            "support",
            1,
        ),
        # === 物质的量相关 ===
        ("concept:molar-mass", "concept:mole", "extends", "backbone", 0),
        ("concept:molar-concentration", "concept:mole", "extends", "backbone", 0),
        ("concept:molar-volume", "concept:mole", "extends", "backbone", 0),
        (
            "concept:avogadro-constant",
            "concept:amount-of-substance",
            "defines",
            "backbone",
            0,
        ),
        ("concept:amount-of-substance", "concept:mole", "uses", "backbone", 0),
        # === 分散系相关 ===
        ("concept:solution", "concept:dispersion-system", "is_a", "backbone", 0),
        ("concept:suspension", "concept:dispersion-system", "is_a", "backbone", 0),
        ("concept:colloid", "concept:dispersion-system", "is_a", "backbone", 0),
        # === 物质分类相关 ===
        ("concept:element-substance", "concept:pure-substance", "is_a", "backbone", 0),
        ("concept:compound", "concept:pure-substance", "is_a", "backbone", 0),
        (
            "concept:pure-substance",
            "concept:matter-classification",
            "part_of",
            "backbone",
            0,
        ),
        ("concept:mixture", "concept:matter-classification", "part_of", "backbone", 0),
        # === 物质状态相关 ===
        ("concept:states-of-matter", "concept:chemistry", "part_of", "backbone", 0),
        ("concept:plasma", "concept:states-of-matter", "is_a", "support", 0),
        # === 实验方法相关 ===
        ("method:distillation", "method:substance-preparation", "is_a", "support", 0),
        ("method:filtration", "method:substance-preparation", "is_a", "support", 0),
        (
            "method:liquid-separation",
            "method:substance-preparation",
            "is_a",
            "support",
            0,
        ),
        ("method:extraction", "method:substance-preparation", "is_a", "support", 0),
        (
            "method:crystallization",
            "method:substance-preparation",
            "is_a",
            "support",
            0,
        ),
        # === 化学分支 ===
        ("concept:chemistry-branches", "concept:chemistry", "extends", "backbone", 0),
        ("concept:green-chemistry", "concept:chemistry-branches", "is_a", "support", 1),
        # === 实验活动相关 ===
        (
            "activity/experiment:molar-volume-determination",
            "concept:molar-volume",
            "measures",
            "backbone",
            0,
        ),
        (
            "activity/experiment:tyndall-effect-experiment",
            "process:tyndall-effect",
            "demonstrates",
            "backbone",
            0,
        ),
        (
            "activity/experiment:tyndall-effect-experiment",
            "concept:colloid",
            "uses",
            "support",
            0,
        ),
        # === 人物相关 ===
        (
            "entity/person:tu-youyou",
            "entity/substance:qinghaosu",
            "produces",
            "backbone",
            0,
        ),
        ("entity/person:xu-shou", "concept:chemistry", "related_to", "support", 0),
        # === 丁达尔现象 ===
        ("process:tyndall-effect", "concept:colloid", "characterizes", "backbone", 0),
        # === 聚沉和电泳 ===
        ("process:coagulation", "concept:colloid", "affects", "support", 0),
        ("process:electrophoresis", "concept:colloid", "characterizes", "support", 0),
        # === 阿伏伽德罗定律 ===
        ("principle:avogadro-law", "concept:molar-volume", "explains", "backbone", 0),
        (
            "principle:avogadro-law",
            "concept:avogadro-constant",
            "related_to",
            "support",
            0,
        ),
        # === 标准状况与摩尔体积 ===
        (
            "concept:standard-condition",
            "principle:avogadro-law",
            "defines",
            "support",
            0,
        ),
    ]

    for from_id, to_id, edge_type, edge_layer, backbone_expand in edges_to_add:
        if from_id not in existing_nodes:
            print(f"  Skip: node '{from_id}' not found")
            continue
        if to_id not in existing_nodes:
            print(f"  Skip: node '{to_id}' not found")
            continue
        if (from_id, to_id, edge_type) in existing_edges:
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
                "[]",
                "{}",
                "candidate",
                now,
                now,
            ),
        )

        new_edges.append((edge_id, from_id, to_id, edge_type))
        existing_edges.add((from_id, to_id, edge_type))

    conn.commit()
    conn.close()

    print(f"Added {len(new_edges)} new edges")
    for edge_id, from_id, to_id, edge_type in new_edges[:20]:
        print(f"  {from_id} -> {to_id} ({edge_type})")
    if len(new_edges) > 20:
        print(f"  ... and {len(new_edges) - 20} more")


if __name__ == "__main__":
    print("=" * 50)
    print("Adding additional missing edges")
    print("=" * 50)
    add_edges()
