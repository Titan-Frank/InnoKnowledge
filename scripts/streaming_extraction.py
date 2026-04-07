#!/usr/bin/env python3
"""
流式提取启动器 - 沪科技版化学7本教材课题清单生成器

⚠️ 重要说明：
- extract_lesson_sqlite.py 占位符脚本已被删除
- 实际知识提取请使用 /chapter-extract skill
- 本脚本仅用于生成课题清单和调度计划

使用方法：
1. 运行本脚本生成课题清单
2. 对每个课题使用 /chapter-extract skill 进行提取
   参数：
   - batch-anchor: struct:{book-id}:lesson:{x-y-z}
   - book-md-path: 对应教材的 markdown 路径
   - dataset-id: v4
   - db: storage/knowledge.sqlite
3. 提取完成后调用 /graph-normalize 进行归一化
4. 使用 @qa-reviewer 进行质量验证
"""

import json
import sys
from pathlib import Path
from datetime import datetime

# 教材源文件映射
BOOK_SOURCES = {
    "chem-grade8-all-in-one": "ocr/八年级/初中（五•四学制）_化学_沪科技版_全一册_八年级/hybrid_auto/初中（五•四学制）_化学_沪科技版_全一册_八年级.md",
    "chem-grade9-all-in-one": "ocr/九年级/初中（五•四学制）_化学_沪科技版_全一册_九年级/hybrid_auto/初中（五•四学制）_化学_沪科技版_全一册_九年级.md",
    "chem-senior-required-1": "ocr/高中年级/高中_化学_沪科技版_必修_高中年级/hybrid_auto/高中_化学_沪科技版_必修_高中年级.md",
    "chem-senior-required-2": "ocr/高中年级/高中_化学_沪科技版_高中年级_必修_第二册_化学必修_第二册/hybrid_auto/高中_化学_沪科技版_高中年级_必修_第二册_化学必修_第二册.md",
    "chem-senior-elective-1": "ocr/高中年级/高中_化学_沪科技版_高中年级_选择性必修 1/hybrid_auto/高中_化学_沪科技版_高中年级.md",
    "chem-senior-elective-2": "ocr/高中年级/高中_化学_沪科技版_高中年级_选择性必修2_物质结构与性质_化学选择性必修2_物质结构与性质/hybrid_auto/高中_化学_沪科技版_高中年级_选择性必修2_物质结构与性质_化学选择性必修2_物质结构与性质.md",
    "chem-senior-elective-3": "ocr/高中年级/高中_化学_沪科技版_高中年级_选择性必修3_有机化学基础_化学选择性必修3_有机化学基础/hybrid_auto/高中_化学_沪科技版_高中年级_选择性必修3_有机化学基础_化学选择性必修3_有机化学基础.md",
}


def extract_lessons_from_outline(outline_path):
    """从大纲文件中提取所有课题"""
    with open(outline_path, "r", encoding="utf-8") as f:
        outline = json.load(f)

    lessons = []

    if "items" in outline:
        for item in outline["items"]:
            if item.get("kind") == "lesson":
                lessons.append(
                    {
                        "anchor": item["id"],
                        "title": item["title"],
                        "label": item.get("label", ""),
                        "page_start": item.get("page_start"),
                    }
                )
    elif "structure" in outline:
        structure = outline["structure"]

        def traverse(node):
            if node.get("kind") == "lesson":
                lessons.append(
                    {
                        "anchor": node["id"],
                        "title": node["title"],
                        "label": node.get("label", ""),
                        "page_start": node.get("page_start"),
                    }
                )
            if "children" in node:
                for child in node["children"]:
                    traverse(child)

        for theme in structure:
            traverse(theme)

    return lessons


def process_book(book_id, dry_run=True):
    """处理单本教材中的所有课题"""
    outline_path = f"data/outlines/{book_id}.outline.json"
    book_md_path = BOOK_SOURCES.get(book_id)

    if not Path(outline_path).exists():
        print(f"[错误] 大纲不存在: {outline_path}")
        return []

    if not Path(book_md_path).exists():
        print(f"[错误] 源文件不存在: {book_md_path}")
        return []

    lessons = extract_lessons_from_outline(outline_path)

    print(f"\n📚 处理教材: {book_id}")
    print(f"   源文件: {book_md_path}")
    print(f"   课题数: {len(lessons)}")
    print(f"   处理模式: {'[演习]' if dry_run else '[实际执行]'}")

    processed = []
    for i, lesson in enumerate(lessons, 1):
        print(f"\n   [{i}/{len(lessons)}] 处理课题: {lesson['title']}")
        print(f"       anchor: {lesson['anchor']}")
        print(f"       页码: {lesson['page_start']}")

        # 生成提取任务信息
        # 注意：实际提取需要使用 /chapter-extract skill，而不是命令行脚本
        extract_task = {
            "command": "/chapter-extract",
            "book_md_path": str(Path(book_md_path).resolve()),
            "batch_anchor": lesson["anchor"],
            "dataset_id": "v4",
            "db": str(Path("storage/knowledge.sqlite").resolve()),
        }

        print(f"       提取任务: {lesson['anchor']}")
        print(f"       请使用: /chapter-extract skill")

        if not dry_run:
            print(
                f"       ⚠️ 提示: 请使用 /chapter-extract skill 或启动 Task 调用 chapter-extract"
            )
            print(f"          anchor: {lesson['anchor']}")
            print(f"          book: {book_md_path}")

        processed.append(
            {
                "anchor": lesson["anchor"],
                "title": lesson["title"],
                "status": "ready_for_skill" if not dry_run else "dry_run",
                "extract_task": extract_task,
            }
        )

    return processed


def main():
    import argparse

    parser = argparse.ArgumentParser(description="沪科技版化学7本教材流式提取")
    parser.add_argument("--book", help="指定单个教材ID (默认: 所有7本)")
    parser.add_argument(
        "--dry-run", action="store_true", default=True, help="演习模式 (默认: True)"
    )
    parser.add_argument("--execute", action="store_true", help="实际执行模式")
    args = parser.parse_args()

    dry_run = not args.execute

    print("=" * 80)
    print("沪科技版化学全套7本教材 - 流式提取启动器")
    print("=" * 80)
    print(f"启动时间: {datetime.now().isoformat()}")
    print(f"运行模式: {'[演习]' if dry_run else '[实际执行]'}")
    print()

    # 确定要处理的教材
    if args.book:
        books = [args.book]
    else:
        books = list(BOOK_SOURCES.keys())

    # 处理每本教材
    results = {}
    for book_id in books:
        results[book_id] = process_book(book_id, dry_run=dry_run)

    # 统计
    print("\n" + "=" * 80)
    print("处理统计")
    print("=" * 80)

    total_lessons = 0
    completed_lessons = 0
    failed_lessons = 0

    for book_id, lessons in results.items():
        book_total = len(lessons)
        book_completed = sum(
            1 for l in lessons if l["status"] in ["completed", "dry_run"]
        )
        book_failed = sum(1 for l in lessons if l["status"] == "failed")

        total_lessons += book_total
        completed_lessons += book_completed
        failed_lessons += book_failed

        print(f"{book_id}: {book_completed}/{book_total} 完成, {book_failed} 失败")

    print()
    print(f"总计: {completed_lessons}/{total_lessons} 课题完成")

    if failed_lessons > 0:
        print(f"失败: {failed_lessons} 课题")

    print()
    print("=" * 80)

    # 保存结果
    if not dry_run:
        result_path = (
            f"runs/extraction_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )
        with open(result_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "timestamp": datetime.now().isoformat(),
                    "mode": "actual" if not dry_run else "dry_run",
                    "total_lessons": total_lessons,
                    "completed": completed_lessons,
                    "failed": failed_lessons,
                    "results": results,
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
        print(f"结果已保存: {result_path}")


if __name__ == "__main__":
    main()
