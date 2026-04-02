#!/usr/bin/env python3
"""Add backbone-to-backbone edges to form a proper knowledge network."""

import sqlite3
import uuid
from datetime import datetime

DB_PATH = "storage/knowledge.sqlite"
DATASET_ID = "v5"


def generate_edge_id():
    return f"edge:auto-{uuid.uuid4().hex[:12]}"


def get_existing_nodes(cursor):
    cursor.execute(
        "SELECT id, node_layer FROM nodes WHERE dataset_id = ?", (DATASET_ID,)
    )
    return {row[0]: row[1] for row in cursor.fetchall()}


def get_existing_edges(cursor):
    cursor.execute(
        "SELECT from_id, to_id, edge_type FROM edges WHERE dataset_id = ?",
        (DATASET_ID,),
    )
    return {(row[0], row[1], row[2]) for row in cursor.fetchall()}


def add_backbone_edges():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    nodes = get_existing_nodes(cursor)
    existing_edges = get_existing_edges(cursor)

    new_edges = []
    now = datetime.utcnow().isoformat() + "Z"

    # Define backbone-to-backbone edges: (from_id, to_id, edge_type)
    # All these should be backbone layer edges
    edges_to_add = [
        # === 元素周期律与原子结构 ===
        ("principle:periodic-law", "concept:atomic-structure", "explains"),
        ("concept:period", "principle:periodic-law", "part_of"),
        ("concept:group", "principle:periodic-law", "part_of"),
        ("representation/periodic-table", "principle:periodic-law", "symbolizes"),
        # === 化学键与原子结构 ===
        ("concept:chemical-bond", "concept:atomic-structure", "depends_on"),
        ("concept:ionic-bond", "concept:atomic-structure", "depends_on"),
        ("concept:covalent-bond", "concept:atomic-structure", "depends_on"),
        # === 离子反应 ===
        ("concept:ion-reaction", "concept:ionic-bond", "uses"),
        ("concept:ion-reaction", "concept:solution", "occurs_in"),
        # === 氧化还原与化合价 ===
        ("concept:oxidation-number", "concept:redox-reaction", "explains"),
        ("concept:oxidizing-agent", "concept:oxidation-number", "has_property"),
        ("concept:reducing-agent", "concept:oxidation-number", "has_property"),
        # === 卤素与氧化还原 ===
        ("concept:halogen", "concept:redox-reaction", "participates_in"),
        ("entity/substance:chlorine", "concept:oxidizing-agent", "is_a"),
        # === 分散系网络 ===
        ("concept:dispersion-system", "concept:matter-classification", "part_of"),
        ("concept:solution", "concept:mixture", "is_a"),
        ("concept:suspension", "concept:mixture", "is_a"),
        ("concept:colloid", "concept:mixture", "is_a"),
        # === 物质分类完整网络 ===
        ("concept:pure-substance", "concept:matter-classification", "part_of"),
        ("concept:mixture", "concept:matter-classification", "part_of"),
        ("concept:element-substance", "concept:pure-substance", "is_a"),
        ("concept:compound", "concept:pure-substance", "is_a"),
        # === 物质状态 ===
        ("concept:states-of-matter", "concept:matter-classification", "part_of"),
        # === 物质的量体系 ===
        ("concept:mole", "concept:amount-of-substance", "measures"),
        ("concept:molar-mass", "concept:amount-of-substance", "relates_to"),
        ("concept:molar-concentration", "concept:solution", "applies_to"),
        ("concept:molar-volume", "concept:states-of-matter", "relates_to"),
        ("principle:avogadro-law", "concept:amount-of-substance", "explains"),
        # === 物质循环 ===
        ("concept:material-cycle", "concept:chemistry", "part_of"),
        ("process:nitrogen-cycle", "concept:material-cycle", "is_a"),
        ("process:sulfur-cycle", "concept:material-cycle", "is_a"),
        # === 氮循环物质关系 ===
        ("entity/substance:nitrogen", "process:nitrogen-cycle", "participates_in"),
        ("entity/substance:ammonia", "process:nitrogen-cycle", "participates_in"),
        ("entity/substance:nitric-acid", "process:nitrogen-cycle", "participates_in"),
        # === 硫循环物质关系 ===
        ("entity/substance:sulfur", "process:sulfur-cycle", "participates_in"),
        ("entity/substance:sulfur-dioxide", "process:sulfur-cycle", "participates_in"),
        ("entity/substance:sulfuric-acid", "process:sulfur-cycle", "participates_in"),
        # === 次氯酸 ===
        (
            "entity/substance:hypochlorous-acid",
            "entity/substance:chlorine",
            "derives_from",
        ),
        ("entity/substance:hypochlorous-acid", "concept:oxidizing-agent", "is_a"),
        # === 青蒿素与绿色化学 ===
        ("entity/substance:qinghaosu", "concept:green-chemistry", "example_of"),
        ("entity/substance:qinghaosu", "process:chemistry-development", "milestone_in"),
        # === 焰色试验 ===
        ("method:flame-test", "method:substance-preparation", "is_a"),
        # === 丁达尔现象 ===
        ("process:tyndall-effect", "concept:colloid", "characterizes"),
        # === 卤素性质递变 ===
        ("principle:halogen-trend", "concept:halogen", "describes"),
        ("principle:halogen-trend", "principle:periodic-law", "extends"),
        # === 化学分支与核心 ===
        ("concept:chemistry-branches", "concept:chemistry", "part_of"),
        ("concept:chemistry-core-competencies", "concept:chemistry", "defines"),
        ("concept:green-chemistry", "concept:chemistry-branches", "is_a"),
        # === 化学发展 ===
        ("process:chemistry-development", "concept:chemistry", "chronicles"),
        # === 溴和碘 ===
        ("entity/substance:bromine", "concept:halogen", "is_a"),
        ("entity/substance:iodine", "concept:halogen", "is_a"),
        # === 实验方法与物质制备 ===
        ("method:distillation", "method:substance-preparation", "is_a"),
        ("method:extraction", "method:substance-preparation", "is_a"),
        ("method:crystallization", "method:substance-preparation", "is_a"),
    ]

    for from_id, to_id, edge_type in edges_to_add:
        # Check if both nodes exist and are backbone
        if from_id not in nodes:
            print(f"  Skip: node '{from_id}' not found")
            continue
        if to_id not in nodes:
            print(f"  Skip: node '{to_id}' not found")
            continue

        # Check if edge already exists
        if (from_id, to_id, edge_type) in existing_edges:
            continue

        # Check reverse edge
        if (to_id, from_id, edge_type) in existing_edges:
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
                "backbone",
                0,  # backbone-to-backbone edges have backbone_expand = 0
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

    print(f"Added {len(new_edges)} new backbone edges")
    for edge_id, from_id, to_id, edge_type in new_edges[:30]:
        print(f"  {from_id} -> {to_id} ({edge_type})")
    if len(new_edges) > 30:
        print(f"  ... and {len(new_edges) - 30} more")


if __name__ == "__main__":
    print("=" * 50)
    print("Adding backbone-to-backbone edges")
    print("=" * 50)
    add_backbone_edges()
