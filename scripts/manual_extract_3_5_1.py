#!/usr/bin/env python3
"""Manual extraction for lesson 3-5-1 构成物质的微观粒子"""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = REPO_ROOT / "storage" / "knowledge.sqlite"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    dataset_id = "v4"
    lesson_anchor = "struct:chem-grade8-huku54-shanghai:lesson:3-5-1"
    book_id = "chem-grade8-huku54-shanghai"
    now = utc_now()

    # ============================================
    # NEW BACKBONE NODES
    # ============================================

    new_nodes = [
        {
            "id": "concept:atom",
            "canonical_name": "原子",
            "node_kind": "concept",
            "node_layer": "backbone",
            "aliases": ["atom", "原子概念", "化学变化中的最小粒子"],
            "definition": "原子是化学变化中的最小微观粒子。在化学变化中，分子发生变化，而原子本身不发生变化，可以重新组合成新的分子。",
            "learning_modes": ["conceptual", "factual"],
            "bridge_tags": ["structure", "microscopic", "matter", "chemical-change"],
            "framework_refs": ["framework:chem:topic:3-5"],
            "card_ref": "node-card:concept:atom",
        },
        {
            "id": "concept:atomic-structure",
            "canonical_name": "原子结构",
            "node_kind": "concept",
            "node_layer": "backbone",
            "aliases": ["atomic structure", "原子构成"],
            "definition": "原子由原子核和核外电子构成。原子核位于原子中心，由质子和中子构成。核外电子在原子核外广阔空间内做高速运动。",
            "learning_modes": ["conceptual", "factual"],
            "bridge_tags": ["structure", "microscopic", "model"],
            "framework_refs": ["framework:chem:topic:3-5"],
            "card_ref": "node-card:concept:atomic-structure",
        },
        {
            "id": "concept:atomic-nucleus",
            "canonical_name": "原子核",
            "node_kind": "concept",
            "node_layer": "backbone",
            "aliases": ["atomic nucleus", "核"],
            "definition": "原子核位于原子中心，由质子和中子构成，带有正电荷。原子核所带的正电荷数（即核电荷数）等于质子数。",
            "learning_modes": ["conceptual", "factual"],
            "bridge_tags": ["structure", "microscopic"],
            "framework_refs": ["framework:chem:topic:3-5"],
            "card_ref": "node-card:concept:atomic-nucleus",
        },
        {
            "id": "concept:proton",
            "canonical_name": "质子",
            "node_kind": "concept",
            "node_layer": "backbone",
            "aliases": ["proton"],
            "definition": "质子是构成原子核的基本粒子之一，带有1个单位的正电荷。原子核中质子的数目决定了元素的种类。",
            "learning_modes": ["factual"],
            "bridge_tags": ["structure", "microscopic", "particle"],
            "framework_refs": ["framework:chem:topic:3-5"],
            "card_ref": "node-card:concept:proton",
        },
        {
            "id": "concept:neutron",
            "canonical_name": "中子",
            "node_kind": "concept",
            "node_layer": "backbone",
            "aliases": ["neutron"],
            "definition": "中子是构成原子核的基本粒子之一，不带电（电中性）。中子数影响原子的质量，但不影响元素的化学性质。",
            "learning_modes": ["factual"],
            "bridge_tags": ["structure", "microscopic", "particle"],
            "framework_refs": ["framework:chem:topic:3-5"],
            "card_ref": "node-card:concept:neutron",
        },
        {
            "id": "concept:electron",
            "canonical_name": "电子",
            "node_kind": "concept",
            "node_layer": "backbone",
            "aliases": ["electron", "核外电子"],
            "definition": "电子是带1个单位负电荷的微观粒子，在原子核外广阔的空间内围绕原子核做高速运动。电子数与质子数相等时，原子呈电中性。",
            "learning_modes": ["conceptual", "factual"],
            "bridge_tags": ["structure", "microscopic", "particle"],
            "framework_refs": ["framework:chem:topic:3-5"],
            "card_ref": "node-card:concept:electron",
        },
        {
            "id": "concept:ion",
            "canonical_name": "离子",
            "node_kind": "concept",
            "node_layer": "backbone",
            "aliases": ["ion", "带电原子", "正离子", "负离子", "阳离子", "阴离子"],
            "definition": "离子是带电的原子或原子团。带正电荷的叫做正离子（如钠离子），带负电荷的叫做负离子（如氯离子）。离子是构成物质的一种微观粒子。",
            "learning_modes": ["conceptual", "factual"],
            "bridge_tags": ["structure", "microscopic", "matter"],
            "framework_refs": ["framework:chem:topic:3-5"],
            "card_ref": "node-card:concept:ion",
        },
        {
            "id": "concept:electron-shell",
            "canonical_name": "电子层",
            "node_kind": "concept",
            "node_layer": "backbone",
            "aliases": ["electron shell", "核外电子排布", "电子分层排布"],
            "definition": "电子在离核远近不同的区域运动，简化为电子的分层排布。离核最近的称为第一层，由近及远依次为第二、三、四、五、六、七层。最外层电子数不超过8个（只有一层的不超过2个）。",
            "learning_modes": ["conceptual", "factual"],
            "bridge_tags": ["structure", "microscopic", "model"],
            "framework_refs": ["framework:chem:topic:3-5"],
            "card_ref": "node-card:concept:electron-shell",
        },
        {
            "id": "concept:relative-atomic-mass",
            "canonical_name": "相对原子质量",
            "node_kind": "concept",
            "node_layer": "backbone",
            "aliases": ["relative atomic mass", "原子量", "Ar"],
            "definition": "以一个碳原子（碳-12）质量的1/12作为标准，任何原子的实际质量与这个标准之间的比值，称为该原子的相对原子质量。相对原子质量≈质子数+中子数。",
            "learning_modes": ["conceptual", "procedural"],
            "bridge_tags": ["quantitative", "calculation", "measurement"],
            "framework_refs": ["framework:chem:topic:3-5"],
            "card_ref": "node-card:concept:relative-atomic-mass",
        },
        {
            "id": "concept:nuclear-charge",
            "canonical_name": "核电荷数",
            "node_kind": "concept",
            "node_layer": "backbone",
            "aliases": ["nuclear charge number"],
            "definition": "原子核所带的正电荷数叫做核电荷数。在原子中，核电荷数=质子数=核外电子数。核电荷数决定了元素的种类。",
            "learning_modes": ["factual", "conceptual"],
            "bridge_tags": ["structure", "quantitative"],
            "framework_refs": ["framework:chem:topic:3-5"],
            "card_ref": "node-card:concept:nuclear-charge",
        },
    ]

    # Insert nodes
    for node in new_nodes:
        cursor.execute(
            """
            INSERT OR REPLACE INTO nodes 
            (dataset_id, id, canonical_name, node_kind, node_layer, aliases_json, definition,
             learning_modes_json, bridge_tags_json, framework_refs_json, card_ref, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                dataset_id,
                node["id"],
                node["canonical_name"],
                node["node_kind"],
                node["node_layer"],
                json.dumps(node["aliases"], ensure_ascii=False),
                node["definition"],
                json.dumps(node["learning_modes"], ensure_ascii=False),
                json.dumps(node["bridge_tags"], ensure_ascii=False),
                json.dumps(node["framework_refs"], ensure_ascii=False),
                node["card_ref"],
                "active",
                now,
                now,
            ),
        )

    print(f"✓ Inserted {len(new_nodes)} new backbone nodes")

    # ============================================
    # EVIDENCE RECORDS
    # ============================================

    evidence_records = [
        {
            "id": "evidence:3-5-1:p115-learning-focus",
            "excerpt": "结合生活实例，认识物质是由分子、原子等微观粒子构成的，形成认识物质变化的视角。通过科学史实，认识原子的结构，体会科学家探索原子结构的智慧。",
            "page_start": 115,
            "page_end": 115,
            "modality": "text",
        },
        {
            "id": "evidence:3-5-1:p115-atom-definition",
            "excerpt": "随着科学技术的发展，科学家在大量实验的基础上逐步认识到物质是由分子、原子等微观粒子构成的。原子不仅可以结合成分子，也能直接构成物质。",
            "page_start": 115,
            "page_end": 115,
            "modality": "text",
        },
        {
            "id": "evidence:3-5-1:p115-atom-chemical-change",
            "excerpt": "由分子构成的物质在发生物理变化时，分子本身不发生变化，它的化学性质保持不变。因此，分子是保持物质化学性质的一种微观粒子。在化学变化中，分子发生变化，而原子本身不发生变化，可以重新组合成新的分子，进而构成新的物质。可见，原子是化学变化中的最小微观粒子。",
            "page_start": 115,
            "page_end": 115,
            "modality": "text",
        },
        {
            "id": "evidence:3-5-1:p116-atomic-structure-model",
            "excerpt": "现代原子结构模型认为，原子是由原子核和核外电子构成的。原子核位于原子中心，由质子和中子构成。",
            "locator": "第116页，现代原子结构模型",
            "page_start": 116,
            "page_end": 116,
            "modality": "text",
        },
        {
            "id": "evidence:3-5-1:p116-particle-electrical-properties",
            "excerpt": "表5.1 构成原子的几种粒子的电性：质子带1个单位正电荷，中子不带电，电子带1个单位负电荷。",
            "locator": "第116页，表5.1",
            "page_start": 116,
            "page_end": 116,
            "modality": "table",
        },
        {
            "id": "evidence:3-5-1:p116-nuclear-charge",
            "excerpt": "原子核所带的正电荷数（即核电荷数）等于质子数。不同种类的原子，其原子核内含有不同数目的质子和中子，核外电子数也不同。",
            "page_start": 116,
            "page_end": 116,
            "modality": "text",
        },
        {
            "id": "evidence:3-5-1:p117-electron-shell",
            "excerpt": "我们通常把电子在离核远近不同的区域运动简化为电子的分层排布。离核最近的电子层称为第一层，其余由近及远依次类推，分别为第二、三、四、五、六、七电子层，离核最远的常称为最外层。",
            "page_start": 117,
            "page_end": 117,
            "modality": "text",
        },
        {
            "id": "evidence:3-5-1:p117-ion-formation",
            "excerpt": "在化学变化中，锂、钠等原子容易失去最外层电子，而氟、氯等原子则容易得到电子，从而趋向于达到稳定结构。钠原子会失去1个电子而带上1个单位的正电荷，氯原子会得到1个电子而带上1个单位的负电荷。这种带电的原子或原子团叫做离子。",
            "page_start": 117,
            "page_end": 117,
            "modality": "text",
        },
        {
            "id": "evidence:3-5-1:p118-relative-atomic-mass",
            "excerpt": "原子的实际质量非常小，不同的原子质量虽有差别，但其质量的数量级约在10^-27~10^-25 kg之间。我们以一个碳原子质量的1/12作为标准，任何原子的实际质量与这个标准之间的比值，称为该原子的相对原子质量。",
            "page_start": 118,
            "page_end": 118,
            "modality": "text",
        },
        {
            "id": "evidence:3-5-1:p119-relative-molecular-mass",
            "excerpt": "分子是由原子结合而成的，分子的质量也很小，为了使用方便，人们通常用相对分子质量来表示分子质量的相对大小。相对分子质量等于构成分子的各个原子的相对原子质量的总和。",
            "page_start": 119,
            "page_end": 119,
            "modality": "text",
        },
    ]

    for ev in evidence_records:
        cursor.execute(
            """
            INSERT OR REPLACE INTO evidence 
            (dataset_id, id, source_type, source_id, anchor_ref, excerpt, locator, page_start, page_end, modality, extraction_method)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                dataset_id,
                ev["id"],
                "textbook",
                book_id,
                lesson_anchor,
                ev.get("excerpt", ""),
                ev.get("locator", ""),
                ev.get("page_start"),
                ev.get("page_end"),
                ev["modality"],
                "manual",
            ),
        )

    print(f"✓ Inserted {len(evidence_records)} evidence records")

    # ============================================
    # MENTIONS
    # ============================================

    mentions = [
        # Atom mentions
        {
            "id": "mention:3-5-1:atom-intro",
            "target_id": "concept:atom",
            "role": "introduces",
            "excerpt_id": "evidence:3-5-1:p115-atom-definition",
            "confidence": 1.0,
        },
        {
            "id": "mention:3-5-1:atom-focus",
            "target_id": "concept:atom",
            "role": "focuses_on",
            "excerpt_id": "evidence:3-5-1:p115-atom-chemical-change",
            "confidence": 1.0,
        },
        {
            "id": "mention:3-5-1:atomic-structure-intro",
            "target_id": "concept:atomic-structure",
            "role": "defines",
            "excerpt_id": "evidence:3-5-1:p116-atomic-structure-model",
            "confidence": 1.0,
        },
        {
            "id": "mention:3-5-1:atomic-nucleus-intro",
            "target_id": "concept:atomic-nucleus",
            "role": "defines",
            "excerpt_id": "evidence:3-5-1:p116-atomic-structure-model",
            "confidence": 1.0,
        },
        {
            "id": "mention:3-5-1:proton-table",
            "target_id": "concept:proton",
            "role": "defines",
            "excerpt_id": "evidence:3-5-1:p116-particle-electrical-properties",
            "confidence": 1.0,
        },
        {
            "id": "mention:3-5-1:neutron-table",
            "target_id": "concept:neutron",
            "role": "defines",
            "excerpt_id": "evidence:3-5-1:p116-particle-electrical-properties",
            "confidence": 1.0,
        },
        {
            "id": "mention:3-5-1:electron-table",
            "target_id": "concept:electron",
            "role": "defines",
            "excerpt_id": "evidence:3-5-1:p116-particle-electrical-properties",
            "confidence": 1.0,
        },
        {
            "id": "mention:3-5-1:ion-intro",
            "target_id": "concept:ion",
            "role": "defines",
            "excerpt_id": "evidence:3-5-1:p117-ion-formation",
            "confidence": 1.0,
        },
        {
            "id": "mention:3-5-1:electron-shell-intro",
            "target_id": "concept:electron-shell",
            "role": "defines",
            "excerpt_id": "evidence:3-5-1:p117-electron-shell",
            "confidence": 1.0,
        },
        {
            "id": "mention:3-5-1:nuclear-charge-intro",
            "target_id": "concept:nuclear-charge",
            "role": "defines",
            "excerpt_id": "evidence:3-5-1:p116-nuclear-charge",
            "confidence": 1.0,
        },
        {
            "id": "mention:3-5-1:relative-atomic-mass-intro",
            "target_id": "concept:relative-atomic-mass",
            "role": "defines",
            "excerpt_id": "evidence:3-5-1:p118-relative-atomic-mass",
            "confidence": 1.0,
        },
    ]

    for m in mentions:
        cursor.execute(
            """
            INSERT OR REPLACE INTO mentions 
            (dataset_id, id, source_type, source_id, anchor_ref, target_type, target_id, role, source_refs_json, confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                dataset_id,
                m["id"],
                "textbook",
                book_id,
                lesson_anchor,
                "node",
                m["target_id"],
                m["role"],
                json.dumps([m["excerpt_id"]], ensure_ascii=False),
                m["confidence"],
            ),
        )

    print(f"✓ Inserted {len(mentions)} mentions")

    # ============================================
    # CURRICULUM PROFILES
    # ============================================

    profiles = [
        {
            "id": "profile:chem:junior:grade8:concept:atom",
            "node_id": "concept:atom",
            "context_key": "chem:junior:grade8",
            "curriculum_role": "introduced",
            "mastery_level": "understand",
            "learning_objectives": [
                "认识原子是化学变化中的最小微观粒子",
                "理解原子在化学变化中可以重新组合成新分子",
                "能区分分子和原子的本质区别",
            ],
        },
        {
            "id": "profile:chem:junior:grade8:concept:atomic-structure",
            "node_id": "concept:atomic-structure",
            "context_key": "chem:junior:grade8",
            "curriculum_role": "introduced",
            "mastery_level": "understand",
            "learning_objectives": [
                "认识原子的基本结构：原子核和核外电子",
                "了解原子核由质子和中子构成",
                "能阅读简单的原子结构示意图",
            ],
        },
        {
            "id": "profile:chem:junior:grade8:concept:atomic-nucleus",
            "node_id": "concept:atomic-nucleus",
            "context_key": "chem:junior:grade8",
            "curriculum_role": "introduced",
            "mastery_level": "know",
            "learning_objectives": ["认识原子核位于原子中心", "理解原子核带正电荷"],
        },
        {
            "id": "profile:chem:junior:grade8:concept:proton",
            "node_id": "concept:proton",
            "context_key": "chem:junior:grade8",
            "curriculum_role": "introduced",
            "mastery_level": "know",
            "learning_objectives": ["知道质子带正电荷", "理解质子数目决定原子种类"],
        },
        {
            "id": "profile:chem:junior:grade8:concept:neutron",
            "node_id": "concept:neutron",
            "context_key": "chem:junior:grade8",
            "curriculum_role": "introduced",
            "mastery_level": "know",
            "learning_objectives": ["知道中子不带电（电中性）"],
        },
        {
            "id": "profile:chem:junior:grade8:concept:electron",
            "node_id": "concept:electron",
            "context_key": "chem:junior:grade8",
            "curriculum_role": "introduced",
            "mastery_level": "understand",
            "learning_objectives": [
                "知道电子带负电荷",
                "理解电子在核外空间中运动",
                "理解电子数=质子数时原子呈电中性",
            ],
        },
        {
            "id": "profile:chem:junior:grade8:concept:ion",
            "node_id": "concept:ion",
            "context_key": "chem:junior:grade8",
            "curriculum_role": "introduced",
            "mastery_level": "understand",
            "learning_objectives": [
                "认识离子是带电的原子或原子团",
                "能区分正离子和负离子",
                "理解离子形成的原因是电子得失",
            ],
        },
        {
            "id": "profile:chem:junior:grade8:concept:electron-shell",
            "node_id": "concept:electron-shell",
            "context_key": "chem:junior:grade8",
            "curriculum_role": "introduced",
            "mastery_level": "understand",
            "learning_objectives": [
                "认识电子的分层排布",
                "理解最外层电子数不超过8个的规律",
                "能识别稳定结构（如最外层8电子）",
            ],
        },
        {
            "id": "profile:chem:junior:grade8:concept:nuclear-charge",
            "node_id": "concept:nuclear-charge",
            "context_key": "chem:junior:grade8",
            "curriculum_role": "introduced",
            "mastery_level": "apply",
            "learning_objectives": [
                "理解核电荷数=质子数=核外电子数的关系",
                "能利用该关系进行简单计算",
            ],
        },
        {
            "id": "profile:chem:junior:grade8:concept:relative-atomic-mass",
            "node_id": "concept:relative-atomic-mass",
            "context_key": "chem:junior:grade8",
            "curriculum_role": "introduced",
            "mastery_level": "apply",
            "learning_objectives": [
                "理解相对原子质量的含义",
                "会使用相对原子质量表进行计算",
                "能计算相对分子质量",
            ],
        },
    ]

    for p in profiles:
        cursor.execute(
            """
            INSERT OR REPLACE INTO profiles 
            (dataset_id, id, node_id, subject, school_stage, grade_band, context_key, curriculum_role, mastery_level, learning_objectives_json, textbook_refs_json, framework_refs_json, source_refs_json, status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                dataset_id,
                p["id"],
                p["node_id"],
                "chemistry",
                "junior_high",
                "grade_8",
                p["context_key"],
                p["curriculum_role"],
                p["mastery_level"],
                json.dumps(p["learning_objectives"], ensure_ascii=False),
                json.dumps([lesson_anchor], ensure_ascii=False),
                json.dumps(["framework:chem:topic:3-5"], ensure_ascii=False),
                json.dumps([], ensure_ascii=False),
                "active",
                now,
            ),
        )

    print(f"✓ Inserted {len(profiles)} curriculum profiles")

    # ============================================
    # EDGES ( Relationships )
    # ============================================

    edges = [
        # Contains edges
        {
            "id": "edge:atom-contains-atomic-nucleus",
            "from_id": "concept:atom",
            "to_id": "concept:atomic-nucleus",
            "edge_type": "contains",
            "edge_layer": "backbone",
        },
        {
            "id": "edge:atom-contains-electron",
            "from_id": "concept:atom",
            "to_id": "concept:electron",
            "edge_type": "contains",
            "edge_layer": "backbone",
        },
        {
            "id": "edge:atomic-nucleus-contains-proton",
            "from_id": "concept:atomic-nucleus",
            "to_id": "concept:proton",
            "edge_type": "contains",
            "edge_layer": "backbone",
        },
        {
            "id": "edge:atomic-nucleus-contains-neutron",
            "from_id": "concept:atomic-nucleus",
            "to_id": "concept:neutron",
            "edge_type": "contains",
            "edge_layer": "backbone",
        },
        {
            "id": "edge:atom-has-electron-shell",
            "from_id": "concept:atom",
            "to_id": "concept:electron-shell",
            "edge_type": "contains",
            "edge_layer": "backbone",
        },
        # Explains
        {
            "id": "edge:atomic-structure-explains-atom",
            "from_id": "concept:atomic-structure",
            "to_id": "concept:atom",
            "edge_type": "explains",
            "edge_layer": "backbone",
        },
        {
            "id": "edge:nuclear-charge-characterizes-atom",
            "from_id": "concept:nuclear-charge",
            "to_id": "concept:atom",
            "edge_type": "characterizes",
            "edge_layer": "support",
        },
        # Produces/affects
        {
            "id": "edge:atom-forms-ion",
            "from_id": "concept:atom",
            "to_id": "concept:ion",
            "edge_type": "produces",
            "edge_layer": "backbone",
        },
        {
            "id": "edge:electron-affects-ion",
            "from_id": "concept:electron",
            "to_id": "concept:ion",
            "edge_type": "affects",
            "edge_layer": "support",
        },
        {
            "id": "edge:electron-shell-affects-ion",
            "from_id": "concept:electron-shell",
            "to_id": "concept:ion",
            "edge_type": "affects",
            "edge_layer": "support",
        },
        # Measurement
        {
            "id": "edge:proton-determines-nuclear-charge",
            "from_id": "concept:proton",
            "to_id": "concept:nuclear-charge",
            "edge_type": "determines",
            "edge_layer": "support",
        },
        {
            "id": "edge:proton-neutron-affects-atomic-mass",
            "from_id": "concept:proton",
            "to_id": "concept:relative-atomic-mass",
            "edge_type": "affects",
            "edge_layer": "support",
        },
        {
            "id": "edge:neutron-affects-atomic-mass",
            "from_id": "concept:neutron",
            "to_id": "concept:relative-atomic-mass",
            "edge_type": "affects",
            "edge_layer": "support",
        },
    ]

    # Check which target nodes exist
    cursor.execute("SELECT id FROM nodes WHERE dataset_id=?", (dataset_id,))
    existing_nodes = {row[0] for row in cursor.fetchall()}

    edges_inserted = 0
    for edge in edges:
        if edge["from_id"] in existing_nodes and edge["to_id"] in existing_nodes:
            cursor.execute(
                """
                INSERT OR IGNORE INTO edges 
                (dataset_id, id, from_id, to_id, edge_type, edge_layer, backbone_expand, directionality, confidence, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    dataset_id,
                    edge["id"],
                    edge["from_id"],
                    edge["to_id"],
                    edge["edge_type"],
                    edge["edge_layer"],
                    1 if edge["edge_layer"] == "backbone" else 0,
                    "directed",
                    1.0,
                    "active",
                    now,
                    now,
                ),
            )
            edges_inserted += 1
        else:
            print(
                f"  ⚠️ Skipping edge {edge['id']}: missing source ({edge['from_id']}) or target ({edge['to_id']})"
            )

    print(f"✓ Inserted {edges_inserted} edges")

    conn.commit()
    conn.close()

    print("\n✅ Extraction complete!")
    print(f"   Dataset: {dataset_id}")
    print(f"   Lesson: {lesson_anchor}")
    print(f"   New backbone nodes: {len(new_nodes)}")
    return [n["id"] for n in new_nodes]


if __name__ == "__main__":
    new_nodes = run()
    print(f"\nNew backbone node IDs: {new_nodes}")
