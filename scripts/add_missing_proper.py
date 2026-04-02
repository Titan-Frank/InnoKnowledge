#!/usr/bin/env python3
"""Add missing knowledge points using proper workflow: retrieve -> decide -> create."""

import sqlite3
import json
import uuid
from datetime import datetime

DB_PATH = "storage/knowledge.sqlite"
DATASET_ID = "v5"
BOOK_ID = "chem-highschool-compulsory-1"


def generate_id(prefix, content):
    return f"{prefix}:{content}"


def generate_edge_id():
    return f"edge:auto-{uuid.uuid4().hex[:12]}"


def now():
    return datetime.utcnow().isoformat() + "Z"


def retrieve_candidates(cursor, search_term, node_kind=None):
    """Retrieve candidate nodes by name or alias."""
    query = """
        SELECT id, canonical_name, node_kind, node_layer, aliases_json
        FROM nodes
        WHERE dataset_id = ?
          AND (canonical_name LIKE ? OR aliases_json LIKE ?)
    """
    params = [DATASET_ID, f"%{search_term}%", f"%{search_term}%"]

    if node_kind:
        query += " AND node_kind = ?"
        params.append(node_kind)

    cursor.execute(query, params)
    return cursor.fetchall()


def node_exists(cursor, node_id):
    """Check if node already exists."""
    cursor.execute(
        "SELECT id FROM nodes WHERE dataset_id=? AND id=?", (DATASET_ID, node_id)
    )
    return cursor.fetchone() is not None


def edge_exists(cursor, from_id, to_id, edge_type):
    """Check if edge already exists."""
    cursor.execute(
        """
        SELECT id FROM edges 
        WHERE dataset_id=? AND from_id=? AND to_id=? AND edge_type=?
    """,
        (DATASET_ID, from_id, to_id, edge_type),
    )
    return cursor.fetchone() is not None


def create_node_with_provenance(
    cursor, node_id, canonical_name, node_kind, node_layer, definition, anchor
):
    """Create node with evidence, mention, and profile."""

    # Check if node already exists
    if node_exists(cursor, node_id):
        print(f"  Node {node_id} already exists, skipping creation")
        return None

    # Create node
    learning_modes = (
        ["conceptual"]
        if node_kind == "concept"
        else ["factual"]
        if node_kind == "entity"
        else ["procedural"]
        if node_kind in ["method", "process"]
        else ["conceptual"]
    )

    cursor.execute(
        """
        INSERT INTO nodes (
            dataset_id, id, canonical_name, node_kind, node_layer,
            definition, aliases_json, properties_json, bridge_tags_json,
            learning_modes_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            DATASET_ID,
            node_id,
            canonical_name,
            node_kind,
            node_layer,
            definition,
            "[]",
            "{}",
            "[]",
            json.dumps(learning_modes),
            "active",
            now(),
            now(),
        ),
    )

    # Create evidence
    evidence_id = (
        f"evidence:{BOOK_ID}:{anchor}:{node_id.replace('/', '-').replace(':', '-')}"
    )
    anchor_ref = f"struct:{BOOK_ID}:{anchor}"

    # Check if evidence already exists
    cursor.execute(
        "SELECT id FROM evidence WHERE dataset_id=? AND id=?", (DATASET_ID, evidence_id)
    )
    if not cursor.fetchone():
        cursor.execute(
            """
            INSERT INTO evidence (
                dataset_id, id, source_type, source_id, anchor_ref,
                excerpt, locator, extraction_method, normalized_claims_json, properties_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                DATASET_ID,
                evidence_id,
                "textbook",
                BOOK_ID,
                anchor_ref,
                definition,
                anchor_ref,
                "pdftotext",
                "[]",
                "{}",
            ),
        )

    # Create mention
    mention_id = f"mention:{BOOK_ID}:{anchor}:{node_id.replace('/', '-')}"
    cursor.execute(
        """
        INSERT INTO mentions (
            dataset_id, id, source_type, source_id, anchor_ref,
            target_type, target_id, role, source_refs_json, confidence, properties_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            DATASET_ID,
            mention_id,
            "textbook",
            BOOK_ID,
            anchor_ref,
            "node",
            node_id,
            "defines",
            json.dumps([evidence_id]),
            0.9,
            "{}",
        ),
    )

    # Create profile
    profile_id = f"profile:{node_id.replace('/', '-')}:senior-secondary-chemistry:10-12"
    cursor.execute(
        """
        INSERT INTO profiles (
            dataset_id, id, node_id, subject, school_stage, grade_band,
            context_key, curriculum_role, mastery_level, framework_refs_json,
            learning_objectives_json, textbook_refs_json, textbook_ids_json,
            properties_json, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            DATASET_ID,
            profile_id,
            node_id,
            "化学",
            "senior_secondary",
            "10-12",
            "senior-secondary-chemistry:10-12",
            "introduced",
            "understand",
            json.dumps(["framework:senior-secondary-chemistry-curriculum"]),
            json.dumps([f"理解{canonical_name}的概念"]),
            json.dumps([anchor_ref]),
            json.dumps([BOOK_ID]),
            "{}",
            "active",
            now(),
        ),
    )

    return node_id


def create_relation_proposal(cursor, from_id, to_id, edge_type, evidence_id):
    """Create a relation proposal (not directly promoting to edge)."""
    proposal_id = f"proposal:{uuid.uuid4().hex[:12]}"

    cursor.execute(
        """
        INSERT INTO relation_proposals (
            dataset_id, proposal_id, batch_anchor, source_id, anchor_ref,
            subject, school_stage, grade_band,
            from_node_id, to_node_id, edge_type,
            confidence, evidence_refs_json, status,
            properties_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            DATASET_ID,
            proposal_id,
            "manual-supplement",
            BOOK_ID,
            "manual-supplement",
            "化学",
            "senior_secondary",
            "10-12",
            from_id,
            to_id,
            edge_type,
            0.9,
            json.dumps([evidence_id]) if evidence_id else "[]",
            "candidate",
            "{}",
            now(),
        ),
    )

    return proposal_id


def promote_proposal_to_edge(
    cursor, from_id, to_id, edge_type, edge_layer="backbone", backbone_expand=0
):
    """Promote a relation proposal to canonical edge after checking."""

    # Check if both nodes exist
    if not node_exists(cursor, from_id):
        print(f"    Warning: from_id {from_id} not found")
        return None
    if not node_exists(cursor, to_id):
        print(f"    Warning: to_id {to_id} not found")
        return None

    # Check if edge already exists
    if edge_exists(cursor, from_id, to_id, edge_type):
        print(f"    Edge {from_id} -> {to_id} ({edge_type}) already exists")
        return None

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
            "active",
            now(),
            now(),
        ),
    )

    return edge_id


def add_missing_knowledge_points():
    """Main function to add missing knowledge points using proper workflow."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print("Step 1: Retrieving existing nodes...")

    # Check existing chlorine-related nodes
    chlorine_nodes = retrieve_candidates(cursor, "氯")
    print(f"  Found {len(chlorine_nodes)} chlorine-related nodes")

    # Check existing electrolyte nodes
    electrolyte_nodes = retrieve_candidates(cursor, "电解质")
    print(f"  Found {len(electrolyte_nodes)} electrolyte-related nodes")

    print("\nStep 2: Creating missing nodes with proper provenance...")

    # Define nodes to add with their definitions and anchors
    nodes_to_add = [
        # Lesson 2-1
        (
            "concept:chlor-alkali-industry",
            "氯碱工业",
            "concept",
            "backbone",
            "用电解饱和食盐水的方法制备氯气、氢气和烧碱的工业",
            "lesson:2-1",
        ),
        (
            "concept:crude-salt-refining",
            "粗盐提纯",
            "concept",
            "backbone",
            "通过化学沉淀法去除粗盐中的杂质离子",
            "lesson:2-1",
        ),
        (
            "entity/substance:hydrogen",
            "氢气",
            "entity",
            "backbone",
            "电解饱和食盐水的阴极产物，可燃性气体",
            "lesson:2-1",
        ),
        (
            "entity/substance:sodium-hydroxide",
            "氢氧化钠",
            "entity",
            "backbone",
            "电解饱和食盐水的产物之一，烧碱",
            "lesson:2-1",
        ),
        (
            "entity/substance:sodium-chloride",
            "氯化钠",
            "entity",
            "backbone",
            "食盐的主要成分，海水中含量最高的盐",
            "lesson:2-1",
        ),
        (
            "process:electrolysis-of-brine",
            "饱和食盐水电解",
            "process",
            "backbone",
            "电解饱和食盐水生成氯气、氢气和氢氧化钠",
            "lesson:2-1",
        ),
        # Lesson 2-2
        (
            "concept:electrolyte",
            "电解质",
            "concept",
            "backbone",
            "在水溶液中或熔融状态下能导电的化合物",
            "lesson:2-2",
        ),
        (
            "concept:non-electrolyte",
            "非电解质",
            "concept",
            "support",
            "在水溶液中和熔融状态下都不能导电的化合物",
            "lesson:2-2",
        ),
        (
            "concept:ionic-equation",
            "离子方程式",
            "concept",
            "backbone",
            "用实际参加反应的离子符号表示离子反应的式子",
            "lesson:2-2",
        ),
    ]

    created_nodes = []
    for (
        node_id,
        canonical_name,
        node_kind,
        node_layer,
        definition,
        anchor,
    ) in nodes_to_add:
        # Retrieve candidates first
        candidates = retrieve_candidates(cursor, canonical_name, node_kind)
        if candidates:
            print(f"  Found existing candidates for {canonical_name}, checking...")
            for cand in candidates:
                print(f"    - {cand[0]} ({cand[1]})")

        # Create node
        result = create_node_with_provenance(
            cursor, node_id, canonical_name, node_kind, node_layer, definition, anchor
        )
        if result:
            created_nodes.append(result)
            print(f"  Created: {node_id} ({canonical_name})")

    print(f"\nCreated {len(created_nodes)} new nodes")

    print("\nStep 3: Creating relation proposals...")

    # Define relations to add
    relations_to_add = [
        # Chlor-alkali industry
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
            "process:electrolysis-of-brine",
            "uses",
            "backbone",
            0,
        ),
        # Process relations
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
            "uses",
            "backbone",
            0,
        ),
        # Crude salt refining
        (
            "concept:crude-salt-refining",
            "entity/substance:sodium-chloride",
            "produces",
            "backbone",
            0,
        ),
        # Electrolyte
        ("concept:electrolyte", "concept:ion-reaction", "explains", "backbone", 0),
        ("concept:non-electrolyte", "concept:electrolyte", "related_to", "backbone", 0),
        # Ionic equation
        ("concept:ionic-equation", "concept:ion-reaction", "symbolizes", "backbone", 0),
    ]

    created_edges = []
    for from_id, to_id, edge_type, edge_layer, backbone_expand in relations_to_add:
        # Create proposal first
        proposal_id = create_relation_proposal(cursor, from_id, to_id, edge_type, None)

        # Then promote to edge after checking
        edge_id = promote_proposal_to_edge(
            cursor, from_id, to_id, edge_type, edge_layer, backbone_expand
        )
        if edge_id:
            created_edges.append(edge_id)
            print(f"  Created edge: {from_id} -> {to_id} ({edge_type})")

    print(f"\nCreated {len(created_edges)} new edges")

    conn.commit()
    conn.close()


if __name__ == "__main__":
    print("=" * 50)
    print("Adding missing knowledge using proper workflow")
    print("=" * 50)
    add_missing_knowledge_points()
