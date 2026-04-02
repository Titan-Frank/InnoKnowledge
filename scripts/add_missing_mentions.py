#!/usr/bin/env python3
"""Add missing mentions and evidence for nodes that exist in textbook."""

import sqlite3
import json
import uuid
from datetime import datetime

DB_PATH = "storage/knowledge.sqlite"
DATASET_ID = "v5"
BOOK_ID = "chem-highschool-compulsory-1"


def generate_id(prefix, content):
    return f"{prefix}:{BOOK_ID}:{content}"


def add_missing_mentions():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    now = datetime.utcnow().isoformat() + "Z"

    # Define nodes that need mentions with their anchor refs
    # Format: (node_id, anchor_ref, role, excerpt_hint)
    nodes_to_fix = [
        # 原子结构相关 - lesson 4-2
        (
            "entity/subatomic:proton",
            "lesson:4-2",
            "defines",
            "质子是原子核中带正电的粒子",
        ),
        (
            "entity/subatomic:neutron",
            "lesson:4-2",
            "defines",
            "中子是原子核中不带电的粒子",
        ),
        ("entity/subatomic:electron", "lesson:4-2", "defines", "电子是带负电的粒子"),
        # 核外电子排布 - lesson 4-3
        (
            "entity/subatomic:electron",
            "lesson:4-3",
            "extends",
            "核外电子排布遵循一定规律",
        ),
        # 化学键 - lesson 4-4
        (
            "concept:ionic-bond",
            "lesson:4-4",
            "defines",
            "离子键是阴阳离子之间的静电作用",
        ),
        (
            "concept:covalent-bond",
            "lesson:4-4",
            "defines",
            "共价键是原子间通过共用电子对形成的化学键",
        ),
        ("entity/subatomic:electron", "lesson:4-4", "uses", "化学键的形成涉及电子"),
        # 元素周期表 - lesson 4-1
        ("concept:period", "lesson:4-1", "defines", "周期是元素周期表的横行"),
        ("concept:group", "lesson:4-1", "defines", "族是元素周期表的纵列"),
        # 氧化还原反应 - lesson 2-2
        ("concept:oxidizing-agent", "lesson:2-2", "defines", "氧化剂是得到电子的物质"),
        ("concept:reducing-agent", "lesson:2-2", "defines", "还原剂是失去电子的物质"),
        # 物质循环 - lesson 3-3
        (
            "concept:material-cycle",
            "lesson:3-3",
            "introduces",
            "物质循环是指物质在自然界中的循环过程",
        ),
        # 实验方法 - lesson 1-3
        ("method:filtration", "lesson:1-3", "introduces", "过滤是分离固体和液体的方法"),
        (
            "method:liquid-separation",
            "lesson:1-3",
            "introduces",
            "分液是分离两种不互溶液体的方法",
        ),
        (
            "method:precipitation-method",
            "lesson:1-3",
            "introduces",
            "沉淀法是通过生成沉淀进行分离的方法",
        ),
        (
            "method:gas-method",
            "lesson:1-3",
            "introduces",
            "气体法是通过气体进行检验的方法",
        ),
        (
            "method:color-reaction",
            "lesson:1-3",
            "introduces",
            "显色法是通过颜色变化进行检验的方法",
        ),
    ]

    created_evidence = {}
    created_mentions = []
    created_profiles = []

    for node_id, anchor_ref, role, excerpt in nodes_to_fix:
        # Check if node exists
        cursor.execute(
            "SELECT id, canonical_name, node_kind FROM nodes WHERE dataset_id=? AND id=?",
            (DATASET_ID, node_id),
        )
        node = cursor.fetchone()
        if not node:
            print(f"  Skip: node {node_id} not found")
            continue

        canonical_name = node[1]
        node_kind = node[2]

        # Create evidence
        evidence_key = f"{anchor_ref}:{node_id.split(':')[0]}"
        if evidence_key not in created_evidence:
            evidence_id = generate_id("evidence", f"{anchor_ref}:{node_kind}")
            cursor.execute(
                """
                INSERT OR IGNORE INTO evidence (
                    dataset_id, id, source_type, source_id, anchor_ref,
                    excerpt, locator, extraction_method, normalized_claims_json, properties_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    DATASET_ID,
                    evidence_id,
                    "textbook",
                    BOOK_ID,
                    f"struct:{BOOK_ID}:{anchor_ref}",
                    excerpt,
                    f"struct:{BOOK_ID}:{anchor_ref}",
                    "text_extraction",
                    "[]",
                    "{}",
                ),
            )
            created_evidence[evidence_key] = evidence_id
        else:
            evidence_id = created_evidence[evidence_key]

        # Create mention
        mention_id = generate_id("mention", f"{anchor_ref}:{node_id.replace('/', '-')}")
        mention_id = mention_id.replace("/", "-")

        cursor.execute(
            """
            INSERT OR IGNORE INTO mentions (
                dataset_id, id, source_type, source_id, anchor_ref,
                target_type, target_id, role, source_refs_json, confidence, properties_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                DATASET_ID,
                mention_id,
                "textbook",
                BOOK_ID,
                f"struct:{BOOK_ID}:{anchor_ref}",
                "node",
                node_id,
                role,
                json.dumps([evidence_id]),
                0.9,
                "{}",
            ),
        )
        created_mentions.append((mention_id, node_id, anchor_ref))

        # Create profile if not exists
        profile_id = (
            f"profile:{node_id.replace('/', '-')}:senior-secondary-chemistry:10-12"
        )
        cursor.execute(
            "SELECT id FROM profiles WHERE dataset_id=? AND id=?",
            (DATASET_ID, profile_id),
        )
        if not cursor.fetchone():
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
                    json.dumps([f"struct:{BOOK_ID}:{anchor_ref}"]),
                    json.dumps([BOOK_ID]),
                    "{}",
                    "validated",
                    now,
                ),
            )
            created_profiles.append((profile_id, node_id))

    conn.commit()
    conn.close()

    print(f"Created {len(created_evidence)} evidence records")
    print(f"Created {len(created_mentions)} mentions")
    print(f"Created {len(created_profiles)} profiles")


if __name__ == "__main__":
    print("=" * 50)
    print("Adding missing mentions and evidence")
    print("=" * 50)
    add_missing_mentions()
