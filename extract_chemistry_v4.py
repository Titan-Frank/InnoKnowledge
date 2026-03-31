#!/usr/bin/env python3
"""
High School Chemistry Book 1 - Complete Knowledge Extraction
Book ID: chem-highschool-compulsory-1
Output: data/v4/
"""

import json
from datetime import datetime

BOOK_ID = "chem-highschool-compulsory-1"
TIMESTAMP = datetime.now().isoformat()

# Initialize counters
nodes = []
edges = []
profiles = []
mentions = []
evidence_records = []

# Framework reference for high school chemistry
HS_CHEM_FRAMEWORK = "framework:cn-chem-junior"


def create_node(
    node_id,
    canonical_name,
    node_kind,
    node_layer,
    definition,
    aliases=None,
    learning_modes=None,
    bridge_tags=None,
    framework_refs=None,
    properties=None,
):
    """Create a canonical knowledge node."""
    return {
        "id": node_id,
        "canonical_name": canonical_name,
        "node_kind": node_kind,
        "node_layer": node_layer,
        "aliases": aliases or [],
        "definition": definition,
        "learning_modes": learning_modes or ["conceptual"],
        "bridge_tags": bridge_tags or [],
        "framework_refs": framework_refs or [],
        "profile_refs": [],
        "properties": properties or {},
        "status": "active",
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }


def create_edge(
    edge_id,
    edge_type,
    from_node,
    to_node,
    edge_layer="backbone",
    backbone_expand=False,
    confidence=0.9,
    framework_refs=None,
):
    """Create a canonical knowledge edge."""
    return {
        "id": edge_id,
        "edge_type": edge_type,
        "edge_layer": edge_layer,
        "backbone_expand": backbone_expand,
        "from": from_node,
        "to": to_node,
        "directionality": "directed",
        "confidence": confidence,
        "framework_refs": framework_refs or [],
        "profile_refs": [],
        "properties": {},
        "status": "active",
        "created_at": TIMESTAMP,
        "updated_at": TIMESTAMP,
    }


def create_profile(
    profile_id,
    node_id,
    subject,
    school_stage,
    grade_band,
    curriculum_role,
    mastery_level,
    framework_refs,
    learning_objectives,
):
    """Create a curriculum profile."""
    return {
        "id": profile_id,
        "node_id": node_id,
        "subject": subject,
        "school_stage": school_stage,
        "grade_band": grade_band,
        "curriculum_role": curriculum_role,
        "mastery_level": mastery_level,
        "framework_refs": framework_refs,
        "textbook_refs": [],
        "textbook_ids": [BOOK_ID],
        "learning_objectives": learning_objectives,
        "assessment_signals": [],
        "source_refs": [],
        "properties": {},
        "status": "reviewed",
        "updated_at": TIMESTAMP,
    }


def create_evidence(
    evidence_id,
    source_id,
    anchor_ref,
    excerpt,
    locator,
    page_start,
    page_end,
    extraction_method="manual",
):
    """Create an evidence record."""
    return {
        "id": evidence_id,
        "source_type": "textbook",
        "source_id": source_id,
        "anchor_ref": anchor_ref,
        "source_path": f"/Users/titan-frank/Documents/hsd/research/Knowledge/1767_高中_化学_沪科技版_高中年级_必修_第一册_普通高中教科书·化学必修_第一册_1982834a-3522-49d2-91b4-367ba2d9e5d0.pdf",
        "page_start": page_start,
        "page_end": page_end,
        "excerpt": excerpt,
        "locator": locator,
        "modality": "text",
        "extraction_method": extraction_method,
        "normalized_claims": [],
        "properties": {},
    }


def create_mention(
    mention_id,
    source_id,
    anchor_ref,
    target_type,
    target_id,
    role,
    source_refs,
    confidence=0.95,
):
    """Create a mention record."""
    return {
        "id": mention_id,
        "source_type": "textbook",
        "source_id": source_id,
        "anchor_ref": anchor_ref,
        "target_type": target_type,
        "target_id": target_id,
        "role": role,
        "source_refs": source_refs,
        "confidence": confidence,
        "properties": {},
    }


# ============ BATCH 1: Intro + Chapter 1 Part 1 ============
def process_batch_1():
    """Batch 1: Intro (绪言) + Lesson 1-1 (物质的分类) + Lesson 1-2 (物质的量)"""
    global nodes, edges, profiles, mentions, evidence_records

    print("Processing Batch 1: Intro + Chapter 1 Part 1...")

    # === INTRO (绪言) - p.1-4 ===
    # Evidence for intro
    evidence_records.append(
        create_evidence(
            "evidence:chem-hs-1:intro-001",
            BOOK_ID,
            "struct:chem-highschool-compulsory-1:intro:0",
            "化学是人类在认识、探索、利用和保护自然的实践活动中，通过不断总结和完善而形成的知识体系",
            "绪言第 1 段",
            1,
            2,
        )
    )

    evidence_records.append(
        create_evidence(
            "evidence:chem-hs-1:intro-002",
            BOOK_ID,
            "struct:chem-highschool-compulsory-1:intro:0",
            "化学是研究物质的性质、组成、结构、变化和与之相伴随的能量转变的科学",
            "绪言第 6 页",
            6,
        )
    )

    # Core concept: 化学变化 (Chemical Change) - backbone
    nodes.append(
        create_node(
            "concept:chemical-change",
            "化学变化",
            "concept",
            "backbone",
            "产生新物质的变化过程，其特征是原子重新组合形成新的分子",
            ["化学反应"],
            ["conceptual"],
            ["change", "matter"],
            [HS_CHEM_FRAMEWORK],
        )
    )

    # Core concept: 物理变化 (Physical Change) - backbone
    nodes.append(
        create_node(
            "concept:physical-change",
            "物理变化",
            "concept",
            "backbone",
            "物质状态或形态发生变化但不产生新物质的过程",
            ["物态变化"],
            ["conceptual"],
            ["change", "matter"],
            [HS_CHEM_FRAMEWORK],
        )
    )

    # Core concept: 物质 (Matter) - backbone
    nodes.append(
        create_node(
            "concept:matter",
            "物质",
            "concept",
            "backbone",
            "构成宇宙万物的基本实体，具有质量和占据空间的特性",
            ["matter"],
            ["conceptual"],
            ["matter", "system"],
            [HS_CHEM_FRAMEWORK],
        )
    )

    # Mention for intro
    mentions.append(
        create_mention(
            "mention:chem-hs-1:intro-001",
            BOOK_ID,
            "struct:chem-highschool-compulsory-1:intro:0",
            "node",
            "concept:matter",
            "introduces",
            ["evidence:chem-hs-1:intro-001"],
        )
    )

    mentions.append(
        create_mention(
            "mention:chem-hs-1:intro-002",
            BOOK_ID,
            "struct:chem-highschool-compulsory-1:intro:0",
            "node",
            "concept:chemical-change",
            "introduces",
            ["evidence:chem-hs-1:intro-002"],
        )
    )

    # === LESSON 1-1: 物质的分类 (p.7-14) ===
    evidence_records.append(
        create_evidence(
            "evidence:chem-hs-1:lesson-1-1-001",
            BOOK_ID,
            "struct:chem-highschool-compulsory-1:lesson:1-1",
            "根据物质的组成，可将物质分为纯净物和混合物；对于纯净物，可根据物质中所含元素的种类，分为单质和化合物",
            "第 1.1 节第 7 页",
            7,
            8,
        )
    )

    evidence_records.append(
        create_evidence(
            "evidence:chem-hs-1:lesson-1-1-002",
            BOOK_ID,
            "struct:chem-highschool-compulsory-1:lesson:1-1",
            "根据分散质粒子的大小，可将分散系分为溶液、胶体、浊液等",
            "第 1.1 节第 10 页",
            10,
            11,
        )
    )

    evidence_records.append(
        create_evidence(
            "evidence:chem-hs-1:lesson-1-1-003",
            BOOK_ID,
            "struct:chem-highschool-compulsory-1:lesson:1-1",
            "分散质粒子的直径大小在 1～100 nm 之间的分散系，叫做胶体",
            "第 1.1 节第 11 页",
            11,
        )
    )

    # Core concept: 混合物 (Mixture) - backbone
    nodes.append(
        create_node(
            "concept:mixture",
            "混合物",
            "concept",
            "backbone",
            "由两种或多种物质混合而成的物质体系，各组分保持原有性质",
            ["mixed substance"],
            ["conceptual"],
            ["classification", "matter"],
            [HS_CHEM_FRAMEWORK],
        )
    )

    # Core concept: 纯净物 (Pure Substance) - backbone
    nodes.append(
        create_node(
            "concept:pure-substance",
            "纯净物",
            "concept",
            "backbone",
            "由一种物质组成的物质，具有固定的组成和性质",
            ["pure substance"],
            ["conceptual"],
            ["classification", "matter"],
            [HS_CHEM_FRAMEWORK],
        )
    )

    # Core concept: 分散系 (Dispersion System) - backbone
    nodes.append(
        create_node(
            "concept:dispersion-system",
            "分散系",
            "concept",
            "backbone",
            "一种或多种物质分散在另一种物质中形成的混合体系",
            ["分散体系"],
            ["conceptual"],
            ["system", "matter"],
            [HS_CHEM_FRAMEWORK],
        )
    )

    # Support concept: 溶液 (Solution) - support
    nodes.append(
        create_node(
            "concept:solution",
            "溶液",
            "concept",
            "support",
            "分散质粒子直径小于 1 nm 的分散系，具有均匀、稳定的特征",
            ["solution"],
            ["conceptual"],
            ["system", "matter"],
        )
    )

    # Support concept: 胶体 (Colloid) - support
    nodes.append(
        create_node(
            "concept:colloid",
            "胶体",
            "concept",
            "support",
            "分散质粒子直径在 1-100 nm 之间的分散系，在一定条件下能稳定存在",
            ["胶体分散系"],
            ["conceptual"],
            ["system", "matter"],
        )
    )

    # Support concept: 浊液 (Suspension) - support
    nodes.append(
        create_node(
            "concept:suspension",
            "浊液",
            "concept",
            "support",
            "分散质粒子直径大于 100 nm 的分散系，表现出不均匀、不稳定的特征",
            ["悬浊液", "乳浊液"],
            ["conceptual"],
            ["system", "matter"],
        )
    )

    # Support method: 丁达尔现象 (Tyndall Effect) - support
    nodes.append(
        create_node(
            "method:tyndall-effect",
            "丁达尔现象",
            "method",
            "support",
            "用光束照射胶体时产生的光路现象，可用于鉴别胶体和溶液",
            ["丁达尔效应", "Tyndall effect"],
            ["procedural", "factual"],
            ["evidence", "measurement"],
        )
    )

    # Edges for classification
    edges.append(
        create_edge(
            "edge:matter-classification-001",
            "contains",
            "concept:matter",
            "concept:mixture",
            "backbone",
            False,
            0.95,
            [HS_CHEM_FRAMEWORK],
        )
    )

    edges.append(
        create_edge(
            "edge:matter-classification-002",
            "contains",
            "concept:matter",
            "concept:pure-substance",
            "backbone",
            False,
            0.95,
            [HS_CHEM_FRAMEWORK],
        )
    )

    edges.append(
        create_edge(
            "edge:dispersion-types-001",
            "contains",
            "concept:dispersion-system",
            "concept:solution",
            "support",
            True,
            0.9,
        )
    )

    edges.append(
        create_edge(
            "edge:dispersion-types-002",
            "contains",
            "concept:dispersion-system",
            "concept:colloid",
            "support",
            True,
            0.9,
        )
    )

    edges.append(
        create_edge(
            "edge:dispersion-types-003",
            "contains",
            "concept:dispersion-system",
            "concept:suspension",
            "support",
            True,
            0.9,
        )
    )

    edges.append(
        create_edge(
            "edge:tyndall-uses-001",
            "measures",
            "method:tyndall-effect",
            "concept:colloid",
            "support",
            True,
            0.95,
        )
    )

    # Profiles
    profiles.append(
        create_profile(
            "profile:chem-hs:matter-001",
            "concept:matter",
            "化学",
            "senior_secondary",
            "10-12",
            "introduced",
            "understand",
            [HS_CHEM_FRAMEWORK],
            ["认识物质的多样性和分类方法", "理解物质的基本属性"],
        )
    )

    profiles.append(
        create_profile(
            "profile:chem-hs:chemical-change-001",
            "concept:chemical-change",
            "化学",
            "senior_secondary",
            "10-12",
            "introduced",
            "understand",
            [HS_CHEM_FRAMEWORK],
            ["理解化学变化的本质特征", "区分化学变化和物理变化"],
        )
    )

    profiles.append(
        create_profile(
            "profile:chem-hs:dispersion-001",
            "concept:dispersion-system",
            "化学",
            "senior_secondary",
            "10-12",
            "developed",
            "apply",
            [HS_CHEM_FRAMEWORK],
            ["掌握分散系的分类方法", "理解溶液、胶体、浊液的区别"],
        )
    )

    # Mentions for lesson 1-1
    mentions.append(
        create_mention(
            "mention:chem-hs-1:lesson-1-1-001",
            BOOK_ID,
            "struct:chem-highschool-compulsory-1:lesson:1-1",
            "node",
            "concept:mixture",
            "defines",
            ["evidence:chem-hs-1:lesson-1-1-001"],
        )
    )

    mentions.append(
        create_mention(
            "mention:chem-hs-1:lesson-1-1-002",
            BOOK_ID,
            "struct:chem-highschool-compulsory-1:lesson:1-1",
            "node",
            "concept:pure-substance",
            "defines",
            ["evidence:chem-hs-1:lesson-1-1-001"],
        )
    )

    mentions.append(
        create_mention(
            "mention:chem-hs-1:lesson-1-1-003",
            BOOK_ID,
            "struct:chem-highschool-compulsory-1:lesson:1-1",
            "node",
            "concept:dispersion-system",
            "defines",
            ["evidence:chem-hs-1:lesson-1-1-002"],
        )
    )

    mentions.append(
        create_mention(
            "mention:chem-hs-1:lesson-1-1-004",
            BOOK_ID,
            "struct:chem-highschool-compulsory-1:lesson:1-1",
            "node",
            "concept:colloid",
            "focuses_on",
            ["evidence:chem-hs-1:lesson-1-1-003"],
        )
    )

    mentions.append(
        create_mention(
            "mention:chem-hs-1:lesson-1-1-005",
            BOOK_ID,
            "struct:chem-highschool-compulsory-1:lesson:1-1",
            "node",
            "method:tyndall-effect",
            "demonstrates",
            ["evidence:chem-hs-1:lesson-1-1-003"],
        )
    )

    print(
        f"  Batch 1 complete: {len(nodes)} nodes, {len(edges)} edges, {len(profiles)} profiles"
    )


# Run batch 1
process_batch_1()

# Write results
with open(
    "/Users/titan-frank/Documents/hsd/research/Knowledge/data/v4/graph/knowledge.nodes.jsonl",
    "w",
) as f:
    for node in nodes:
        f.write(json.dumps(node, ensure_ascii=False) + "\n")

with open(
    "/Users/titan-frank/Documents/hsd/research/Knowledge/data/v4/graph/knowledge.edges.jsonl",
    "w",
) as f:
    for edge in edges:
        f.write(json.dumps(edge, ensure_ascii=False) + "\n")

with open(
    "/Users/titan-frank/Documents/hsd/research/Knowledge/data/v4/profiles/knowledge.profiles.jsonl",
    "w",
) as f:
    for profile in profiles:
        f.write(json.dumps(profile, ensure_ascii=False) + "\n")

with open(
    "/Users/titan-frank/Documents/hsd/research/Knowledge/data/v4/graph/chem-highschool-compulsory-1.mentions.jsonl",
    "w",
) as f:
    for mention in mentions:
        f.write(json.dumps(mention, ensure_ascii=False) + "\n")

with open(
    "/Users/titan-frank/Documents/hsd/research/Knowledge/data/v4/graph/chem-highschool-compulsory-1.evidence.jsonl",
    "w",
) as f:
    for evidence in evidence_records:
        f.write(json.dumps(evidence, ensure_ascii=False) + "\n")

print(f"\nBatch 1 Results:")
print(f"  Nodes: {len(nodes)}")
print(f"  Edges: {len(edges)}")
print(f"  Profiles: {len(profiles)}")
print(f"  Mentions: {len(mentions)}")
print(f"  Evidence: {len(evidence_records)}")
