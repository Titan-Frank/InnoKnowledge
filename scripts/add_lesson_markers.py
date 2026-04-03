#!/usr/bin/env python3
"""
为教材 Markdown 文件添加 LESSON_START/LESSON_END HTML 注释标记
基于 outline.json 的结构信息
"""

import json
import re
from pathlib import Path


def load_outline(outline_path):
    """加载 outline JSON 文件"""
    with open(outline_path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_lesson_ranges(items):
    """获取每个 lesson 的页码范围"""
    # 只关注 lesson 和 activity（可提取单元）
    extractable_kinds = {"lesson", "activity"}
    units = [item for item in items if item["kind"] in extractable_kinds]

    ranges = []
    for i, unit in enumerate(units):
        start_page = unit["page_start"]

        # 计算结束页码（下一单元的起始页 - 1，或者整个主题结束）
        if i + 1 < len(units):
            end_page = units[i + 1]["page_start"] - 1
        else:
            end_page = 170  # 教材最后一页

        ranges.append(
            {
                "id": unit["id"],
                "kind": unit["kind"],
                "title": unit.get("label", "") + " " + unit["title"]
                if unit.get("label")
                else unit["title"],
                "pages": f"{start_page}-{end_page}",
                "page_start": start_page,
                "page_end": end_page,
                "topic": unit["title"],
            }
        )

    return ranges


def find_lesson_positions(content, ranges):
    """在 Markdown 内容中定位每个 lesson 的位置"""
    lines = content.split("\n")
    positions = []

    for unit in ranges:
        # 构建标题匹配模式
        # 可能的标题格式:
        # # 课题1
        # # 开启化学之门
        # # 跨学科实践活动

        unit_title = unit["topic"]
        pattern1 = rf"^# +{re.escape(unit_title)}\s*$"
        pattern2 = rf"^# +{unit['kind']}.*{re.escape(unit_title)}.*$"

        # 查找标题位置
        for i, line in enumerate(lines):
            if re.match(pattern1, line, re.IGNORECASE) or re.match(
                pattern2, line, re.IGNORECASE
            ):
                positions.append({**unit, "line_number": i, "title_line": line})
                break

    return positions


def mark_lesson_boundaries(content, positions):
    """在内容中插入 LESSON_START/LESSON_END 标记"""
    lines = content.split("\n")

    # 按行号倒序排列，这样插入标记不会影响后续位置
    sorted_positions = sorted(positions, key=lambda x: x["line_number"], reverse=True)

    for i, unit in enumerate(sorted_positions):
        start_line = unit["line_number"]

        # 确定结束位置（下一个单元的标题行，或者文件末尾）
        if i > 0:
            end_line = sorted_positions[i - 1]["line_number"]
        else:
            end_line = len(lines)

        # 构建标记
        start_marker = f'<!-- LESSON_START id="{unit["id"]}" title="{unit["title"]}" pages="{unit["pages"]}" -->'
        end_marker = f'<!-- LESSON_END id="{unit["id"]}" -->'

        # 在标题前插入 START 标记
        lines.insert(start_line, start_marker)

        # 在内容结束后插入 END 标记
        # 找到单位内容后的空行或下一个标题
        lines.insert(end_line + 1, end_marker)

    return "\n".join(lines)


def main():
    # 路径配置
    base_dir = Path("/Users/titan-frank/Documents/hsd/research/Knowledge")
    outline_path = (
        base_dir / "data/outlines/chem-grade8-5-4system-shanghai.outline.json"
    )
    md_path = (
        base_dir
        / "ocr/八年级/初中（五•四学制）_化学_沪科技版_全一册_八年级/hybrid_auto/初中（五•四学制）_化学_沪科技版_全一册_八年级.md"
    )
    output_path = (
        base_dir
        / "ocr/八年级/初中（五•四学制）_化学_沪科技版_全一册_八年级/hybrid_auto/初中（五•四学制）_化学_沪科技版_全一册_八年级_marked.md"
    )

    print(f"加载 outline: {outline_path}")
    outline = load_outline(outline_path)

    print(f"读取教材: {md_path}")
    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()

    print("计算 lesson 页码范围...")
    ranges = get_lesson_ranges(outline["items"])
    print(f"找到 {len(ranges)} 个可提取单元")

    # 打印概览
    print("\n单元列表:")
    for r in ranges:
        print(f"  - {r['title']} (第{r['pages']}页)")

    print("\n定位单元位置...")
    positions = find_lesson_positions(content, ranges)
    print(f"成功定位 {len(positions)} 个单元")

    print("\n插入标记...")
    marked_content = mark_lesson_boundaries(content, positions)

    print(f"保存标记后的文件: {output_path}")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(marked_content)

    print("✅ 完成！")
    print(f"\n生成的标记文件: {output_path}")
    print(f"原始文件保持不变: {md_path}")


if __name__ == "__main__":
    main()
