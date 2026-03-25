#!/usr/bin/env python3
"""
Graph Normalization Script
- Detect duplicate nodes
- Detect duplicate edges
- Verify mention references
- Report statistics
"""

import json
from collections import defaultdict
from pathlib import Path


def load_jsonl(path):
    """Load JSONL file and return list of records."""
    records = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def normalize_name(name):
    """Normalize name for comparison (lowercase, strip whitespace)."""
    return name.lower().strip()


def main():
    base_path = Path(__file__).parent.parent / "data" / "graph"

    # Load all files
    print("Loading data files...")
    nodes = load_jsonl(base_path / "knowledge.nodes.jsonl")
    edges = load_jsonl(base_path / "knowledge.edges.jsonl")
    grade8_mentions = load_jsonl(base_path / "chem-grade8-all-in-one.mentions.jsonl")
    grade9_mentions = load_jsonl(base_path / "chem-grade9-all-in-one.mentions.jsonl")

    all_mentions = grade8_mentions + grade9_mentions

    print(f"\n=== 统计信息 ===")
    print(f"节点数: {len(nodes)}")
    print(f"边数: {len(edges)}")
    print(f"八年级 mentions: {len(grade8_mentions)}")
    print(f"九年级 mentions: {len(grade9_mentions)}")
    print(f"总 mentions: {len(all_mentions)}")

    # Build lookup sets
    node_ids = {n["id"] for n in nodes}
    edge_ids = {e["id"] for e in edges}

    # === 节点分析 ===
    print("\n=== 节点分析 ===")

    # Group nodes by type
    nodes_by_type = defaultdict(list)
    for n in nodes:
        nodes_by_type[n["node_type"]].append(n)

    print("\n节点类型分布:")
    for ntype, nlist in sorted(nodes_by_type.items()):
        print(f"  {ntype}: {len(nlist)}")

    # Check for duplicate nodes (same type + name)
    name_type_map = defaultdict(list)
    for n in nodes:
        key = (n["node_type"], normalize_name(n["name"]))
        name_type_map[key].append(n)

    duplicates = {k: v for k, v in name_type_map.items() if len(v) > 1}
    if duplicates:
        print("\n发现同名同类型节点（可能需要合并）:")
        for (ntype, name), nlist in duplicates.items():
            print(f"  类型: {ntype}, 名称: {name}")
            for n in nlist:
                print(f"    - ID: {n['id']}, aliases: {n.get('aliases', [])}")
    else:
        print("\n✓ 未发现同名同类型的重复节点")

    # Check for alias overlaps
    print("\n检查别名重叠:")
    alias_to_nodes = defaultdict(list)
    for n in nodes:
        for alias in n.get("aliases", []):
            alias_to_nodes[(n["node_type"], normalize_name(alias))].append(n)

    alias_conflicts = {k: v for k, v in alias_to_nodes.items() if len(v) > 1}
    if alias_conflicts:
        print("  发现别名指向多个节点:")
        for (ntype, alias), nlist in alias_conflicts.items():
            print(f"    别名 '{alias}' (类型: {ntype}):")
            for n in nlist:
                print(f"      - {n['id']} (name: {n['name']})")
    else:
        print("  ✓ 未发现别名冲突")

    # === 边分析 ===
    print("\n=== 边分析 ===")

    # Check for duplicate edges (same from, to, edge_type)
    edge_signature_map = defaultdict(list)
    for e in edges:
        sig = (e["from"], e["to"], e["edge_type"])
        edge_signature_map[sig].append(e)

    duplicate_edges = {k: v for k, v in edge_signature_map.items() if len(v) > 1}
    if duplicate_edges:
        print("发现重复边（相同 from, to, edge_type）:")
        for (from_id, to_id, etype), elist in duplicate_edges.items():
            print(f"  {from_id} --[{etype}]--> {to_id}")
            for e in elist:
                print(f"    - ID: {e['id']}, confidence: {e.get('confidence', 'N/A')}")
    else:
        print("✓ 未发现重复边")

    # Check for edges with missing endpoints
    print("\n检查边端点:")
    missing_endpoints = []
    for e in edges:
        if e["from"] not in node_ids:
            missing_endpoints.append((e["id"], "from", e["from"]))
        if e["to"] not in node_ids:
            missing_endpoints.append((e["id"], "to", e["to"]))

    if missing_endpoints:
        print("  发现边端点缺失:")
        for eid, direction, missing in missing_endpoints:
            print(f"    - 边 {eid} 的 {direction} 端点 '{missing}' 不存在")
    else:
        print("  ✓ 所有边端点都存在")

    # === Mentions 分析 ===
    print("\n=== Mentions 分析 ===")

    # Check for mentions with missing targets
    print("检查 mentions 目标:")
    missing_targets = []
    for m in all_mentions:
        target_id = m["target_id"]
        target_type = m["target_type"]
        if target_type == "node" and target_id not in node_ids:
            missing_targets.append((m["id"], "node", target_id))
        elif target_type == "edge" and target_id not in edge_ids:
            missing_targets.append((m["id"], "edge", target_id))

    if missing_targets:
        print(f"  发现 {len(missing_targets)} 个 mentions 目标缺失:")
        for mid, ttype, target in missing_targets[:10]:  # 只显示前10个
            print(f"    - {mid} -> {ttype}:{target}")
        if len(missing_targets) > 10:
            print(f"    ... 还有 {len(missing_targets) - 10} 个")
    else:
        print("  ✓ 所有 mentions 目标都存在")

    # === 边类型分析 ===
    print("\n=== 边类型分析 ===")
    edge_types = defaultdict(int)
    for e in edges:
        edge_types[e["edge_type"]] += 1

    for etype, count in sorted(edge_types.items(), key=lambda x: -x[1]):
        print(f"  {etype}: {count}")

    # === 节点来源分析 ===
    print("\n=== 节点来源分析 ===")
    nodes_from_grade8 = set()
    nodes_from_grade9 = set()

    for m in grade8_mentions:
        if m["target_type"] == "node":
            nodes_from_grade8.add(m["target_id"])

    for m in grade9_mentions:
        if m["target_type"] == "node":
            nodes_from_grade9.add(m["target_id"])

    shared_nodes = nodes_from_grade8 & nodes_from_grade9
    print(f"八年级独有节点: {len(nodes_from_grade8 - nodes_from_grade9)}")
    print(f"九年级独有节点: {len(nodes_from_grade9 - nodes_from_grade8)}")
    print(f"共享节点: {len(shared_nodes)}")

    if shared_nodes:
        print("\n共享节点列表:")
        for nid in sorted(shared_nodes):
            # Find node name
            node = next((n for n in nodes if n["id"] == nid), None)
            if node:
                print(f"  - {nid} ({node['name']})")

    # === 潜在问题报告 ===
    print("\n=== 潜在问题汇总 ===")

    issues = []

    if duplicates:
        issues.append(f"发现 {len(duplicates)} 组同名同类型节点")

    if duplicate_edges:
        issues.append(f"发现 {len(duplicate_edges)} 组重复边")

    if missing_endpoints:
        issues.append(f"发现 {len(missing_endpoints)} 个边端点缺失")

    if missing_targets:
        issues.append(f"发现 {len(missing_targets)} 个 mentions 目标缺失")

    if issues:
        for issue in issues:
            print(f"  ⚠ {issue}")
    else:
        print("  ✓ 未发现问题")

    print("\n=== 归一化完成 ===")


if __name__ == "__main__":
    main()
