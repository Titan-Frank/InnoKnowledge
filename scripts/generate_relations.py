#!/usr/bin/env python3
"""补充抽取知识关系"""

import json
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict


def load_nodes():
    """加载所有节点"""
    nodes_path = Path("data/v5/graph/knowledge.nodes.jsonl")
    nodes = []
    node_by_lesson = defaultdict(list)

    with open(nodes_path, "r", encoding="utf-8") as f:
        for line in f:
            node = json.loads(line.strip())
            nodes.append(node)

    return nodes


def load_evidence():
    """加载证据"""
    evidence_path = Path(
        "data/v5/graph/chem-senior-selective1-shanghai-tech.evidence.jsonl"
    )
    evidence = []

    with open(evidence_path, "r", encoding="utf-8") as f:
        for line in f:
            ev = json.loads(line.strip())
            evidence.append(ev)

    return evidence


def load_existing_edges():
    """加载现有边"""
    edges_path = Path("data/v5/graph/knowledge.edges.jsonl")
    existing_edges = set()

    if edges_path.exists():
        with open(edges_path, "r", encoding="utf-8") as f:
            for line in f:
                edge = json.loads(line.strip())
                existing_edges.add((edge["from"], edge["to"], edge["edge_type"]))

    return existing_edges


def infer_relations(nodes, evidence, existing_edges):
    """推断关系"""
    new_edges = []

    # 构建节点查找表
    node_map = {n["id"]: n for n in nodes}

    # 按课时分组证据
    evidence_by_lesson = defaultdict(list)
    for ev in evidence:
        lesson_code = ev["id"].split(":")[2]
        evidence_by_lesson[lesson_code].append(ev)

    # 根据知识点名称和类型推断关系
    relation_rules = [
        # 化学反应热效应相关
        (["concept:enthalpy", "concept:enthalpy-change"], "related_to"),
        (["concept:enthalpy-change", "concept:reaction-heat"], "related_to"),
        (["concept:reaction-heat", "concept:exothermic-reaction"], "related_to"),
        (["concept:reaction-heat", "concept:endothermic-reaction"], "related_to"),
        (
            ["concept:exothermic-reaction", "concept:endothermic-reaction"],
            "contrasts_with",
        ),
        (
            ["principle:first-law-of-thermodynamics", "concept:internal-energy"],
            "explains",
        ),
        (["principle:first-law-of-thermodynamics", "concept:heat"], "explains"),
        (["principle:hess-law", "concept:enthalpy-change"], "explains"),
        (["method:enthalpy-calculation", "concept:enthalpy-change"], "measures"),
        # 化学平衡相关
        (
            ["concept:chemical-equilibrium", "concept:equilibrium-constant"],
            "has_property",
        ),
        (["concept:chemical-equilibrium", "concept:equilibrium-shift"], "has_property"),
        (["principle:le-chatelier-principle", "concept:equilibrium-shift"], "explains"),
        (["concept:equilibrium-shift", "concept:concentration-effect"], "includes"),
        (["concept:equilibrium-shift", "concept:pressure-effect"], "includes"),
        (["concept:equilibrium-shift", "concept:temperature-effect"], "includes"),
        # 反应速率相关
        (["concept:reaction-rate", "concept:activation-energy"], "depends_on"),
        (["concept:reaction-rate", "concept:catalyst"], "affected_by"),
        (["concept:activation-energy", "concept:catalyst"], "related_to"),
        (["concept:collision-theory", "concept:reaction-rate"], "explains"),
        # 电化学相关
        (["concept:galvanic-cell", "concept:anode"], "has_component"),
        (["concept:galvanic-cell", "concept:cathode"], "has_component"),
        (["concept:anode", "concept:cathode"], "contrasts_with"),
        (["concept:electrolysis-cell", "concept:anode-electrolysis"], "has_component"),
        (
            ["concept:electrolysis-cell", "concept:cathode-electrolysis"],
            "has_component",
        ),
        # 酸碱平衡相关
        (["concept:acidity-basicity", "concept:ph-scale"], "measured_by"),
        (["concept:ionization-equilibrium", "concept:weak-acid"], "applies_to"),
        (["concept:ionization-equilibrium", "concept:weak-base"], "applies_to"),
        (["concept:salt-hydrolysis", "concept:buffer-solution"], "related_to"),
        # 热力学相关
        (["concept:entropy", "concept:gibbs-free-energy"], "related_to"),
        (["concept:gibbs-free-energy", "concept:spontaneity-criteria"], "determines"),
        (["principle:gibbs-equation", "concept:gibbs-free-energy"], "defines"),
        # 前置关系
        (["concept:internal-energy", "concept:enthalpy"], "prerequisite_for"),
        (["concept:enthalpy", "concept:enthalpy-change"], "prerequisite_for"),
        (["concept:enthalpy-change", "concept:reaction-heat"], "prerequisite_for"),
        (
            ["concept:chemical-equilibrium", "concept:equilibrium-constant"],
            "prerequisite_for",
        ),
        (["concept:reaction-rate", "concept:reaction-mechanism"], "prerequisite_for"),
    ]

    # 生成边
    edge_count = 0
    for (from_id, to_id), edge_type in relation_rules:
        if from_id in node_map and to_id in node_map:
            edge_key = (from_id, to_id, edge_type)
            if edge_key not in existing_edges:
                from_node = node_map[from_id]
                to_node = node_map[to_id]

                # 确定边的层级
                edge_layer = "backbone"
                if (
                    from_node["node_layer"] == "support"
                    or to_node["node_layer"] == "support"
                ):
                    edge_layer = "support"

                # 查找相关证据
                evidence_refs = []
                for ev in evidence:
                    if (
                        from_id.split(":")[1] in ev["id"]
                        or to_id.split(":")[1] in ev["id"]
                    ):
                        evidence_refs.append(ev["id"])
                        if len(evidence_refs) >= 2:
                            break

                edge = {
                    "id": f"edge:{from_id.split(':')[1]}-{to_id.split(':')[1]}-{edge_type}",
                    "edge_type": edge_type,
                    "edge_layer": edge_layer,
                    "backbone_expand": (edge_layer == "support"),
                    "from": from_id,
                    "to": to_id,
                    "directionality": "directed",
                    "confidence": 0.9,
                    "source_refs": evidence_refs[:2],
                    "properties": {},
                    "status": "active",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }

                new_edges.append(edge)
                existing_edges.add(edge_key)
                edge_count += 1

    return new_edges


def main():
    print("加载节点...")
    nodes = load_nodes()
    print(f"找到 {len(nodes)} 个节点")

    print("\n加载证据...")
    evidence = load_evidence()
    print(f"找到 {len(evidence)} 条证据")

    print("\n加载现有边...")
    existing_edges = load_existing_edges()
    print(f"找到 {len(existing_edges)} 条现有边")

    print("\n推断新关系...")
    new_edges = infer_relations(nodes, evidence, existing_edges)
    print(f"生成了 {len(new_edges)} 条新边")

    if new_edges:
        print("\n写入边文件...")
        edges_path = Path("data/v5/graph/knowledge.edges.jsonl")

        # 读取现有边
        all_edges = []
        if edges_path.exists():
            with open(edges_path, "r", encoding="utf-8") as f:
                for line in f:
                    all_edges.append(json.loads(line.strip()))

        # 添加新边
        all_edges.extend(new_edges)

        # 写回文件
        with open(edges_path, "w", encoding="utf-8") as f:
            for edge in all_edges:
                f.write(json.dumps(edge, ensure_ascii=False) + "\n")

        print(f"\n✅ 总边数: {len(all_edges)}")


if __name__ == "__main__":
    main()
