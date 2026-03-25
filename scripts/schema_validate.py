#!/usr/bin/env python3
"""
Schema Validation and Optimization Analysis
"""

import json
import re
from pathlib import Path
from jsonschema import validate, ValidationError, Draft202012Validator


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_jsonl(path):
    records = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def main():
    base_path = Path(__file__).parent.parent / "data" / "graph"
    schema_path = Path(__file__).parent.parent / "schemas"

    # Load schemas
    node_schema = load_json(schema_path / "node.schema.json")
    edge_schema = load_json(schema_path / "edge.schema.json")
    mention_schema = load_json(schema_path / "mention.schema.json")

    # Load data
    nodes = load_jsonl(base_path / "knowledge.nodes.jsonl")
    edges = load_jsonl(base_path / "knowledge.edges.jsonl")
    grade8_mentions = load_jsonl(base_path / "chem-grade8-all-in-one.mentions.jsonl")
    grade9_mentions = load_jsonl(base_path / "chem-grade9-all-in-one.mentions.jsonl")

    all_mentions = grade8_mentions + grade9_mentions

    print("=" * 60)
    print("SCHEMA VALIDATION")
    print("=" * 60)

    # Validate nodes
    print("\n--- 节点验证 ---")
    node_errors = []
    for i, node in enumerate(nodes, 1):
        try:
            validate(instance=node, schema=node_schema)
        except ValidationError as e:
            node_errors.append((i, node.get("id", "unknown"), str(e.message)))

    if node_errors:
        print(f"❌ 发现 {len(node_errors)} 个节点 schema 错误:")
        for line_num, nid, msg in node_errors[:10]:
            print(f"  行 {line_num} [{nid}]: {msg}")
    else:
        print(f"✓ 所有 {len(nodes)} 个节点 schema 有效")

    # Validate edges
    print("\n--- 边验证 ---")
    edge_errors = []
    for i, edge in enumerate(edges, 1):
        try:
            validate(instance=edge, schema=edge_schema)
        except ValidationError as e:
            edge_errors.append((i, edge.get("id", "unknown"), str(e.message)))

    if edge_errors:
        print(f"❌ 发现 {len(edge_errors)} 个边 schema 错误:")
        for line_num, eid, msg in edge_errors[:10]:
            print(f"  行 {line_num} [{eid}]: {msg}")
    else:
        print(f"✓ 所有 {len(edges)} 条边 schema 有效")

    # Validate mentions
    print("\n--- Mentions 验证 ---")
    mention_errors = []
    for i, mention in enumerate(all_mentions, 1):
        try:
            validate(instance=mention, schema=mention_schema)
        except ValidationError as e:
            mention_errors.append((i, mention.get("id", "unknown"), str(e.message)))

    if mention_errors:
        print(f"❌ 发现 {len(mention_errors)} 个 mention schema 错误:")
        for line_num, mid, msg in mention_errors[:10]:
            print(f"  行 {line_num} [{mid}]: {msg}")
    else:
        print(f"✓ 所有 {len(all_mentions)} 个 mentions schema 有效")

    print("\n" + "=" * 60)
    print("OPTIMIZATION ANALYSIS")
    print("=" * 60)

    # === 分析可能的优化机会 ===

    # 1. 检查边的语义合理性
    print("\n--- 边类型语义检查 ---")

    edge_type_suggestions = []
    for e in edges:
        from_parts = e["from"].split(":")
        to_parts = e["to"].split(":")
        from_type = from_parts[0] if len(from_parts) > 1 else "unknown"
        to_type = to_parts[0] if len(to_parts) > 1 else "unknown"
        etype = e["edge_type"]

        # part_of 通常应该是 从子到父
        if etype == "part_of":
            # substance:air -> concept:mixture 的 part_of 可能语义不精确
            # 因为空气"是一种"混合物，而不是混合物的"一部分"
            if from_type == "substance" and to_type == "concept":
                edge_type_suggestions.append(
                    {
                        "edge": e["id"],
                        "current": "part_of",
                        "suggestion": "related_to",
                        "reason": f"{e['from']} 与 {e['to']} 的关系可能更适合用 related_to",
                    }
                )

    if edge_type_suggestions:
        print("发现可能需要调整的边类型:")
        for s in edge_type_suggestions[:5]:
            print(f"  {s['edge']}: {s['current']} -> {s['suggestion']} ({s['reason']})")
    else:
        print("✓ 边类型语义合理")

    # 2. 检查缺少常用 aliases 的节点
    print("\n--- 别名丰富度检查 ---")

    nodes_missing_aliases = []
    for n in nodes:
        if not n.get("aliases") or len(n.get("aliases", [])) == 0:
            # 某些节点可能不需要别名
            if n["node_type"] in ["substance", "concept"]:
                nodes_missing_aliases.append(n)

    if nodes_missing_aliases:
        print(f"发现 {len(nodes_missing_aliases)} 个可能缺少别名的重要节点:")
        for n in nodes_missing_aliases[:10]:
            print(f"  - {n['id']} ({n['name']})")
    else:
        print("✓ 所有关键节点都有别名")

    # 3. 检查是否有孤立节点（没有边连接）
    print("\n--- 孤立节点检查 ---")

    node_ids = {n["id"] for n in nodes}
    connected_nodes = set()
    for e in edges:
        connected_nodes.add(e["from"])
        connected_nodes.add(e["to"])

    isolated_nodes = node_ids - connected_nodes
    if isolated_nodes:
        print(f"发现 {len(isolated_nodes)} 个孤立节点（无边连接）:")
        for nid in sorted(isolated_nodes)[:10]:
            node = next((n for n in nodes if n["id"] == nid), None)
            if node:
                print(f"  - {nid} ({node['name']})")
    else:
        print("✓ 没有孤立节点")

    # 4. 检查 confidence 分布
    print("\n--- Confidence 分布 ---")

    from collections import Counter

    edge_confidence = Counter(e.get("confidence", 1.0) for e in edges)
    print("边的 confidence 分布:")
    for conf, count in sorted(edge_confidence.items()):
        print(f"  {conf}: {count} 条边")

    # 5. 检查 framework_refs 覆盖率
    print("\n--- Framework 引用覆盖率 ---")

    nodes_with_framework = sum(1 for n in nodes if n.get("framework_refs"))
    edges_with_framework = sum(1 for e in edges if e.get("framework_refs"))

    print(
        f"节点 framework 覆盖率: {nodes_with_framework}/{len(nodes)} ({100 * nodes_with_framework / len(nodes):.1f}%)"
    )
    print(
        f"边 framework 覆盖率: {edges_with_framework}/{len(edges)} ({100 * edges_with_framework / len(edges):.1f}%)"
    )

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    total_errors = len(node_errors) + len(edge_errors) + len(mention_errors)
    print(f"\nSchema 错误总数: {total_errors}")
    print(f"优化建议数量: {len(edge_type_suggestions)}")
    print(f"孤立节点数量: {len(isolated_nodes)}")

    if total_errors == 0:
        print("\n✅ 所有数据符合 schema 规范")
    else:
        print(f"\n⚠️ 发现 {total_errors} 个 schema 错误需要修复")


if __name__ == "__main__":
    main()
