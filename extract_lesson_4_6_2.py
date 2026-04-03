#!/usr/bin/env python3
"""Extract lesson 4-6-2: 化学反应的表示及基本类型"""

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from knowledge_store_common import connect_db, utc_now

DB_PATH = REPO_ROOT / "storage" / "knowledge.sqlite"
DATASET_ID = "v4"
BATCH_ANCHOR = "struct:chem-grade8-huku54-shanghai:lesson:4-6-2"


def main():
    conn = connect_db(str(DB_PATH))
    cursor = conn.cursor()

    # Check if this lesson was already processed
    cursor.execute(
        "SELECT COUNT(*) FROM mentions WHERE anchor_ref = ?", (BATCH_ANCHOR,)
    )
    if cursor.fetchone()[0] > 0:
        print(f"Lesson {BATCH_ANCHOR} already has mentions. Skipping extraction.")
        return

    print(f"Extracting lesson: {BATCH_ANCHOR}")
    now = utc_now()

    # ============================================================
    # PHASE 1: Create Evidence Records
    # ============================================================

    evidence_records = [
        {
            "id": "evidence:chem:4-6-2:p157-lesson-intro",
            "dataset_id": DATASET_ID,
            "source_type": "textbook",
            "source_id": "chem-grade8-huku54-shanghai",
            "anchor_ref": BATCH_ANCHOR,
            "excerpt": "通过分析具体化学反应，理解化学方程式的含义及书写规则。会利用化学方程式中物质的质量关系、比例关系进行简单计算...对化学反应进行分类，辨析置换反应、复分解反应",
            "locator": "第157页，课题2学习聚焦",
            "page_start": 157,
            "page_end": 157,
            "modality": "text",
            "extraction_method": "ocr",
        },
        {
            "id": "evidence:chem:4-6-2:p157-chemical-equation-def",
            "dataset_id": DATASET_ID,
            "source_type": "textbook",
            "source_id": "chem-grade8-huku54-shanghai",
            "anchor_ref": BATCH_ANCHOR,
            "excerpt": "我们可以用包含化学式的式子来表示化学反应，这种式子叫做化学方程式。下面这个化学方程式可以读作氢气与氧气在点燃的条件下反应生成水...",
            "locator": "第157页，如何表示化学反应",
            "page_start": 157,
            "page_end": 157,
            "modality": "text",
            "extraction_method": "ocr",
        },
        {
            "id": "evidence:chem:4-6-2:p158-equation-writing",
            "dataset_id": DATASET_ID,
            "source_type": "textbook",
            "source_id": "chem-grade8-huku54-shanghai",
            "anchor_ref": BATCH_ANCHOR,
            "excerpt": "书写化学方程式时应遵守两条原则：一是以客观事实为依据，二是要符合质量守恒定律。化学方程式等号两边的原子种类和数目都相等...第一步：根据反应事实，在式子的左、右两边分别写反应物和生成物的化学式。第二步：配平化学方程式。第三步：标明化学反应所需要的条件和部分生成物的状态符号。",
            "locator": "第158页，如何书写化学方程式",
            "page_start": 158,
            "page_end": 158,
            "modality": "text",
            "extraction_method": "ocr",
        },
        {
            "id": "evidence:chem:4-6-2:p159-equation-info",
            "dataset_id": DATASET_ID,
            "source_type": "textbook",
            "source_id": "chem-grade8-huku54-shanghai",
            "anchor_ref": BATCH_ANCHOR,
            "excerpt": "化学方程式不仅表明反应物、生成物各是哪些物质，而且还表明了它们之间的质量关系。例如，氢气与氧气在点燃的条件下发生反应生成水，参加反应的物质的微观粒子数目比确定...该化学方程式可表示：(1)氢气在氧气中燃烧能生成水。(2)每2个氢分子与1个氧分子反应生成2个水分子。(3)参加反应的氢气、氧气和生成的水的质量比为4:32:36。",
            "locator": "第159页，化学方程式中蕴含着哪些信息",
            "page_start": 159,
            "page_end": 159,
            "modality": "text",
            "extraction_method": "ocr",
        },
        {
            "id": "evidence:chem:4-6-2:p160-displacement-reaction",
            "dataset_id": DATASET_ID,
            "source_type": "textbook",
            "source_id": "chem-grade8-huku54-shanghai",
            "anchor_ref": BATCH_ANCHOR,
            "excerpt": "氧化铜与木炭在高温条件下反应生成铜和二氧化碳，该反应是由一种单质和一种化合物作用生成另一种单质和另一种化合物的反应，这类反应称为置换反应。",
            "locator": "第160页，有哪些化学反应的基本类型",
            "page_start": 160,
            "page_end": 160,
            "modality": "text",
            "extraction_method": "ocr",
        },
        {
            "id": "evidence:chem:4-6-2:p160-double-replacement",
            "dataset_id": DATASET_ID,
            "source_type": "textbook",
            "source_id": "chem-grade8-huku54-shanghai",
            "anchor_ref": BATCH_ANCHOR,
            "excerpt": "碳酸钙与盐酸反应生成氯化钙和碳酸（碳酸会进一步分解成水和二氧化碳），该反应是由两种化合物相互交换成分生成另外两种化合物的反应，这类反应称为复分解反应。",
            "locator": "第160页，有哪些化学反应的基本类型",
            "page_start": 160,
            "page_end": 160,
            "modality": "text",
            "extraction_method": "ocr",
        },
        {
            "id": "evidence:chem:4-6-2:p160-oxidation-reduction",
            "dataset_id": DATASET_ID,
            "source_type": "textbook",
            "source_id": "chem-grade8-huku54-shanghai",
            "anchor_ref": BATCH_ANCHOR,
            "excerpt": "例如，氢气与氧化铜反应，生成铜和水。在这个反应里，氧化铜失去氧而变成单质铜，这种含氧化合物里的氧被夺去的反应，属于还原反应；氢气得到氧而变成水的反应，属于氧化反应。",
            "locator": "第160页，化学广角镜-化学反应的不同分类",
            "page_start": 160,
            "page_end": 160,
            "modality": "text",
            "extraction_method": "ocr",
        },
    ]

    for ev in evidence_records:
        cursor.execute(
            """INSERT OR REPLACE INTO evidence 
               (dataset_id, id, source_type, source_id, anchor_ref, excerpt, 
                locator, page_start, page_end, modality, extraction_method)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                ev["dataset_id"],
                ev["id"],
                ev["source_type"],
                ev["source_id"],
                ev["anchor_ref"],
                ev["excerpt"],
                ev["locator"],
                ev["page_start"],
                ev["page_end"],
                ev["modality"],
                ev["extraction_method"],
            ),
        )
    print(f"✓ Created {len(evidence_records)} evidence records")

    # ============================================================
    # PHASE 2: Create/Update Nodes
    # ============================================================

    new_backbone_nodes = []

    # Check if concept:chemical-reaction exists, create if not
    cursor.execute(
        "SELECT 1 FROM nodes WHERE dataset_id = ? AND id = ?",
        (DATASET_ID, "concept:chemical-reaction"),
    )
    if not cursor.fetchone():
        cursor.execute(
            """INSERT OR REPLACE INTO nodes 
               (dataset_id, id, canonical_name, node_kind, node_layer, node_subkind, 
                definition, aliases_json, learning_modes_json, bridge_tags_json, 
                framework_refs_json, card_ref, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                DATASET_ID,
                "concept:chemical-reaction",
                "化学反应",
                "concept",
                "backbone",
                None,
                "有新物质生成的变化过程，是化学研究的核心对象。",
                json.dumps(["化学变化"], ensure_ascii=False),
                json.dumps(["conceptual"], ensure_ascii=False),
                json.dumps(["chemical-reaction", "transformation"], ensure_ascii=False),
                json.dumps(["framework:chem-grade8:topic:4-6"], ensure_ascii=False),
                None,
                "active",
                now,
                now,
            ),
        )
        print("✓ Created concept:chemical-reaction (parent node)")

    # Node 1: 置换反应 (NEW)
    node_displacement = {
        "id": "concept:chemical-reaction:displacement",
        "canonical_name": "置换反应",
        "node_kind": "concept",
        "node_layer": "backbone",
        "node_subkind": "chemical-reaction",
        "definition": "一种单质与一种化合物反应，生成另一种单质和另一种化合物的化学反应。",
        "aliases": ["单置换反应", "取代反应"],
        "learning_modes": ["conceptual"],
        "bridge_tags": ["chemical-reaction", "reaction-type", "transformation"],
        "framework_refs": ["framework:chem-grade8:topic:4-6"],
        "card_ref": "node-card:concept:chemical-reaction:displacement",
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    new_backbone_nodes.append("置换反应")

    # Node 2: 复分解反应 (NEW)
    node_double = {
        "id": "concept:chemical-reaction:double-displacement",
        "canonical_name": "复分解反应",
        "node_kind": "concept",
        "node_layer": "backbone",
        "node_subkind": "chemical-reaction",
        "definition": "两种化合物相互交换成分，生成另外两种化合物的化学反应。",
        "aliases": ["双置换反应", "交换反应"],
        "learning_modes": ["conceptual"],
        "bridge_tags": ["chemical-reaction", "reaction-type", "transformation"],
        "framework_refs": ["framework:chem-grade8:topic:4-6"],
        "card_ref": "node-card:concept:chemical-reaction:double-displacement",
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    new_backbone_nodes.append("复分解反应")

    # Node 3: 化学方程式的书写 (NEW - method)
    node_equation_writing = {
        "id": "skill:equation-writing",
        "canonical_name": "化学方程式的书写",
        "node_kind": "skill",
        "node_layer": "backbone",
        "node_subkind": "procedure",
        "definition": "根据化学反应事实，按照写、配、标三个步骤正确书写化学方程式的技能。",
        "aliases": ["方程式书写", "书写化学方程式"],
        "learning_modes": ["procedural", "conceptual"],
        "bridge_tags": ["chemical-representation", "skill", "writing"],
        "framework_refs": ["framework:chem-grade8:topic:4-6"],
        "card_ref": "node-card:skill:equation-writing",
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    new_backbone_nodes.append("化学方程式的书写")

    # Node 4: 化学方程式的意义 (NEW - concept)
    node_equation_meaning = {
        "id": "concept:chemical-equation:meaning",
        "canonical_name": "化学方程式的意义",
        "node_kind": "concept",
        "node_layer": "backbone",
        "node_subkind": None,
        "definition": "化学方程式所蕴含的质和量两方面的信息，包括反应物、生成物、反应条件、微观粒子数目比和物质质量比。",
        "aliases": ["方程式含义", "化学方程式读法"],
        "learning_modes": ["conceptual"],
        "bridge_tags": ["chemical-representation", "understanding", "quantitative"],
        "framework_refs": ["framework:chem-grade8:topic:4-6"],
        "card_ref": "node-card:concept:chemical-equation:meaning",
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    new_backbone_nodes.append("化学方程式的意义")

    # Node 5: 氧化反应 (NEW - concept)
    node_oxidation = {
        "id": "concept:chemical-reaction:oxidation",
        "canonical_name": "氧化反应",
        "node_kind": "concept",
        "node_layer": "backbone",
        "node_subkind": "chemical-reaction",
        "definition": "物质与氧发生的化学反应，或从广义上说，物质失去电子的反应。",
        "aliases": ["氧化作用"],
        "learning_modes": ["conceptual"],
        "bridge_tags": ["chemical-reaction", "reaction-type", "redox"],
        "framework_refs": ["framework:chem-grade8:topic:4-6"],
        "card_ref": "node-card:concept:chemical-reaction:oxidation",
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    new_backbone_nodes.append("氧化反应")

    # Node 6: 还原反应 (NEW - concept)
    node_reduction = {
        "id": "concept:chemical-reaction:reduction",
        "canonical_name": "还原反应",
        "node_kind": "concept",
        "node_layer": "backbone",
        "node_subkind": "chemical-reaction",
        "definition": "含氧化合物里的氧被夺去的反应，或从广义上说，物质得到电子的反应。",
        "aliases": ["还原作用"],
        "learning_modes": ["conceptual"],
        "bridge_tags": ["chemical-reaction", "reaction-type", "redox"],
        "framework_refs": ["framework:chem-grade8:topic:4-6"],
        "card_ref": "node-card:concept:chemical-reaction:reduction",
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    new_backbone_nodes.append("还原反应")

    # Insert all nodes
    nodes_to_insert = [
        node_displacement,
        node_double,
        node_equation_writing,
        node_equation_meaning,
        node_oxidation,
        node_reduction,
    ]

    for node in nodes_to_insert:
        cursor.execute(
            """INSERT OR REPLACE INTO nodes 
               (dataset_id, id, canonical_name, node_kind, node_layer, node_subkind, 
                definition, aliases_json, learning_modes_json, bridge_tags_json, 
                framework_refs_json, card_ref, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                DATASET_ID,
                node["id"],
                node["canonical_name"],
                node["node_kind"],
                node["node_layer"],
                node["node_subkind"],
                node["definition"],
                json.dumps(node["aliases"], ensure_ascii=False),
                json.dumps(node["learning_modes"], ensure_ascii=False),
                json.dumps(node["bridge_tags"], ensure_ascii=False),
                json.dumps(node["framework_refs"], ensure_ascii=False),
                node["card_ref"],
                node["status"],
                node["created_at"],
                node["updated_at"],
            ),
        )
    print(f"✓ Created {len(nodes_to_insert)} new backbone nodes")

    # ============================================================
    # PHASE 3: Create Curriculum Profiles
    # ============================================================

    profiles = [
        {
            "id": "profile:chem:concept:chemical-reaction:displacement",
            "node_id": "concept:chemical-reaction:displacement",
            "subject": "chemistry",
            "school_stage": "junior_high",
            "grade_band": "grade_8",
            "curriculum_role": "introduced",
            "mastery_level": "understand",
            "objectives": [
                "理解置换反应的定义和特征",
                "能够识别和书写置换反应的化学方程式",
                "理解置换反应中元素化合价的变化",
            ],
            "framework_refs": ["framework:chem-grade8:topic:4-6"],
            "textbook_refs": [BATCH_ANCHOR],
            "status": "active",
            "updated_at": now,
        },
        {
            "id": "profile:chem:concept:chemical-reaction:double-displacement",
            "node_id": "concept:chemical-reaction:double-displacement",
            "subject": "chemistry",
            "school_stage": "junior_high",
            "grade_band": "grade_8",
            "curriculum_role": "introduced",
            "mastery_level": "understand",
            "objectives": [
                "理解复分解反应的定义和特征",
                "能够识别复分解反应",
                "了解复分解反应发生的条件",
            ],
            "framework_refs": ["framework:chem-grade8:topic:4-6"],
            "textbook_refs": [BATCH_ANCHOR],
            "status": "active",
            "updated_at": now,
        },
        {
            "id": "profile:chem:skill:equation-writing",
            "node_id": "skill:equation-writing",
            "subject": "chemistry",
            "school_stage": "junior_high",
            "grade_band": "grade_8",
            "curriculum_role": "focuses_on",
            "mastery_level": "apply",
            "objectives": [
                "掌握书写化学方程式的三步骤",
                "能够正确配平化学方程式",
                "能够正确标注反应条件和状态符号",
            ],
            "framework_refs": ["framework:chem-grade8:topic:4-6"],
            "textbook_refs": [BATCH_ANCHOR],
            "status": "active",
            "updated_at": now,
        },
        {
            "id": "profile:chem:concept:chemical-equation:meaning",
            "node_id": "concept:chemical-equation:meaning",
            "subject": "chemistry",
            "school_stage": "junior_high",
            "grade_band": "grade_8",
            "curriculum_role": "focuses_on",
            "mastery_level": "understand",
            "objectives": [
                "理解化学方程式的质的意义",
                "理解化学方程式的量的意义",
                "能够进行基于化学方程式的简单计算",
            ],
            "framework_refs": ["framework:chem-grade8:topic:4-6"],
            "textbook_refs": [BATCH_ANCHOR],
            "status": "active",
            "updated_at": now,
        },
        {
            "id": "profile:chem:concept:chemical-reaction:oxidation",
            "node_id": "concept:chemical-reaction:oxidation",
            "subject": "chemistry",
            "school_stage": "junior_high",
            "grade_band": "grade_8",
            "curriculum_role": "introduced",
            "mastery_level": "recall",
            "objectives": ["了解氧化反应的概念", "能够识别简单的氧化反应"],
            "framework_refs": ["framework:chem-grade8:topic:4-6"],
            "textbook_refs": [BATCH_ANCHOR],
            "status": "active",
            "updated_at": now,
        },
        {
            "id": "profile:chem:concept:chemical-reaction:reduction",
            "node_id": "concept:chemical-reaction:reduction",
            "subject": "chemistry",
            "school_stage": "junior_high",
            "grade_band": "grade_8",
            "curriculum_role": "introduced",
            "mastery_level": "recall",
            "objectives": ["了解还原反应的概念", "能够识别简单的还原反应"],
            "framework_refs": ["framework:chem-grade8:topic:4-6"],
            "textbook_refs": [BATCH_ANCHOR],
            "status": "active",
            "updated_at": now,
        },
    ]

    for profile in profiles:
        context_key = (
            f"{profile['subject']}:{profile['school_stage']}:{profile['grade_band']}"
        )
        cursor.execute(
            """INSERT OR REPLACE INTO profiles 
               (dataset_id, id, node_id, subject, school_stage, grade_band, context_key,
                curriculum_role, mastery_level, learning_objectives_json,
                framework_refs_json, textbook_refs_json, status, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                DATASET_ID,
                profile["id"],
                profile["node_id"],
                profile["subject"],
                profile["school_stage"],
                profile["grade_band"],
                context_key,
                profile["curriculum_role"],
                profile["mastery_level"],
                json.dumps(profile["objectives"], ensure_ascii=False),
                json.dumps(profile["framework_refs"], ensure_ascii=False),
                json.dumps(profile["textbook_refs"], ensure_ascii=False),
                profile["status"],
                profile["updated_at"],
            ),
        )
    print(f"✓ Created {len(profiles)} curriculum profiles")

    # ============================================================
    # PHASE 4: Create Mentions
    # ============================================================

    mentions = [
        # 置换反应
        {
            "id": "mention:chem:displacement-in-4-6-2",
            "target_type": "node",
            "target_id": "concept:chemical-reaction:displacement",
            "anchor_ref": BATCH_ANCHOR,
            "source_type": "textbook",
            "source_id": "chem-grade8-huku54-shanghai",
            "role": "defines",
            "confidence": 0.95,
            "source_refs_json": json.dumps(
                ["evidence:chem:4-6-2:p160-displacement-reaction"], ensure_ascii=False
            ),
        },
        # 复分解反应
        {
            "id": "mention:chem:double-displacement-in-4-6-2",
            "target_type": "node",
            "target_id": "concept:chemical-reaction:double-displacement",
            "anchor_ref": BATCH_ANCHOR,
            "source_type": "textbook",
            "source_id": "chem-grade8-huku54-shanghai",
            "role": "defines",
            "confidence": 0.95,
            "source_refs_json": json.dumps(
                ["evidence:chem:4-6-2:p160-double-replacement"], ensure_ascii=False
            ),
        },
        # 化学方程式的书写
        {
            "id": "mention:chem:equation-writing-in-4-6-2",
            "target_type": "node",
            "target_id": "skill:equation-writing",
            "anchor_ref": BATCH_ANCHOR,
            "source_type": "textbook",
            "source_id": "chem-grade8-huku54-shanghai",
            "role": "focuses_on",
            "confidence": 0.9,
            "source_refs_json": json.dumps(
                ["evidence:chem:4-6-2:p158-equation-writing"], ensure_ascii=False
            ),
        },
        # 化学方程式的意义
        {
            "id": "mention:chem:equation-meaning-in-4-6-2",
            "target_type": "node",
            "target_id": "concept:chemical-equation:meaning",
            "anchor_ref": BATCH_ANCHOR,
            "source_type": "textbook",
            "source_id": "chem-grade8-huku54-shanghai",
            "role": "focuses_on",
            "confidence": 0.9,
            "source_refs_json": json.dumps(
                ["evidence:chem:4-6-2:p159-equation-info"], ensure_ascii=False
            ),
        },
        # 氧化反应
        {
            "id": "mention:chem:oxidation-in-4-6-2",
            "target_type": "node",
            "target_id": "concept:chemical-reaction:oxidation",
            "anchor_ref": BATCH_ANCHOR,
            "source_type": "textbook",
            "source_id": "chem-grade8-huku54-shanghai",
            "role": "introduces",
            "confidence": 0.85,
            "source_refs_json": json.dumps(
                ["evidence:chem:4-6-2:p160-oxidation-reduction"], ensure_ascii=False
            ),
        },
        # 还原反应
        {
            "id": "mention:chem:reduction-in-4-6-2",
            "target_type": "node",
            "target_id": "concept:chemical-reaction:reduction",
            "anchor_ref": BATCH_ANCHOR,
            "source_type": "textbook",
            "source_id": "chem-grade8-huku54-shanghai",
            "role": "introduces",
            "confidence": 0.85,
            "source_refs_json": json.dumps(
                ["evidence:chem:4-6-2:p160-oxidation-reduction"], ensure_ascii=False
            ),
        },
    ]

    for mention in mentions:
        cursor.execute(
            """INSERT OR REPLACE INTO mentions 
               (dataset_id, id, target_type, target_id, anchor_ref, source_type,
                source_id, role, confidence, source_refs_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                DATASET_ID,
                mention["id"],
                mention["target_type"],
                mention["target_id"],
                mention["anchor_ref"],
                mention["source_type"],
                mention["source_id"],
                mention["role"],
                mention["confidence"],
                mention["source_refs_json"],
            ),
        )
    print(f"✓ Created {len(mentions)} mentions")

    # ============================================================
    # PHASE 5: Create Edges
    # ============================================================

    edges = [
        # 置换反应 is_a 化学反应 basic type
        {
            "id": "edge:chemical-reaction--contains--displacement",
            "from_id": "concept:chemical-reaction",
            "to_id": "concept:chemical-reaction:displacement",
            "edge_type": "contains",
            "edge_layer": "backbone",
            "backbone_expand": True,
            "directionality": "directed",
            "confidence": 0.95,
            "source_refs_json": json.dumps(
                ["evidence:chem:4-6-2:p160-displacement-reaction"], ensure_ascii=False
            ),
            "status": "active",
            "created_at": now,
        },
        # 复分解反应 is_a 化学反应 basic type
        {
            "id": "edge:chemical-reaction--contains--double-displacement",
            "from_id": "concept:chemical-reaction",
            "to_id": "concept:chemical-reaction:double-displacement",
            "edge_type": "contains",
            "edge_layer": "backbone",
            "backbone_expand": True,
            "directionality": "directed",
            "confidence": 0.95,
            "source_refs_json": json.dumps(
                ["evidence:chem:4-6-2:p160-double-replacement"], ensure_ascii=False
            ),
            "status": "active",
            "created_at": now,
        },
        # 氧化反应 is_a 反应类型
        {
            "id": "edge:reaction-classification--contains--oxidation",
            "from_id": "concept:chemical-reaction",
            "to_id": "concept:chemical-reaction:oxidation",
            "edge_type": "contains",
            "edge_layer": "backbone",
            "backbone_expand": False,
            "directionality": "directed",
            "confidence": 0.9,
            "source_refs_json": json.dumps(
                ["evidence:chem:4-6-2:p160-oxidation-reduction"], ensure_ascii=False
            ),
            "status": "active",
            "created_at": now,
        },
        # 还原反应 is_a 反应类型
        {
            "id": "edge:reaction-classification--contains--reduction",
            "from_id": "concept:chemical-reaction",
            "to_id": "concept:chemical-reaction:reduction",
            "edge_type": "contains",
            "edge_layer": "backbone",
            "backbone_expand": False,
            "directionality": "directed",
            "confidence": 0.9,
            "source_refs_json": json.dumps(
                ["evidence:chem:4-6-2:p160-oxidation-reduction"], ensure_ascii=False
            ),
            "status": "active",
            "created_at": now,
        },
        # 化学方程式的书写 uses 化学方程式
        {
            "id": "edge:equation-writing--uses--chemical-equation",
            "from_id": "skill:equation-writing",
            "to_id": "representation:chemical-equation",
            "edge_type": "uses",
            "edge_layer": "backbone",
            "backbone_expand": True,
            "directionality": "directed",
            "confidence": 0.9,
            "source_refs_json": json.dumps(
                ["evidence:chem:4-6-2:p158-equation-writing"], ensure_ascii=False
            ),
            "status": "active",
            "created_at": now,
        },
        # 化学方程式的意义 explains 化学方程式
        {
            "id": "edge:equation-meaning--explains--chemical-equation",
            "from_id": "concept:chemical-equation:meaning",
            "to_id": "representation:chemical-equation",
            "edge_type": "explains",
            "edge_layer": "backbone",
            "backbone_expand": True,
            "directionality": "directed",
            "confidence": 0.9,
            "source_refs_json": json.dumps(
                ["evidence:chem:4-6-2:p159-equation-info"], ensure_ascii=False
            ),
            "status": "active",
            "created_at": now,
        },
        # 置换反应和氧化还原的关系
        {
            "id": "edge:displacement--related_to--oxidation",
            "from_id": "concept:chemical-reaction:displacement",
            "to_id": "concept:chemical-reaction:oxidation",
            "edge_type": "related_to",
            "edge_layer": "backbone",
            "backbone_expand": False,
            "directionality": "bidirectional",
            "confidence": 0.85,
            "source_refs_json": json.dumps(
                ["evidence:chem:4-6-2:p160-oxidation-reduction"], ensure_ascii=False
            ),
            "status": "active",
            "created_at": now,
        },
    ]

    for edge in edges:
        cursor.execute(
            """INSERT OR REPLACE INTO edges 
               (dataset_id, id, from_id, to_id, edge_type, edge_layer, backbone_expand,
                directionality, confidence, source_refs_json, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                DATASET_ID,
                edge["id"],
                edge["from_id"],
                edge["to_id"],
                edge["edge_type"],
                edge["edge_layer"],
                1 if edge["backbone_expand"] else 0,
                edge["directionality"],
                edge["confidence"],
                edge["source_refs_json"],
                edge["status"],
                edge["created_at"],
            ),
        )
    print(f"✓ Created {len(edges)} edges")

    # ============================================================
    # PHASE 6: Create Node Cards (Summary Only)
    # ============================================================

    node_cards = [
        {
            "node_id": "concept:chemical-reaction:displacement",
            "id": "node-card:concept:chemical-reaction:displacement",
            "card_layer": "backbone",
            "title": "置换反应",
            "summary": "置换反应是一种基本的化学反应类型，指一种单质与一种化合物反应，生成另一种单质和另一种化合物。例如氧化铜与木炭在高温下反应生成铜和二氧化碳。置换反应通常涉及元素化合价的变化，与氧化还原反应密切相关。",
            "sections_json": json.dumps(
                [
                    {
                        "id": "definition",
                        "title": "定义",
                        "content": "一种单质与一种化合物反应，生成另一种单质和另一种化合物的化学反应。",
                        "source_refs": [
                            "evidence:chem:4-6-2:p160-displacement-reaction"
                        ],
                    },
                    {
                        "id": "essence",
                        "title": "核心本质",
                        "content": "反应过程中，单质中的原子取代了化合物中的某种原子或原子团。通常伴随元素化合价的变化。",
                        "source_refs": [],
                    },
                    {
                        "id": "key_points",
                        "title": "关键要点",
                        "content": "1. 反应通式：A + BC → AC + B\n2. 反应物必须包含一种单质和一种化合物\n3. 生成物也是一种单质和一种化合物\n4. 通常涉及电子转移",
                        "source_refs": [],
                    },
                    {
                        "id": "example",
                        "title": "例子",
                        "content": "氧化铜与木炭在高温条件下反应：C + 2CuO → 2Cu + CO₂↑",
                        "source_refs": [
                            "evidence:chem:4-6-2:p160-displacement-reaction"
                        ],
                    },
                    {
                        "id": "application",
                        "title": "应用",
                        "content": "金属冶炼、湿法冶金等领域广泛应用置换反应。",
                        "source_refs": [],
                    },
                ],
                ensure_ascii=False,
            ),
            "status": "active",
            "updated_at": now,
        },
        {
            "node_id": "concept:chemical-reaction:double-displacement",
            "id": "node-card:concept:chemical-reaction:double-displacement",
            "card_layer": "backbone",
            "title": "复分解反应",
            "summary": "复分解反应是两种化合物相互交换成分生成另外两种化合物的化学反应。这类反应是离子反应的重要类型，在酸碱盐的反应中普遍存在。复分解反应的特征是各元素的化合价在反应前后不发生变化。",
            "sections_json": json.dumps(
                [
                    {
                        "id": "definition",
                        "title": "定义",
                        "content": "两种化合物相互交换成分，生成另外两种化合物的化学反应。",
                        "source_refs": ["evidence:chem:4-6-2:p160-double-replacement"],
                    },
                    {
                        "id": "essence",
                        "title": "核心本质",
                        "content": "反应过程中，两种化合物交换各自的阳离子或阴离子，生成两种新化合物。各元素的化合价在反应前后保持不变。",
                        "source_refs": [],
                    },
                    {
                        "id": "key_points",
                        "title": "关键要点",
                        "content": "1. 反应通式：AB + CD → AD + CB\n2. 反应物必须是两种化合物\n3. 生成物也是两种化合物\n4. 元素化合价不变\n5. 通常需要满足特定条件才能发生",
                        "source_refs": [],
                    },
                    {
                        "id": "example",
                        "title": "例子",
                        "content": "碳酸钙与盐酸反应：CaCO₃ + 2HCl → CaCl₂ + H₂CO₃（碳酸分解成H₂O和CO₂）",
                        "source_refs": ["evidence:chem:4-6-2:p160-double-replacement"],
                    },
                    {
                        "id": "application",
                        "title": "应用",
                        "content": "实验室制取二氧化碳、硬水软化、污水处理等。",
                        "source_refs": [],
                    },
                ],
                ensure_ascii=False,
            ),
            "status": "active",
            "updated_at": now,
        },
        {
            "node_id": "skill:equation-writing",
            "id": "node-card:skill:equation-writing",
            "card_layer": "backbone",
            "title": "化学方程式的书写",
            "summary": "书写化学方程式是化学学习的基本技能，遵循'写、配、标'三步骤。首先需要根据反应事实写出反应物和生成物的化学式，然后通过配平使两边原子种类和数目相等，最后标注反应条件和生成物状态。化学方程式是化学语言的核心，能够准确表达化学反应的质和量两方面信息。",
            "sections_json": json.dumps(
                [
                    {
                        "id": "definition",
                        "title": "定义",
                        "content": "根据化学反应事实，按照规范步骤书写化学方程式的技能。",
                        "source_refs": ["evidence:chem:4-6-2:p158-equation-writing"],
                    },
                    {
                        "id": "essence",
                        "title": "核心本质",
                        "content": "化学方程式是用化学式表示化学反应的式子，必须遵守客观事实和质量守恒定律。",
                        "source_refs": [],
                    },
                    {
                        "id": "key_points",
                        "title": "关键要点",
                        "content": "1. 写：写出反应物和生成物的化学式\n2. 配：配平，使两边原子数目相等\n3. 标：标注反应条件（如△、点燃）和生成物状态（↑表示气体，↓表示沉淀）",
                        "source_refs": ["evidence:chem:4-6-2:p158-equation-writing"],
                    },
                    {
                        "id": "example",
                        "title": "例子",
                        "content": "加热氯酸钾制氧气：2KClO₃ →(MnO₂/△) 2KCl + 3O₂↑",
                        "source_refs": ["evidence:chem:4-6-2:p158-equation-writing"],
                    },
                    {
                        "id": "application",
                        "title": "应用",
                        "content": "记录化学反应、进行定量计算、预测反应产物。",
                        "source_refs": [],
                    },
                    {
                        "id": "misconception",
                        "title": "常见误解",
                        "content": "1. 化学计量数可以随意更改（应为最简整数比）\n2. 配平时可以改变化学式中的下标（不可改动，只能加计量数）",
                        "source_refs": [],
                    },
                ],
                ensure_ascii=False,
            ),
            "status": "active",
            "updated_at": now,
        },
        {
            "node_id": "concept:chemical-equation:meaning",
            "id": "node-card:concept:chemical-equation:meaning",
            "card_layer": "backbone",
            "title": "化学方程式的意义",
            "summary": "化学方程式蕴含丰富的化学信息，从质和量两方面反映化学反应。质的方面包括反应物、生成物和反应条件；量的方面包括微观粒子数目比和质量关系。通过化学方程式可以进行反应物用量或产物产量的计算，实现物质之间的定量转化。",
            "sections_json": json.dumps(
                [
                    {
                        "id": "definition",
                        "title": "定义",
                        "content": "化学方程式所蕴含的质和量两方面的化学信息。",
                        "source_refs": ["evidence:chem:4-6-2:p159-equation-info"],
                    },
                    {
                        "id": "essence",
                        "title": "核心本质",
                        "content": "化学方程式既是化学反应的定性描述，也是定量关系的数学表达。",
                        "source_refs": [],
                    },
                    {
                        "id": "key_points",
                        "title": "关键要点",
                        "content": "1. 质的意义：反应物、生成物、反应条件\n2. 量的意义：原子/分子数目比、物质质量比\n3. 可进行定量计算",
                        "source_refs": ["evidence:chem:4-6-2:p159-equation-info"],
                    },
                    {
                        "id": "example",
                        "title": "例子",
                        "content": "2H₂ + O₂ →(点燃) 2H₂O表示：每2个氢分子与1个氧分子反应生成2个水分子；质量比为4:32:36。",
                        "source_refs": ["evidence:chem:4-6-2:p159-equation-info"],
                    },
                    {
                        "id": "application",
                        "title": "应用",
                        "content": "计算原料用量、预测产品产量、控制反应条件以达到节约成本、减少污染的目的。",
                        "source_refs": ["evidence:chem:4-6-2:p159-equation-info"],
                    },
                ],
                ensure_ascii=False,
            ),
            "status": "active",
            "updated_at": now,
        },
        {
            "node_id": "concept:chemical-reaction:oxidation",
            "id": "node-card:concept:chemical-reaction:oxidation",
            "card_layer": "backbone",
            "title": "氧化反应",
            "summary": "氧化反应是物质与氧结合或失去电子的化学反应。从初中化学角度，主要指物质得到氧的反应，如氢气与氧化铜反应生成水时，氢气得到氧形成水。氧化反应与还原反应总是同时发生，构成氧化还原反应。",
            "sections_json": json.dumps(
                [
                    {
                        "id": "definition",
                        "title": "定义",
                        "content": "物质与氧发生的化学反应，或含氧化合物失去氧的反应物发生的反应。从电子转移角度是失去电子的反应。",
                        "source_refs": ["evidence:chem:4-6-2:p160-oxidation-reduction"],
                    },
                    {
                        "id": "essence",
                        "title": "核心本质",
                        "content": "物质与氧结合或失去电子的过程，伴随元素化合价的升高。",
                        "source_refs": [],
                    },
                    {
                        "id": "key_points",
                        "title": "关键要点",
                        "content": "1. 初中定义：物质得到氧的反应\n2. 特征：元素化合价升高\n3. 与还原反应同时发生\n4. 广泛存在于燃烧、呼吸等过程",
                        "source_refs": [],
                    },
                    {
                        "id": "example",
                        "title": "例子",
                        "content": "氢气与氧化铜反应中，H₂ + CuO → Cu + H₂O，氢气得到氧变成水，属于氧化反应。",
                        "source_refs": ["evidence:chem:4-6-2:p160-oxidation-reduction"],
                    },
                    {
                        "id": "application",
                        "title": "应用",
                        "content": "燃烧、金属锈蚀、生物呼吸等过程都涉及氧化反应。",
                        "source_refs": [],
                    },
                ],
                ensure_ascii=False,
            ),
            "status": "active",
            "updated_at": now,
        },
        {
            "node_id": "concept:chemical-reaction:reduction",
            "id": "node-card:concept:chemical-reaction:reduction",
            "card_layer": "backbone",
            "title": "还原反应",
            "summary": "还原反应是含氧化合物失去氧或得到电子的化学反应。从微观角度看，是元素化合价降低的过程。在氢气还原氧化铜的反应中，氧化铜失去氧变成单质铜，这就是典型的还原反应。还原反应与氧化反应相伴发生。",
            "sections_json": json.dumps(
                [
                    {
                        "id": "definition",
                        "title": "定义",
                        "content": "含氧化合物里的氧被夺去的反应。从电子转移角度是物质得到电子的反应。",
                        "source_refs": ["evidence:chem:4-6-2:p160-oxidation-reduction"],
                    },
                    {
                        "id": "essence",
                        "title": "核心本质",
                        "content": "物质失去氧或得到电子的过程，伴随元素化合价的降低。",
                        "source_refs": [],
                    },
                    {
                        "id": "key_points",
                        "title": "关键要点",
                        "content": "1. 初中定义：含氧化合物失去氧的反应\n2. 特征：元素化合价降低\n3. 与氧化反应同时发生\n4. 在金属冶炼中有重要应用",
                        "source_refs": [],
                    },
                    {
                        "id": "example",
                        "title": "例子",
                        "content": "氢气与氧化铜反应中，氧化铜失去氧变成单质铜，属于还原反应。",
                        "source_refs": ["evidence:chem:4-6-2:p160-oxidation-reduction"],
                    },
                    {
                        "id": "application",
                        "title": "应用",
                        "content": "金属冶炼、化工生产等领域广泛应用还原反应。",
                        "source_refs": [],
                    },
                ],
                ensure_ascii=False,
            ),
            "status": "active",
            "updated_at": now,
        },
    ]

    for card in node_cards:
        cursor.execute(
            """INSERT OR REPLACE INTO node_cards 
               (dataset_id, node_id, id, card_layer, title, summary, sections_json, 
                status, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                DATASET_ID,
                card["node_id"],
                card["id"],
                card["card_layer"],
                card["title"],
                card["summary"],
                card["sections_json"],
                card["status"],
                card["updated_at"],
            ),
        )
    print(f"✓ Created {len(node_cards)} node cards")

    # Commit all changes
    conn.commit()
    conn.close()

    print("\n" + "=" * 60)
    print(f"✅ Extraction complete for {BATCH_ANCHOR}")
    print(f"   New backbone nodes: {', '.join(new_backbone_nodes)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
