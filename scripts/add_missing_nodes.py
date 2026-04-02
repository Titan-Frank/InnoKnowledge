#!/usr/bin/env python3
"""Add missing knowledge points for lesson 2-1 and other lessons."""

import sqlite3
import json
import uuid
from datetime import datetime

DB_PATH = "storage/knowledge.sqlite"
DATASET_ID = "v5"
BOOK_ID = "chem-highschool-compulsory-1"


def generate_id(prefix, content):
    return f"{prefix}:{content}"


def now():
    return datetime.utcnow().isoformat() + "Z"


def add_missing_nodes():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Lesson 2-1 missing nodes
    lesson_2_1_nodes = [
        # Concepts
        (
            "concept:crude-salt-refining",
            "粗盐提纯",
            "concept",
            "backbone",
            "通过化学沉淀法去除粗盐中的杂质离子",
            "lesson:2-1",
        ),
        (
            "concept:salt-production",
            "海水晒盐",
            "concept",
            "support",
            "把海水引入盐田，利用日光、风力蒸发浓缩海水使食盐结晶",
            "lesson:2-1",
        ),
        (
            "concept:chlor-alkali-industry",
            "氯碱工业",
            "concept",
            "backbone",
            "用电解饱和食盐水的方法制备氯气、氢气和烧碱的工业",
            "lesson:2-1",
        ),
        # Entities - substances
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
            "entity/substance:hydrochloric-acid",
            "盐酸",
            "entity",
            "backbone",
            "氯化氢的水溶液，重要化工原料",
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
            "entity/substance:iron-chloride",
            "氯化铁",
            "entity",
            "support",
            "铁在氯气中燃烧生成的产物",
            "lesson:2-1",
        ),
        (
            "entity/substance:hydrogen-chloride",
            "氯化氢",
            "entity",
            "support",
            "氢气在氯气中燃烧生成的产物",
            "lesson:2-1",
        ),
        # Methods
        (
            "method:ion-exchange-membrane-electrolysis",
            "离子膜电解法",
            "method",
            "support",
            "20世纪70年代出现的电解装置，产品质量高、电能消耗少",
            "lesson:2-1",
        ),
        (
            "method:chemical-precipitation",
            "化学沉淀法",
            "method",
            "support",
            "通过加入化学试剂使杂质离子生成沉淀后过滤除去",
            "lesson:2-1",
        ),
        (
            "method:evaporation-crystallization",
            "蒸发结晶",
            "method",
            "support",
            "通过蒸发溶剂使溶质结晶析出",
            "lesson:2-1",
        ),
        # Processes
        (
            "process:electrolysis-of-brine",
            "饱和食盐水电解",
            "process",
            "backbone",
            "电解饱和食盐水生成氯气、氢气和氢氧化钠",
            "lesson:2-1",
        ),
        (
            "process:chlorine-iron-reaction",
            "氯气与铁反应",
            "process",
            "support",
            "铁丝在氯气中燃烧生成氯化铁",
            "lesson:2-1",
        ),
        (
            "process:chlorine-hydrogen-reaction",
            "氯气与氢气反应",
            "process",
            "support",
            "氢气在氯气中燃烧生成氯化氢",
            "lesson:2-1",
        ),
        (
            "process:chlorine-water-reaction",
            "氯气与水反应",
            "process",
            "backbone",
            "氯气溶于水部分与水反应生成盐酸和次氯酸",
            "lesson:2-1",
        ),
        # Representations
        (
            "representation/equation:electrolysis-brine",
            "电解饱和食盐水方程式",
            "representation",
            "support",
            "2NaCl + 2H2O → 2NaOH + H2↑ + Cl2↑",
            "lesson:2-1",
        ),
        # Concepts from later lessons
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
        (
            "concept:halogen-periodicity",
            "卤素性质递变",
            "concept",
            "backbone",
            "卤素单质从F到I非金属性逐渐减弱",
            "lesson:2-3",
        ),
        # More entities
        (
            "entity/substance:fluorine",
            "氟气",
            "entity",
            "backbone",
            "卤素中非金属性最强的单质",
            "lesson:2-3",
        ),
        (
            "entity/substance:hydrogen-sulfide",
            "硫化氢",
            "entity",
            "support",
            "硫的氢化物，有毒气体",
            "lesson:3-1",
        ),
        (
            "entity/substance:nitric-oxide",
            "一氧化氮",
            "entity",
            "support",
            "氮的氧化物之一，无色气体",
            "lesson:3-2",
        ),
        (
            "entity/substance:nitrogen-dioxide",
            "二氧化氮",
            "entity",
            "support",
            "氮的氧化物之一，红棕色气体",
            "lesson:3-2",
        ),
        (
            "entity/substance:ammonium-chloride",
            "氯化铵",
            "entity",
            "support",
            "常见的铵盐",
            "lesson:3-2",
        ),
        (
            "entity/substance:isotope",
            "同位素",
            "entity",
            "support",
            "质子数相同而中子数不同的同一元素的不同原子",
            "lesson:4-1",
        ),
        # Concepts
        (
            "concept:electron-shell",
            "电子层",
            "concept",
            "backbone",
            "核外电子分层排布，K、L、M、N等层",
            "lesson:4-3",
        ),
        (
            "concept:electronic-configuration-rules",
            "电子排布规律",
            "concept",
            "backbone",
            "核外电子排布遵循能量最低原理等规律",
            "lesson:4-3",
        ),
    ]

    created_nodes = []
    created_mentions = []
    created_evidence = []
    created_profiles = []

    for (
        node_id,
        canonical_name,
        node_kind,
        node_layer,
        definition,
        anchor,
    ) in lesson_2_1_nodes:
        # Check if node exists
        cursor.execute(
            "SELECT id FROM nodes WHERE dataset_id=? AND id=?", (DATASET_ID, node_id)
        )
        if cursor.fetchone():
            print(f"  Node {node_id} already exists, skipping")
            continue

        # Create node
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
                "[]",
                "validated",
                now(),
                now(),
            ),
        )
        created_nodes.append((node_id, canonical_name))

        # Create evidence
        evidence_id = (
            f"evidence:{BOOK_ID}:{anchor}:{node_id.replace('/', '-').replace(':', '-')}"
        )
        anchor_ref = f"struct:{BOOK_ID}:{anchor}"

        cursor.execute(
            "SELECT id FROM evidence WHERE dataset_id=? AND id=?",
            (DATASET_ID, evidence_id),
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
            created_evidence.append((evidence_id, node_id))

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
        created_mentions.append((mention_id, node_id))

        # Create profile
        profile_id = (
            f"profile:{node_id.replace('/', '-')}:senior-secondary-chemistry:10-12"
        )
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
                "validated",
                now(),
            ),
        )
        created_profiles.append((profile_id, node_id))

    conn.commit()
    conn.close()

    print(f"Created {len(created_nodes)} nodes")
    print(f"Created {len(created_evidence)} evidence records")
    print(f"Created {len(created_mentions)} mentions")
    print(f"Created {len(created_profiles)} profiles")


if __name__ == "__main__":
    print("=" * 50)
    print("Adding missing knowledge nodes")
    print("=" * 50)
    add_missing_nodes()
