#!/usr/bin/env python3
"""Add edges for isolated nodes."""

import sqlite3
import uuid
from datetime import datetime

DB_PATH = "storage/knowledge.sqlite"
DATASET_ID = "v5"


def generate_edge_id():
    return f"edge:auto-{uuid.uuid4().hex[:12]}"


def now():
    return datetime.utcnow().isoformat() + "Z"


def add_edges():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Get existing nodes
    cursor.execute("SELECT id FROM nodes WHERE dataset_id = ?", (DATASET_ID,))
    existing_nodes = {row[0] for row in cursor.fetchall()}

    # Get existing edges
    cursor.execute(
        "SELECT from_id, to_id, edge_type FROM edges WHERE dataset_id = ?",
        (DATASET_ID,),
    )
    existing_edges = {(row[0], row[1], row[2]) for row in cursor.fetchall()}

    # Define edges for isolated nodes
    edges_to_add = [
        # 氯碱工业相关
        (
            "concept:chlor-alkali-industry",
            "entity/substance:chlorine",
            "produces",
            "backbone",
            0,
        ),
        (
            "concept:chlor-alkali-industry",
            "entity/substance:hydrogen",
            "produces",
            "backbone",
            0,
        ),
        (
            "concept:chlor-alkali-industry",
            "entity/substance:sodium-hydroxide",
            "produces",
            "backbone",
            0,
        ),
        (
            "concept:chlor-alkali-industry",
            "method:ion-exchange-membrane-electrolysis",
            "uses",
            "support",
            1,
        ),
        (
            "concept:chlor-alkali-industry",
            "process:electrolysis-of-brine",
            "uses",
            "backbone",
            0,
        ),
        (
            "concept:chlor-alkali-industry",
            "concept:chemistry",
            "part_of",
            "backbone",
            0,
        ),
        # 粗盐提纯相关
        (
            "concept:crude-salt-refining",
            "method:chemical-precipitation",
            "uses",
            "support",
            1,
        ),
        (
            "concept:crude-salt-refining",
            "method:evaporation-crystallization",
            "uses",
            "support",
            1,
        ),
        (
            "concept:crude-salt-refining",
            "entity/substance:sodium-chloride",
            "produces",
            "backbone",
            0,
        ),
        (
            "concept:crude-salt-refining",
            "concept:matter-classification",
            "related_to",
            "support",
            0,
        ),
        # 电解质相关
        ("concept:electrolyte", "concept:ion-reaction", "explains", "backbone", 0),
        ("concept:electrolyte", "concept:ionic-bond", "related_to", "support", 0),
        ("concept:electrolyte", "concept:solution", "applies_to", "support", 0),
        ("concept:non-electrolyte", "concept:electrolyte", "related_to", "backbone", 0),
        # 电子层与排布
        (
            "concept:electron-shell",
            "concept:atomic-structure",
            "part_of",
            "backbone",
            0,
        ),
        (
            "concept:electron-shell",
            "concept:electron-configuration",
            "related_to",
            "support",
            0,
        ),
        (
            "concept:electron-shell",
            "entity/subatomic:electron",
            "contains",
            "backbone",
            0,
        ),
        (
            "concept:electronic-configuration-rules",
            "concept:electron-configuration",
            "explains",
            "backbone",
            0,
        ),
        (
            "concept:electronic-configuration-rules",
            "entity/subatomic:electron",
            "applies_to",
            "support",
            1,
        ),
        # 卤素性质递变
        ("concept:halogen-periodicity", "concept:halogen", "explains", "backbone", 0),
        (
            "concept:halogen-periodicity",
            "entity/substance:fluorine",
            "applies_to",
            "support",
            1,
        ),
        (
            "concept:halogen-periodicity",
            "entity/substance:chlorine",
            "applies_to",
            "support",
            1,
        ),
        (
            "concept:halogen-periodicity",
            "entity/substance:bromine",
            "applies_to",
            "support",
            1,
        ),
        (
            "concept:halogen-periodicity",
            "entity/substance:iodine",
            "applies_to",
            "support",
            1,
        ),
        # 离子方程式
        ("concept:ionic-equation", "concept:ion-reaction", "symbolizes", "backbone", 0),
        ("concept:ionic-equation", "concept:electrolyte", "applies_to", "support", 0),
        # 海水晒盐
        (
            "concept:salt-production",
            "entity/substance:sodium-chloride",
            "produces",
            "backbone",
            0,
        ),
        (
            "concept:salt-production",
            "method:evaporation-crystallization",
            "uses",
            "support",
            1,
        ),
        (
            "concept:salt-production",
            "concept:crude-salt-refining",
            "related_to",
            "support",
            0,
        ),
        # 物质关系
        (
            "entity/substance:ammonium-chloride",
            "concept:electrolyte",
            "is_a",
            "support",
            0,
        ),
        (
            "entity/substance:ammonium-chloride",
            "entity/substance:ammonia",
            "related_to",
            "support",
            0,
        ),
        (
            "entity/substance:ammonium-chloride",
            "process:nitrogen-cycle",
            "participates_in",
            "support",
            0,
        ),
        ("entity/substance:fluorine", "concept:halogen", "is_a", "backbone", 0),
        (
            "entity/substance:hydrochloric-acid",
            "concept:electrolyte",
            "is_a",
            "support",
            0,
        ),
        (
            "entity/substance:hydrochloric-acid",
            "entity/substance:hydrogen-chloride",
            "related_to",
            "backbone",
            0,
        ),
        (
            "entity/substance:hydrochloric-acid",
            "concept:chlor-alkali-industry",
            "produces",
            "support",
            0,
        ),
        (
            "entity/substance:hydrogen",
            "process:electrolysis-of-brine",
            "produces",
            "backbone",
            0,
        ),
        (
            "entity/substance:hydrogen",
            "entity/substance:chlorine",
            "reacts_with",
            "support",
            0,
        ),
        (
            "entity/substance:hydrogen-chloride",
            "process:chlorine-hydrogen-reaction",
            "produces",
            "backbone",
            0,
        ),
        (
            "entity/substance:hydrogen-chloride",
            "entity/substance:hydrochloric-acid",
            "produces",
            "support",
            0,
        ),
        (
            "entity/substance:hydrogen-sulfide",
            "entity/substance:sulfur",
            "related_to",
            "support",
            0,
        ),
        (
            "entity/substance:hydrogen-sulfide",
            "process:sulfur-cycle",
            "participates_in",
            "support",
            0,
        ),
        (
            "entity/substance:iron-chloride",
            "process:chlorine-iron-reaction",
            "produces",
            "backbone",
            0,
        ),
        (
            "entity/substance:iron-chloride",
            "entity/substance:chlorine",
            "related_to",
            "support",
            0,
        ),
        (
            "entity/substance:isotope",
            "concept:atomic-structure",
            "related_to",
            "backbone",
            0,
        ),
        (
            "entity/substance:isotope",
            "representation/periodic-table",
            "related_to",
            "support",
            0,
        ),
        (
            "entity/substance:isotope",
            "entity/subatomic:neutron",
            "related_to",
            "support",
            0,
        ),
        (
            "entity/substance:nitric-oxide",
            "process:nitrogen-cycle",
            "participates_in",
            "support",
            0,
        ),
        (
            "entity/substance:nitric-oxide",
            "entity/substance:nitrogen",
            "related_to",
            "support",
            0,
        ),
        (
            "entity/substance:nitrogen-dioxide",
            "process:nitrogen-cycle",
            "participates_in",
            "support",
            0,
        ),
        (
            "entity/substance:nitrogen-dioxide",
            "entity/substance:nitric-oxide",
            "related_to",
            "support",
            0,
        ),
        (
            "entity/substance:sodium-chloride",
            "concept:electrolyte",
            "is_a",
            "support",
            0,
        ),
        (
            "entity/substance:sodium-chloride",
            "concept:chlor-alkali-industry",
            "related_to",
            "backbone",
            0,
        ),
        (
            "entity/substance:sodium-chloride",
            "process:electrolysis-of-brine",
            "consumes",
            "backbone",
            0,
        ),
        (
            "entity/substance:sodium-hydroxide",
            "concept:electrolyte",
            "is_a",
            "support",
            0,
        ),
        (
            "entity/substance:sodium-hydroxide",
            "process:electrolysis-of-brine",
            "produces",
            "backbone",
            0,
        ),
        # 方法关系
        (
            "method:chemical-precipitation",
            "method:substance-preparation",
            "is_a",
            "support",
            0,
        ),
        (
            "method:evaporation-crystallization",
            "method:substance-preparation",
            "is_a",
            "support",
            0,
        ),
        (
            "method:ion-exchange-membrane-electrolysis",
            "method:substance-preparation",
            "is_a",
            "support",
            0,
        ),
        # 过程关系
        (
            "process:chlorine-hydrogen-reaction",
            "entity/substance:hydrogen-chloride",
            "produces",
            "backbone",
            0,
        ),
        (
            "process:chlorine-hydrogen-reaction",
            "entity/substance:chlorine",
            "uses",
            "backbone",
            0,
        ),
        (
            "process:chlorine-hydrogen-reaction",
            "entity/substance:hydrogen",
            "uses",
            "backbone",
            0,
        ),
        (
            "process:chlorine-iron-reaction",
            "entity/substance:iron-chloride",
            "produces",
            "backbone",
            0,
        ),
        (
            "process:chlorine-iron-reaction",
            "entity/substance:chlorine",
            "uses",
            "backbone",
            0,
        ),
        (
            "process:chlorine-water-reaction",
            "entity/substance:hypochlorous-acid",
            "produces",
            "backbone",
            0,
        ),
        (
            "process:chlorine-water-reaction",
            "entity/substance:hydrochloric-acid",
            "produces",
            "backbone",
            0,
        ),
        (
            "process:chlorine-water-reaction",
            "entity/substance:chlorine",
            "uses",
            "backbone",
            0,
        ),
        (
            "process:electrolysis-of-brine",
            "entity/substance:chlorine",
            "produces",
            "backbone",
            0,
        ),
        (
            "process:electrolysis-of-brine",
            "entity/substance:hydrogen",
            "produces",
            "backbone",
            0,
        ),
        (
            "process:electrolysis-of-brine",
            "entity/substance:sodium-hydroxide",
            "produces",
            "backbone",
            0,
        ),
        (
            "process:electrolysis-of-brine",
            "entity/substance:sodium-chloride",
            "consumes",
            "backbone",
            0,
        ),
        (
            "process:electrolysis-of-brine",
            "concept:chlor-alkali-industry",
            "part_of",
            "backbone",
            0,
        ),
        # 表示关系
        (
            "representation/equation:electrolysis-brine",
            "process:electrolysis-of-brine",
            "symbolizes",
            "backbone",
            0,
        ),
        (
            "representation/equation:electrolysis-brine",
            "concept:chlor-alkali-industry",
            "symbolizes",
            "support",
            0,
        ),
    ]

    # Fix edge types that don't match schema
    edge_type_fixes = {
        "reacts_with": "related_to",
        "consumes": "uses",
        "participates_in": "related_to",
    }

    created_edges = []

    for from_id, to_id, edge_type, edge_layer, backbone_expand in edges_to_add:
        # Fix edge type
        edge_type = edge_type_fixes.get(edge_type, edge_type)

        # Check if both nodes exist
        if from_id not in existing_nodes:
            print(f"  Skip: {from_id} not found")
            continue
        if to_id not in existing_nodes:
            print(f"  Skip: {to_id} not found")
            continue

        # Check if edge already exists
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
                now(),
                now(),
            ),
        )

        created_edges.append((edge_id, from_id, to_id, edge_type))
        existing_edges.add((from_id, to_id, edge_type))

    conn.commit()
    conn.close()

    print(f"Created {len(created_edges)} new edges")
    for edge_id, from_id, to_id, edge_type in created_edges[:30]:
        print(f"  {from_id} -> {to_id} ({edge_type})")
    if len(created_edges) > 30:
        print(f"  ... and {len(created_edges) - 30} more")


if __name__ == "__main__":
    print("=" * 50)
    print("Adding edges for isolated nodes")
    print("=" * 50)
    add_edges()
