#!/usr/bin/env python3
"""Extract lesson 2-3-2: 氧气和二氧化碳的性质"""

import sqlite3
import json
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = REPO_ROOT / "storage" / "knowledge.sqlite"


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_dataset(conn, dataset_id):
    """Ensure dataset exists."""
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM datasets WHERE dataset_id = ?", (dataset_id,))
    if not cur.fetchone():
        cur.execute(
            """
            INSERT INTO datasets (dataset_id, version_key, root_path, schema_version, status, is_active, created_at, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                dataset_id,
                "v4",
                "data/v4",
                "v2",
                "active",
                0,
                utc_now(),
                "沪科技版五四学制化学八年级",
            ),
        )
        conn.commit()
        print(f"Created dataset: {dataset_id}")


def insert_node(
    conn,
    dataset_id,
    node_id,
    canonical_name,
    node_kind,
    node_layer,
    definition,
    node_subkind=None,
    aliases=None,
    learning_modes=None,
    bridge_tags=None,
    framework_refs=None,
    properties=None,
    card_ref=None,
    notes=None,
):
    """Insert a canonical node."""
    cur = conn.cursor()
    cur.execute(
        """
        INSERT OR REPLACE INTO nodes 
        (dataset_id, id, canonical_name, node_kind, node_layer, node_subkind, definition,
         aliases_json, learning_modes_json, bridge_tags_json, framework_refs_json, 
         card_ref, properties_json, status, created_at, updated_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            dataset_id,
            node_id,
            canonical_name,
            node_kind,
            node_layer,
            node_subkind,
            definition,
            json.dumps(aliases or [], ensure_ascii=False),
            json.dumps(learning_modes or [], ensure_ascii=False),
            json.dumps(bridge_tags or [], ensure_ascii=False),
            json.dumps(framework_refs or [], ensure_ascii=False),
            card_ref,
            json.dumps(properties or {}, ensure_ascii=False),
            "active",
            utc_now(),
            utc_now(),
            notes or "",
        ),
    )
    conn.commit()
    print(f"  ✓ Node: {node_id}")


def insert_profile(
    conn,
    dataset_id,
    profile_id,
    node_id,
    subject,
    school_stage,
    grade_band,
    curriculum_role,
    mastery_level,
    learning_objectives,
    textbook_refs,
    framework_refs=None,
):
    """Insert curriculum profile."""
    cur = conn.cursor()
    cur.execute(
        """
        INSERT OR REPLACE INTO profiles
        (dataset_id, id, node_id, subject, school_stage, grade_band, curriculum_role,
         mastery_level, learning_objectives_json, textbook_refs_json, framework_refs_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            dataset_id,
            profile_id,
            node_id,
            subject,
            school_stage,
            grade_band,
            curriculum_role,
            mastery_level,
            json.dumps(learning_objectives, ensure_ascii=False),
            json.dumps(textbook_refs, ensure_ascii=False),
            json.dumps(framework_refs or [], ensure_ascii=False),
            "active",
            utc_now(),
            utc_now(),
        ),
    )
    conn.commit()
    print(f"  ✓ Profile: {profile_id}")


def insert_evidence(
    conn,
    dataset_id,
    evidence_id,
    source_type,
    source_id,
    anchor_ref,
    excerpt,
    locator,
    page_start,
    page_end,
    modality="text",
):
    """Insert evidence record."""
    cur = conn.cursor()
    cur.execute(
        """
        INSERT OR REPLACE INTO evidence
        (dataset_id, id, source_type, source_id, anchor_ref, excerpt, locator,
         page_start, page_end, modality, extraction_method, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            dataset_id,
            evidence_id,
            source_type,
            source_id,
            anchor_ref,
            excerpt,
            locator,
            page_start,
            page_end,
            modality,
            "markdown",
            utc_now(),
        ),
    )
    conn.commit()
    print(f"  ✓ Evidence: {evidence_id}")


def insert_mention(
    conn,
    dataset_id,
    mention_id,
    anchor_ref,
    target_type,
    target_id,
    role,
    evidence_refs,
    confidence=1.0,
):
    """Insert mention record."""
    cur = conn.cursor()
    cur.execute(
        """
        INSERT OR REPLACE INTO mentions
        (dataset_id, id, anchor_ref, target_type, target_id, role, evidence_refs_json, confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            dataset_id,
            mention_id,
            anchor_ref,
            target_type,
            target_id,
            role,
            json.dumps(evidence_refs, ensure_ascii=False),
            confidence,
            utc_now(),
        ),
    )
    conn.commit()
    print(f"  ✓ Mention: {mention_id}")


def insert_edge(
    conn,
    dataset_id,
    edge_id,
    source,
    target,
    relation,
    edge_layer,
    backbone_expand=False,
    source_refs=None,
    confidence=1.0,
):
    """Insert edge record."""
    cur = conn.cursor()
    cur.execute(
        """
        INSERT OR REPLACE INTO edges
        (dataset_id, id, source, target, relation, edge_layer, backbone_expand, source_refs_json, confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            dataset_id,
            edge_id,
            source,
            target,
            relation,
            edge_layer,
            backbone_expand,
            json.dumps(source_refs or [], ensure_ascii=False),
            confidence,
            utc_now(),
        ),
    )
    conn.commit()
    print(f"  ✓ Edge: {edge_id}")


def insert_node_card(
    conn, dataset_id, card_id, node_id, card_layer, title, summary, sections
):
    """Insert node card record."""
    cur = conn.cursor()
    cur.execute(
        """
        INSERT OR REPLACE INTO node_cards
        (dataset_id, id, node_id, card_layer, title, summary, sections_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            dataset_id,
            card_id,
            node_id,
            card_layer,
            title,
            summary,
            json.dumps(sections, ensure_ascii=False),
            utc_now(),
            utc_now(),
        ),
    )
    conn.commit()
    print(f"  ✓ Node Card: {card_id}")


def main():
    dataset_id = "v4"
    anchor = "struct:chem-grade8-huku54-shanghai:lesson:2-3-2"
    source_id = "chem-grade8-huku54-shanghai"

    print("=" * 60)
    print(f"Extracting Lesson 2-3-2: 氧气和二氧化碳的性质")
    print("=" * 60)

    conn = get_db()
    ensure_dataset(conn, dataset_id)

    # ============== BACKBONE NODES ==============
    print("\n--- Creating Backbone Nodes ---")

    # 1. 氧气 (Oxygen)
    insert_node(
        conn,
        dataset_id,
        "entity/substance:oxygen",
        "氧气",
        "entity",
        "backbone",
        "由氧元素组成的单质，是空气的主要成分之一，化学性质比较活泼",
        node_subkind="substance",
        aliases=["O₂", "氧", "oxygen"],
        learning_modes=["factual", "conceptual"],
        bridge_tags=["matter", "structure", "properties"],
        framework_refs=["framework:chem:topic:2-3"],
        properties={
            "color": "无色",
            "state": "气态",
            "odor": "无味",
            "density": "1.429 g/L (大于空气)",
            "solubility": "不易溶于水",
            "melting_point": "-218°C",
            "boiling_point": "-183°C",
            "liquid_color": "淡蓝色液体",
            "solid_color": "雪花状淡蓝色固体",
        },
        card_ref="node-card:entity/substance:oxygen",
    )

    # 2. 二氧化碳 (Carbon Dioxide)
    insert_node(
        conn,
        dataset_id,
        "entity/substance:carbon-dioxide",
        "二氧化碳",
        "entity",
        "backbone",
        "由碳和氧两种元素组成的化合物，是空气中的重要成分，也是植物光合作用的原料",
        node_subkind="substance",
        aliases=["CO₂", "CO2", "carbon dioxide"],
        learning_modes=["factual", "conceptual"],
        bridge_tags=["matter", "structure", "properties"],
        framework_refs=["framework:chem:topic:2-3"],
        properties={
            "color": "无色",
            "state": "气态",
            "odor": "无味",
            "density": "大于空气",
            "solubility": "能溶于水",
            "solid_form": "干冰",
            "sublimation_temp": "-78.5°C",
        },
        card_ref="node-card:entity/substance:carbon-dioxide",
    )

    # 3. 物理性质 (Physical Properties)
    insert_node(
        conn,
        dataset_id,
        "concept:physical-properties",
        "物理性质",
        "concept",
        "backbone",
        "物质不需要发生化学变化就能表现出来的性质，如颜色、状态、气味、密度、溶解性等",
        node_subkind=None,
        aliases=["physical property", "物理特性"],
        learning_modes=["conceptual", "factual"],
        bridge_tags=["properties", "observation"],
        framework_refs=["framework:chem:topic:2-3"],
        card_ref="node-card:concept:physical-properties",
    )

    # 4. 化学性质 (Chemical Properties)
    insert_node(
        conn,
        dataset_id,
        "concept:chemical-properties",
        "化学性质",
        "concept",
        "backbone",
        "物质在化学变化中表现出来的性质，如可燃性、助燃性、氧化性、稳定性等",
        node_subkind=None,
        aliases=["chemical property", "化学特性"],
        learning_modes=["conceptual"],
        bridge_tags=["properties", "reaction"],
        framework_refs=["framework:chem:topic:2-3"],
        card_ref="node-card:concept:chemical-properties",
    )

    # 5. 助燃性 (Combustion Supporting Property)
    insert_node(
        conn,
        dataset_id,
        "concept:combustion-supporting",
        "助燃性",
        "concept",
        "backbone",
        "物质支持燃烧的性质，指物质能够帮助其他物质燃烧的能力",
        node_subkind=None,
        aliases=["支持燃烧", "combustion supporting property"],
        learning_modes=["conceptual"],
        bridge_tags=["properties", "reaction"],
        framework_refs=["framework:chem:topic:2-3"],
        card_ref="node-card:concept:combustion-supporting",
    )

    # 6. 氧化性/氧化反应 (Oxidation)
    insert_node(
        conn,
        dataset_id,
        "concept:oxidation",
        "氧化性",
        "concept",
        "backbone",
        "物质与氧气发生的化学反应，或物质获得电子的能力。氧气具有氧化性，能使其他物质氧化",
        node_subkind=None,
        aliases=["氧化反应", "oxidation", "oxidizing property"],
        learning_modes=["conceptual"],
        bridge_tags=["reaction", "properties"],
        framework_refs=["framework:chem:topic:2-3"],
        card_ref="node-card:concept:oxidation",
    )

    # 7. 干冰 (Dry Ice)
    insert_node(
        conn,
        dataset_id,
        "entity/substance:dry-ice",
        "干冰",
        "entity",
        "backbone",
        "固态二氧化碳的俗称，在常压下温度高于-78.5°C时会升华，直接变成气态二氧化碳",
        node_subkind="substance",
        aliases=["dry ice", "固体二氧化碳", "solid carbon dioxide"],
        learning_modes=["factual"],
        bridge_tags=["matter", "properties", "application"],
        framework_refs=["framework:chem:topic:2-3"],
        properties={
            "state": "固态",
            "component": "二氧化碳",
            "sublimation_point": "-78.5°C",
            "characteristic": "升华吸热，无残留物",
        },
        card_ref="node-card:entity/substance:dry-ice",
    )

    # 8. 碳酸 (Carbonic Acid)
    insert_node(
        conn,
        dataset_id,
        "entity/substance:carbonic-acid",
        "碳酸",
        "entity",
        "backbone",
        "二氧化碳溶于水时与水反应生成的不稳定酸，能使紫色石蕊试液变红",
        node_subkind="substance",
        aliases=["carbonic acid", "H₂CO₃"],
        learning_modes=["conceptual"],
        bridge_tags=["matter", "reaction"],
        framework_refs=["framework:chem:topic:2-3"],
        properties={
            "formula": "H₂CO₃",
            "stability": "不稳定",
            "decomposition": "受热分解为CO₂和H₂O",
            "indicator": "使紫色石蕊试液变红",
        },
        card_ref="node-card:entity/substance:carbonic-acid",
    )

    # 9. 氧循环 (Oxygen Cycle)
    insert_node(
        conn,
        dataset_id,
        "concept:oxygen-cycle",
        "氧循环",
        "concept",
        "backbone",
        "自然界中通过含有氧元素的物质的转化，使空气中氧气含量几乎保持恒定的地球化学过程",
        node_subkind=None,
        aliases=["oxygen cycle", "氧气循环"],
        learning_modes=["conceptual"],
        bridge_tags=["cycle", "environment", "nature"],
        framework_refs=["framework:chem:topic:2-3"],
        card_ref="node-card:concept:oxygen-cycle",
    )

    # 10. 碳循环 (Carbon Cycle)
    insert_node(
        conn,
        dataset_id,
        "concept:carbon-cycle",
        "碳循环",
        "concept",
        "backbone",
        "自然界中通过含有碳元素的物质的转化，使二氧化碳在自然界中保持一定含量的地球化学过程",
        node_subkind=None,
        aliases=["carbon cycle", "二氧化碳循环"],
        learning_modes=["conceptual"],
        bridge_tags=["cycle", "environment", "nature"],
        framework_refs=["framework:chem:topic:2-3"],
        card_ref="node-card:concept:carbon-cycle",
    )

    # ============== SUPPORT NODES (Experiments) ==============
    print("\n--- Creating Support Nodes (Experiments) ---")

    # Experiment 1: 木炭在氧气中燃烧
    insert_node(
        conn,
        dataset_id,
        "activity/experiment:charcoal-oxygen-combustion",
        "木炭在氧气中燃烧实验",
        "activity",
        "support",
        "将木炭在氧气中燃烧，观察燃烧现象，并向集气瓶中倒入澄清石灰水检验产物",
        node_subkind="experiment",
        aliases=["碳与氧气反应实验", "木炭燃烧实验"],
        learning_modes=["procedural"],
        bridge_tags=["experiment", "observation", "reaction"],
        properties={
            "materials": ["木炭", "氧气", "澄清石灰水", "集气瓶", "坩埚钳"],
            "observation": "木炭在氧气中燃烧比在空气中更剧烈，发出白光",
            "product": "二氧化碳（使澄清石灰水变浑浊）",
        },
    )

    # Experiment 2: 铁丝在氧气中燃烧
    insert_node(
        conn,
        dataset_id,
        "activity/experiment:iron-wire-oxygen-combustion",
        "铁丝在氧气中燃烧实验",
        "activity",
        "support",
        "将细铁丝在氧气中燃烧，观察燃烧现象，注意预先在集气瓶中放入少量水或细沙",
        node_subkind="experiment",
        aliases=["铁与氧气反应实验", "铁丝燃烧实验"],
        learning_modes=["procedural"],
        bridge_tags=["experiment", "observation", "reaction"],
        properties={
            "materials": ["细铁丝", "氧气", "火柴", "集气瓶", "水或细沙"],
            "observation": "铁丝剧烈燃烧，火星四射，生成黑色固体",
            "product": "四氧化三铁(Fe₃O₄)",
            "precaution": "预先放入少量水或细沙，防止高温熔融物炸裂瓶底",
        },
    )

    # Experiment 3: 倾倒二氧化碳
    insert_node(
        conn,
        dataset_id,
        "activity/experiment:pour-carbon-dioxide",
        "倾倒二氧化碳实验",
        "activity",
        "support",
        "向放有两支高低不同蜡烛的烧杯中倾倒二氧化碳，观察蜡烛熄灭顺序",
        node_subkind="experiment",
        aliases=["二氧化碳密度实验", "二氧化碳灭火实验"],
        learning_modes=["procedural"],
        bridge_tags=["experiment", "observation"],
        properties={
            "materials": ["二氧化碳", "蜡烛", "烧杯", "漏斗"],
            "observation": "蜡烛自下而上逐渐熄灭",
            "conclusion": "二氧化碳不能燃烧也不支持燃烧，密度大于空气",
        },
    )

    # Experiment 4: 二氧化碳与水反应
    insert_node(
        conn,
        dataset_id,
        "activity/experiment:co2-water-reaction",
        "二氧化碳与水反应实验",
        "activity",
        "support",
        "将二氧化碳通入滴有紫色石蕊试液的水中，观察颜色变化，再加热观察变化",
        node_subkind="experiment",
        aliases=["碳酸生成实验", "CO2溶于水实验"],
        learning_modes=["procedural"],
        bridge_tags=["experiment", "observation", "reaction"],
        properties={
            "materials": ["二氧化碳", "水", "紫色石蕊试液", "软塑料瓶", "试管"],
            "observation_1": "塑料瓶变瘪，紫色石蕊试液变红",
            "observation_2": "加热后红色褪去，恢复紫色",
            "conclusion": "CO₂与水反应生成碳酸（不稳定），碳酸受热分解",
        },
    )

    print("\n--- Creating Curriculum Profiles ---")

    # Profiles for all backbone nodes
    profiles = [
        (
            "profile:chem:entity/substance:oxygen",
            "entity/substance:oxygen",
            [
                "掌握氧气的物理性质（颜色、状态、气味、密度、溶解性、三态变化）",
                "掌握氧气的化学性质（助燃性、氧化性）",
                "了解氧气的主要用途（供给呼吸、支持燃烧）",
            ],
        ),
        (
            "profile:chem:entity/substance:carbon-dioxide",
            "entity/substance:carbon-dioxide",
            [
                "掌握二氧化碳的物理性质（颜色、状态、气味、密度、溶解性、干冰）",
                "掌握二氧化碳的化学性质（不能燃烧、不支持燃烧、能与水反应、能与石灰水反应）",
                "了解二氧化碳的主要用途及其与性质的关系",
            ],
        ),
        (
            "profile:chem:concept:physical-properties",
            "concept:physical-properties",
            [
                "理解物理性质的概念",
                "能够列举氧气和二氧化碳的物理性质",
                "能够区分物理性质和化学性质",
            ],
        ),
        (
            "profile:chem:concept:chemical-properties",
            "concept:chemical-properties",
            [
                "理解化学性质的概念",
                "能够列举氧气和二氧化碳的化学性质",
                "能够通过实验现象判断物质的化学性质",
            ],
        ),
        (
            "profile:chem:concept:combustion-supporting",
            "concept:combustion-supporting",
            [
                "理解助燃性的概念",
                "通过实验观察氧气支持燃烧的性质",
                "了解助燃性与可燃性的区别",
            ],
        ),
        (
            "profile:chem:concept:oxidation",
            "concept:oxidation",
            [
                "理解氧化反应的概念",
                "能够判断什么是氧化反应",
                "了解氧化反应在自然界中的普遍存在",
            ],
        ),
        (
            "profile:chem:entity/substance:dry-ice",
            "entity/substance:dry-ice",
            ["了解干冰是固态二氧化碳", "掌握干冰升华的特点", "了解干冰的主要用途"],
        ),
        (
            "profile:chem:entity/substance:carbonic-acid",
            "entity/substance:carbonic-acid",
            [
                "了解碳酸是二氧化碳与水的反应产物",
                "掌握碳酸的不稳定性",
                "了解碳酸能使紫色石蕊试液变红",
            ],
        ),
        (
            "profile:chem:concept:oxygen-cycle",
            "concept:oxygen-cycle",
            [
                "了解自然界中氧循环的主要途径",
                "理解光合作用在氧循环中的作用",
                "认识氧循环对维持生态平衡的意义",
            ],
        ),
        (
            "profile:chem:concept:carbon-cycle",
            "concept:carbon-cycle",
            [
                "了解自然界中碳循环的主要途径",
                "理解温室效应与碳循环的关系",
                "认识低碳生活的重要性",
            ],
        ),
    ]

    for profile_id, node_id, objectives in profiles:
        insert_profile(
            conn,
            dataset_id,
            profile_id,
            node_id,
            "chemistry",
            "junior_high",
            "grade_8",
            "introduced",
            "understand",
            objectives,
            [anchor],
        )

    print("\n--- Creating Evidence Records ---")

    # Evidence excerpts from the textbook
    evidence_list = [
        (
            "evidence:chem:2-3-2:p1701-oxygen-physical",
            "在通常状况下，氧气是一种无色、无气味的气体。在0°C与101kPa下，氧气的密度为1.429g/L，略大于空气的密度（1.293g/L）。氧气不易溶于水，在通常状况下，1L水中大约能溶解30mL氧气，水中生物就是靠溶解在水里的氧气呼吸的。在压强为101kPa时，氧气在-183°C液化为淡蓝色液体，在-218°C变为雪花状淡蓝色固体。",
            "第63页，氧气的物理性质",
            63,
            63,
        ),
        (
            "evidence:chem:2-3-2:p1713-charcoal-reaction",
            "实验中，我们可看出木炭在氧气中燃烧比在空气中更剧烈，铁丝在空气中很难燃烧，却可在氧气中燃烧。物质在空气中燃烧，实际上是与其中的氧气发生反应。",
            "第64页，氧气的化学性质——木炭燃烧",
            64,
            64,
        ),
        (
            "evidence:chem:2-3-2:p1755-oxidation",
            "比较和分析这两个化学反应的文字表达式，可以发现它们有一个共同的特点，即都是物质与氧气发生的化学反应，这类化学反应属于氧化反应。",
            "第64-65页，氧化反应定义",
            64,
            65,
        ),
        (
            "evidence:chem:2-3-2:p1782-co2-physical",
            "在通常状况下，二氧化碳是一种无色、无气味的气体。在加压、降温条件下将二氧化碳液化，可得到液态二氧化碳。进一步加压、降温即可得到固态二氧化碳。固态二氧化碳外形与冰相似，但在常压下，当温度高于-78.5°C时，就会升华，直接变成气态二氧化碳，因此固态二氧化碳常被称为「干冰」。",
            "第66页，二氧化碳的物理性质",
            66,
            66,
        ),
        (
            "evidence:chem:2-3-2:p1822-co2-chemical",
            "由于二氧化碳既不能燃烧也不支持燃烧，密度又大于空气，所以在实验1中看到了蜡烛自下而上逐渐熄灭，这也是二氧化碳能用于灭火的原因。二氧化碳能溶于水，导致软塑料瓶内压强略小于外部大气压强，大气压将瓶身轻微压瘪。同时，紫色石蕊试液变红，这是因为二氧化碳在溶于水的过程中还与水发生了化学反应，生成了能使紫色石蕊试液呈红色的碳酸。",
            "第67页，二氧化碳的化学性质",
            67,
            67,
        ),
        (
            "evidence:chem:2-3-2:p1863-oxygen-cycle",
            "虽然燃料燃烧、生物呼吸等过程消耗了氧气，但是空气中的氧气不会大幅减少，因为绿色植物的光合作用会源源不断地释放出氧气，弥补了自然界中氧气的消耗，使空气中氧气的含量几乎保持恒定。",
            "第68页，氧循环",
            68,
            68,
        ),
        (
            "evidence:chem:2-3-2:p1865-carbon-cycle",
            "自然界中的一些变化会产生二氧化碳，如含碳燃料燃烧、火山喷发、生物的呼吸作用、生物体被微生物分解等过程。另一些变化会吸收二氧化碳，例如，绿色植物吸收大气中的二氧化碳，通过光合作用产生糖类；江河湖海的水体也会溶解二氧化碳，并最终转变成碳酸盐。",
            "第68页，碳循环",
            68,
            68,
        ),
    ]

    for ev_id, excerpt, locator, p_start, p_end in evidence_list:
        insert_evidence(
            conn,
            dataset_id,
            ev_id,
            "textbook",
            source_id,
            anchor,
            excerpt,
            locator,
            p_start,
            p_end,
        )

    print("\n--- Creating Mentions ---")

    # Mentions linking nodes to this lesson
    mentions = [
        (
            "mention:chem:oxygen-in-2-3-2",
            "entity/substance:oxygen",
            "focuses_on",
            [
                "evidence:chem:2-3-2:p1701-oxygen-physical",
                "evidence:chem:2-3-2:p1713-charcoal-reaction",
            ],
        ),
        (
            "mention:chem:carbon-dioxide-in-2-3-2",
            "entity/substance:carbon-dioxide",
            "focuses_on",
            [
                "evidence:chem:2-3-2:p1782-co2-physical",
                "evidence:chem:2-3-2:p1822-co2-chemical",
            ],
        ),
        (
            "mention:chem:physical-properties-in-2-3-2",
            "concept:physical-properties",
            "introduces",
            [
                "evidence:chem:2-3-2:p1701-oxygen-physical",
                "evidence:chem:2-3-2:p1782-co2-physical",
            ],
        ),
        (
            "mention:chem:chemical-properties-in-2-3-2",
            "concept:chemical-properties",
            "introduces",
            [
                "evidence:chem:2-3-2:p1713-charcoal-reaction",
                "evidence:chem:2-3-2:p1822-co2-chemical",
            ],
        ),
        (
            "mention:chem:combustion-supporting-in-2-3-2",
            "concept:combustion-supporting",
            "defines",
            ["evidence:chem:2-3-2:p1713-charcoal-reaction"],
        ),
        (
            "mention:chem:oxidation-in-2-3-2",
            "concept:oxidation",
            "defines",
            ["evidence:chem:2-3-2:p1755-oxidation"],
        ),
        (
            "mention:chem:dry-ice-in-2-3-2",
            "entity/substance:dry-ice",
            "introduces",
            ["evidence:chem:2-3-2:p1782-co2-physical"],
        ),
        (
            "mention:chem:carbonic-acid-in-2-3-2",
            "entity/substance:carbonic-acid",
            "introduces",
            ["evidence:chem:2-3-2:p1822-co2-chemical"],
        ),
        (
            "mention:chem:oxygen-cycle-in-2-3-2",
            "concept:oxygen-cycle",
            "introduces",
            ["evidence:chem:2-3-2:p1863-oxygen-cycle"],
        ),
        (
            "mention:chem:carbon-cycle-in-2-3-2",
            "concept:carbon-cycle",
            "introduces",
            ["evidence:chem:2-3-2:p1865-carbon-cycle"],
        ),
    ]

    for m_id, target_id, role, ev_refs in mentions:
        insert_mention(conn, dataset_id, m_id, anchor, "node", target_id, role, ev_refs)

    print("\n--- Creating Edges ---")

    # Edges between nodes
    edges = [
        # Oxygen has physical properties
        (
            "edge:oxygen-has-physical-properties",
            "entity/substance:oxygen",
            "concept:physical-properties",
            "has_property",
            "backbone",
            False,
            ["evidence:chem:2-3-2:p1701-oxygen-physical"],
        ),
        # Oxygen has chemical properties
        (
            "edge:oxygen-has-chemical-properties",
            "entity/substance:oxygen",
            "concept:chemical-properties",
            "has_property",
            "backbone",
            False,
            ["evidence:chem:2-3-2:p1713-charcoal-reaction"],
        ),
        # Oxygen has combustion supporting property
        (
            "edge:oxygen-has-combustion-supporting",
            "entity/substance:oxygen",
            "concept:combustion-supporting",
            "has_property",
            "backbone",
            False,
            ["evidence:chem:2-3-2:p1713-charcoal-reaction"],
        ),
        # Oxygen participates in oxidation
        (
            "edge:oxygen-oxidation",
            "entity/substance:oxygen",
            "concept:oxidation",
            "related_to",
            "backbone",
            False,
            ["evidence:chem:2-3-2:p1755-oxidation"],
        ),
        # CO2 has physical properties
        (
            "edge:co2-has-physical-properties",
            "entity/substance:carbon-dioxide",
            "concept:physical-properties",
            "has_property",
            "backbone",
            False,
            ["evidence:chem:2-3-2:p1782-co2-physical"],
        ),
        # CO2 has chemical properties
        (
            "edge:co2-has-chemical-properties",
            "entity/substance:carbon-dioxide",
            "concept:chemical-properties",
            "has_property",
            "backbone",
            False,
            ["evidence:chem:2-3-2:p1822-co2-chemical"],
        ),
        # Dry ice is solid form of CO2
        (
            "edge:dry-ice-is-solid-co2",
            "entity/substance:dry-ice",
            "entity/substance:carbon-dioxide",
            "related_to",
            "backbone",
            False,
            ["evidence:chem:2-3-2:p1782-co2-physical"],
        ),
        # CO2 produces carbonic acid
        (
            "edge:co2-produces-carbonic-acid",
            "entity/substance:carbon-dioxide",
            "entity/substance:carbonic-acid",
            "produces",
            "backbone",
            False,
            ["evidence:chem:2-3-2:p1822-co2-chemical"],
        ),
        # Oxygen cycle involves oxygen
        (
            "edge:oxygen-cycle-involves-oxygen",
            "concept:oxygen-cycle",
            "entity/substance:oxygen",
            "related_to",
            "backbone",
            False,
            ["evidence:chem:2-3-2:p1863-oxygen-cycle"],
        ),
        # Carbon cycle involves CO2
        (
            "edge:carbon-cycle-involves-co2",
            "concept:carbon-cycle",
            "entity/substance:carbon-dioxide",
            "related_to",
            "backbone",
            False,
            ["evidence:chem:2-3-2:p1865-carbon-cycle"],
        ),
        # Chemical properties include combustion supporting
        (
            "edge:chemical-properties-includes-combustion",
            "concept:chemical-properties",
            "concept:combustion-supporting",
            "contains",
            "backbone",
            False,
            ["evidence:chem:2-3-2:p1713-charcoal-reaction"],
        ),
        # Chemical properties include oxidation
        (
            "edge:chemical-properties-includes-oxidation",
            "concept:chemical-properties",
            "concept:oxidation",
            "contains",
            "backbone",
            False,
            ["evidence:chem:2-3-2:p1755-oxidation"],
        ),
    ]

    for e_id, src, tgt, rel, layer, expand, src_refs in edges:
        insert_edge(conn, dataset_id, e_id, src, tgt, rel, layer, expand, src_refs)

    # Support edges (experiments demonstrate concepts)
    support_edges = [
        (
            "edge:exp-charcoal-demonstrates-oxygen",
            "activity/experiment:charcoal-oxygen-combustion",
            "entity/substance:oxygen",
            "demonstrates",
            "support",
            True,
            ["evidence:chem:2-3-2:p1713-charcoal-reaction"],
        ),
        (
            "edge:exp-iron-demonstrates-oxygen",
            "activity/experiment:iron-wire-oxygen-combustion",
            "entity/substance:oxygen",
            "demonstrates",
            "support",
            True,
            ["evidence:chem:2-3-2:p1755-oxidation"],
        ),
        (
            "edge:exp-pour-demonstrates-co2",
            "activity/experiment:pour-carbon-dioxide",
            "entity/substance:carbon-dioxide",
            "demonstrates",
            "support",
            True,
            ["evidence:chem:2-3-2:p1822-co2-chemical"],
        ),
        (
            "edge:exp-co2-water-demonstrates-co2",
            "activity/experiment:co2-water-reaction",
            "entity/substance:carbon-dioxide",
            "demonstrates",
            "support",
            True,
            ["evidence:chem:2-3-2:p1822-co2-chemical"],
        ),
    ]

    for e_id, src, tgt, rel, layer, expand, src_refs in support_edges:
        insert_edge(conn, dataset_id, e_id, src, tgt, rel, layer, expand, src_refs)

    print("\n--- Creating Node Cards ---")

    # Node cards for backbone nodes
    node_cards = [
        # Oxygen node card
        (
            "node-card:entity/substance:oxygen",
            "entity/substance:oxygen",
            "氧气",
            "氧气是维持生命活动不可或缺的气体，化学性质活泼，能与多种物质发生氧化反应。",
            [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "氧气是由氧元素组成的单质，化学式为O₂，是空气的主要成分之一，约占空气体积的21%。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "氧气是一种化学性质比较活泼的气体，具有助燃性和氧化性，能够支持燃烧和供给呼吸。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key_points",
                    "title": "关键要点",
                    "content": "• 物理性质：无色无味气体，密度略大于空气，不易溶于水\n• 三态变化：-183°C液化为淡蓝色液体，-218°C变为雪花状淡蓝色固体\n• 化学性质：助燃性（支持燃烧）、氧化性（与多种物质反应）\n• 主要用途：供给呼吸（潜水、医疗）、支持燃烧（气割、炼钢）",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "木炭在氧气中燃烧比在空气中更剧烈，发出白光，生成能使澄清石灰水变浑浊的二氧化碳；铁丝在氧气中剧烈燃烧，火星四射，生成黑色固体四氧化三铁。",
                    "pattern_ref": "explanation/v2/example",
                },
                {
                    "id": "application",
                    "title": "应用",
                    "content": "氧气在生产和生活中有广泛应用：医疗急救中向病人输氧；潜水员、航天员携带供氧装置；工业上用于气割、炼钢、火箭推进剂等。",
                    "pattern_ref": "explanation/v2/application",
                },
                {
                    "id": "misconception",
                    "title": "常见误解",
                    "content": "氧气本身不能燃烧，它只是支持燃烧（助燃性），具有可燃性的物质才能在氧气中燃烧。",
                    "pattern_ref": "explanation/v2/misconception",
                },
            ],
        ),
        # CO2 node card
        (
            "node-card:entity/substance:carbon-dioxide",
            "entity/substance:carbon-dioxide",
            "二氧化碳",
            "二氧化碳是空气中的重要成分，虽然含量较少但对地球生态系统和人类生活有重要影响。",
            [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "二氧化碳是由碳元素和氧元素组成的化合物，化学式为CO₂，是空气的组成成分之一，约占空气体积的0.03%。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "二氧化碳是一种无色无味的气体，密度大于空气，不能燃烧也不支持燃烧，能与水反应生成碳酸。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key_points",
                    "title": "关键要点",
                    "content": "• 物理性质：无色无味气体，密度大于空气，能溶于水\n• 干冰：固态二氧化碳，-78.5°C升华，常用于制冷\n• 化学性质：不能燃烧、不支持燃烧；与水反应生成碳酸；与石灰水反应生成碳酸钙\n• 用途：气体肥料、碳酸饮料、灭火、化工原料、人工降雨",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "向放有两支高低不同蜡烛的烧杯中倾倒二氧化碳，观察到蜡烛自下而上逐渐熄灭，这说明二氧化碳不能燃烧也不支持燃烧，且密度大于空气。",
                    "pattern_ref": "explanation/v2/example",
                },
                {
                    "id": "application",
                    "title": "应用",
                    "content": "大棚蔬菜种植中用作气体肥料；生产碳酸饮料；二氧化碳灭火器；化工原料（生产纯碱、化肥）；干冰用于食品冷藏、人工降雨、舞台效果。",
                    "pattern_ref": "explanation/v2/application",
                },
                {
                    "id": "misconception",
                    "title": "常见误解",
                    "content": "二氧化碳无毒，但当空气中二氧化碳含量过高时会造成人体呼吸困难，在人群密集的地方应注意通风换气。",
                    "pattern_ref": "explanation/v2/misconception",
                },
            ],
        ),
        # Physical properties card
        (
            "node-card:concept:physical-properties",
            "concept:physical-properties",
            "物理性质",
            "物理性质是物质不经过化学变化就能表现出来的性质，是认识物质的基础。",
            [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "物理性质是物质不需要发生化学变化就能表现出来的性质。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "物理性质描述物质的状态和特性，不涉及物质组成的改变，可通过观察和测量直接获得。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key_points",
                    "title": "关键要点",
                    "content": "• 常见物理性质：颜色、状态、气味、密度、溶解性、熔点、沸点\n• 与化学性质的区别：物理性质不改变物质组成，化学性质涉及化学反应\n• 应用：根据物理性质选择合适的收集方法（如向上/向下排空气法）；根据密度判断气体排放位置",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "氧气的物理性质：无色无味气体，密度略大于空气（可用向上排空气法收集），不易溶于水（可用排水法收集）。",
                    "pattern_ref": "explanation/v2/example",
                },
            ],
        ),
        # Chemical properties card
        (
            "node-card:concept:chemical-properties",
            "concept:chemical-properties",
            "化学性质",
            "化学性质是物质在化学变化中表现出来的性质，反映了物质发生化学反应的能力。",
            [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "化学性质是物质在化学变化中表现出来的性质。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "化学性质描述了物质与其他物质反应的能力，表现为物质的活泼程度或稳定性。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key_points",
                    "title": "关键要点",
                    "content": "• 常见化学性质：可燃性、助燃性、氧化性、稳定性、酸性、碱性\n• 判断依据：需要通过化学实验观察反应现象\n• 树app：根据化学性质确定物质的用途（如二氧化碳用于灭火、氧气用于炼钢）",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "氧气的化学性质：具有助燃性，能使带火星的木条复燃；具有氧化性，能与碳、铁等许多物质发生氧化反应。",
                    "pattern_ref": "explanation/v2/example",
                },
            ],
        ),
        # Combustion supporting card
        (
            "node-card:concept:combustion-supporting",
            "concept:combustion-supporting",
            "助燃性",
            "助燃性是氧气的重要化学性质，指物质支持其他物质燃烧的能力。",
            [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "助燃性是指物质能够帮助或支持其他物质燃烧的性质。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "具有助燃性的物质本身不燃烧，但能为燃烧反应提供必要条件，使燃烧更剧烈。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key_points",
                    "title": "关键要点",
                    "content": "• 与可燃性的区别：助燃性物质不燃烧，可燃性物质能燃烧\n• 典型代表：氧气具有助燃性\n• 实验现象：带火星的木条在氧气中复燃；物质在氧气中燃烧比在空气中更剧烈",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "将带火星的木条伸入盛有氧气的集气瓶中，木条复燃，证明氧气具有助燃性。木炭在氧气中燃烧比在空气中更剧烈，发出白光。",
                    "pattern_ref": "explanation/v2/example",
                },
                {
                    "id": "misconception",
                    "title": "常见误解",
                    "content": "助燃 ≠ 可燃。氧气能支持燃烧，但氧气本身不能燃烧，不是可燃物。",
                    "pattern_ref": "explanation/v2/misconception",
                },
            ],
        ),
        # Oxidation card
        (
            "node-card:concept:oxidation",
            "concept:oxidation",
            "氧化性",
            "氧化性描述物质与氧反应的性质，是化学中重要的反应类型。",
            [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "物质与氧气发生的化学反应属于氧化反应。氧气具有氧化性，能使其他物质氧化。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "氧化反应是物质与氧结合的过程，伴随能量释放，在自然界和工业生产中普遍存在。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key_points",
                    "title": "关键要点",
                    "content": "• 特征：物质与氧气反应\n• 普遍性：自然界中普遍存在（燃烧、呼吸、锈蚀等）\n• 特点：通常放热\n• 应用与防护：利用氧化反应（炼钢、燃烧），防止氧化（真空包装、涂防锈漆）",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "碳 + 氧气 → 二氧化碳；铁 + 氧气 → 四氧化三铁；钢铁材料氧化锈蚀；生物体内糖类氧化释放能量。",
                    "pattern_ref": "explanation/v2/example",
                },
                {
                    "id": "application",
                    "title": "应用",
                    "content": "利用氧化反应进行炼钢、燃烧提供能量；为防止金属氧化锈蚀，采用真空包装、涂防锈漆等方法隔绝氧气。",
                    "pattern_ref": "explanation/v2/application",
                },
            ],
        ),
        # Dry ice card
        (
            "node-card:entity/substance:dry-ice",
            "entity/substance:dry-ice",
            "干冰",
            "干冰是固态二氧化碳的俗称，具有独特的升华特性，在制冷和人工降雨中有重要应用。",
            [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "干冰是固态二氧化碳的俗称，外形与冰相似，但不经过液态直接升华为气态。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "干冰在常压下温度高于-78.5°C时直接升华为气态二氧化碳，不产生液体，无残留物。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key_points",
                    "title": "关键要点",
                    "content": "• 形成：二氧化碳加压、降温得到固态\n• 特性：-78.5°C升华，升华吸热，无残留物\n• 优点：降温快、干净、不污染环境\n• 用途：食品冷藏保鲜、人工降雨、舞台云雾效果",
                    "pattern_ref": "explanation/v2/key-points",
                },
            ],
        ),
        # Carbonic acid card
        (
            "node-card:entity/substance:carbonic-acid",
            "entity/substance:carbonic-acid",
            "碳酸",
            "碳酸是二氧化碳溶于水时产生的弱酸，不稳定，是碳酸饮料的基础。",
            [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "碳酸是二氧化碳溶于水时与水反应生成的不稳定弱酸，化学式为H₂CO₃。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "碳酸是不稳定的弱酸，稍加热即分解，能使紫色石蕊试液变红，是碳酸饮料中气泡的来源。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key_points",
                    "title": "关键要点",
                    "content": "• 生成：CO₂ + H₂O → H₂CO₃\n• 不稳定性：加热分解为CO₂和H₂O\n• 特征：使紫色石蕊试液变红（酸性）\n• 应用：碳酸饮料（碳酸受热分解产生气泡）",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "将二氧化碳通入滴有紫色石蕊试液的水中，试液变红（生成碳酸）；加热后红色褪去，恢复紫色（碳酸分解）。",
                    "pattern_ref": "explanation/v2/example",
                },
            ],
        ),
        # Oxygen cycle card
        (
            "node-card:concept:oxygen-cycle",
            "concept:oxygen-cycle",
            "氧循环",
            "氧循环是维持大气中氧气含量相对稳定的重要自然过程。",
            [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "氧循环是指自然界通过含有氧元素的物质的转化，使空气中氧气含量几乎保持恒定的地球化学过程。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "氧循环通过光合作用产生氧气，通过呼吸作用和燃烧消耗氧气，两者达到动态平衡。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key_points",
                    "title": "关键要点",
                    "content": "• 氧气产生：绿色植物光合作用\n• 氧气消耗：燃料燃烧、生物呼吸、金属锈蚀等\n• 意义：维持大气中氧气含量稳定，保障生命活动\n• 人类活动影响：燃烧化石燃料会消耗氧气",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "application",
                    "title": "意义",
                    "content": "氧循环对于维持人类生活和生态平衡具有重要意义。绿色植物的光合作用持续释放氧气，弥补了自然界的氧气消耗。",
                    "pattern_ref": "explanation/v2/application",
                },
            ],
        ),
        # Carbon cycle card
        (
            "node-card:concept:carbon-cycle",
            "concept:carbon-cycle",
            "碳循环",
            "碳循环是二氧化碳在自然界中迁移转化的过程，与全球气候变化密切相关。",
            [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "碳循环是指自然界通过含有碳元素的物质的转化，使二氧化碳在自然界中保持一定含量的地球化学过程。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "碳循环通过光合作用吸收CO₂，通过呼吸和燃烧释放CO₂，维持大气中CO₂含量的相对稳定。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key_points",
                    "title": "关键要点",
                    "content": "• CO₂产生：含碳燃料燃烧、火山喷发、生物呼吸、微生物分解\n• CO₂吸收：绿色植物光合作用、水体溶解形成碳酸盐\n• 温室效应：CO₂过多导致温室效应加剧\n• 低碳生活：减少CO₂排放，践行可持续发展",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "application",
                    "title": "环境保护",
                    "content": "碳达峰、碳中和是促进人与自然和谐共生的重要目标，需要采取技术创新、产业转型、新能源开发等措施减少含碳能源消耗。",
                    "pattern_ref": "explanation/v2/application",
                },
            ],
        ),
    ]

    for card_id, node_id, title, summary, sections in node_cards:
        insert_node_card(
            conn, dataset_id, card_id, node_id, "backbone", title, summary, sections
        )

    print("\n" + "=" * 60)
    print("Extraction complete!")
    print("=" * 60)

    # Summary
    cur = conn.cursor()
    tables = ["nodes", "edges", "profiles", "mentions", "evidence", "node_cards"]
    print("\nSummary:")
    for table in tables:
        cur.execute(f"SELECT COUNT(*) FROM {table} WHERE dataset_id = ?", (dataset_id,))
        count = cur.fetchone()[0]
        print(f"  {table}: {count} records")

    conn.close()


if __name__ == "__main__":
    main()
