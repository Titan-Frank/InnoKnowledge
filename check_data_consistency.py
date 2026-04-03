#!/usr/bin/env python3
"""
数据一致性检查脚本
每次提取后运行，确保 SQLite 和 JSONL 同步
"""

import json
import sqlite3
import sys
from pathlib import Path


def check_consistency(db_path="storage/knowledge.sqlite", data_root="data/v4"):
    """检查 SQLite 和 JSONL 的一致性"""

    print("=" * 60)
    print("数据一致性检查")
    print("=" * 60)

    # 读取 SQLite
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    sqlite_counts = {
        "nodes": conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0],
        "edges": conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0],
        "profiles": conn.execute("SELECT COUNT(*) FROM profiles").fetchone()[0],
        "mentions": conn.execute("SELECT COUNT(*) FROM mentions").fetchone()[0],
        "evidence": conn.execute("SELECT COUNT(*) FROM evidence").fetchone()[0],
    }

    # 读取 JSONL
    graph_dir = Path(data_root) / "graph"
    jsonl_counts = {}

    for file_path in graph_dir.glob("*.jsonl"):
        if "knowledge" in file_path.name:
            entity_type = file_path.stem.replace("knowledge.", "").replace(".jsonl", "")
            with open(file_path) as f:
                count = sum(1 for _ in f)
                jsonl_counts[entity_type] = count

    # 检查 profiles
    profiles_file = Path(data_root) / "profiles" / "knowledge.profiles.jsonl"
    if profiles_file.exists():
        with open(profiles_file) as f:
            jsonl_counts["profiles"] = sum(1 for _ in f)

    # 对比
    print("\n数量对比:")
    print(f"{'类型':<15} {'SQLite':<10} {'JSONL':<10} {'状态':<10}")
    print("-" * 50)

    all_match = True
    for entity in ["nodes", "edges", "profiles", "mentions", "evidence"]:
        sqlite_count = sqlite_counts.get(entity, 0)
        jsonl_count = jsonl_counts.get(entity, 0)
        status = "✅ 一致" if sqlite_count == jsonl_count else "❌ 不一致"

        if sqlite_count != jsonl_count:
            all_match = False

        print(f"{entity:<15} {sqlite_count:<10} {jsonl_count:<10} {status:<10}")

    print("\n" + "=" * 60)

    if all_match:
        print("✅ 所有数据一致！")
        return 0
    else:
        print("❌ 发现不一致！当前仓库不再支持 JSONL → SQLite 旧导入链。")
        print("\n建议处理方式:")
        print("  1. 以 SQLite 为准，先检查是否有脚本绕过 SQLite 直接写了导出文件。")
        print("  2. 如果 SQLite 数据正确，删除旧导出并重新从 SQLite 导出快照。")
        print("  3. 如果 SQLite 数据缺失，重新运行当前 SQLite-native lesson pipeline。")
        return 1


if __name__ == "__main__":
    exit(check_consistency())
