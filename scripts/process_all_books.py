#!/usr/bin/env python3
"""
沪科技版化学7本教材知识图谱流式提取启动器
生成51个处理批次并执行
"""

import json
import os
import sys
from pathlib import Path

# 从大纲提取课题列表
def extract_lessons_from_outline(outline_path):
    """从大纲文件中提取所有课题"""
    with open(outline_path, 'r', encoding='utf-8') as f:
        outline = json.load(f)
    
    lessons = []
    
    # 处理不同格式的大纲
    if 'items' in outline:
        # 八年级和选修2、选修3格式
        for item in outline['items']:
            if item.get('kind') == 'lesson':
                lessons.append({
                    'id': item['id'],
                    'title': item['title'],
                    'label': item.get('label', ''),
                    'page_start': item.get('page_start'),
                    'level': item.get('level', 3)
                })
    elif 'structure' in outline:
        # 九年级和必修格式
        structure = outline['structure']
        
        def traverse(node):
            if node.get('kind') == 'lesson':
                lessons.append({
                    'id': node['id'],
                    'title': node['title'],
                    'label': node.get('label', ''),
                    'page_start': node.get('page_start'),
                    'level': 3
                })
            if 'children' in node:
                for child in node['children']:
                    traverse(child)
        
        for theme in structure:
            traverse(theme)
    
    return lessons

# 教材配置
BOOKS_CONFIG = [
    {
        "book_id": "chem-grade8-all-in-one",
        "title": "八年级全一册",
    },
    {
        "book_id": "chem-grade9-all-in-one",
        "title": "九年级全一册",
    },
    {
        "book_id": "chem-senior-required-1",
        "title": "高中必修第一册",
    },
    {
        "book_id": "chem-senior-required-2",
        "title": "高中必修第二册",
    },
    {
        "book_id": "chem-senior-elective-1",
        "title": "选择性必修1 化学反应原理",
    },
    {
        "book_id": "chem-senior-elective-2",
        "title": "选择性必修2 物质结构与性质",
    },
    {
        "book_id": "chem-senior-elective-3",
        "title": "选择性必修3 有机化学基础",
    }
]

def main():
    print("=" * 80)
    print("沪科技版化学全套教材 - 课题清单生成")
    print("=" * 80)
    print()
    
    all_batches = []
    
    for book in BOOKS_CONFIG:
        book_id = book['book_id']
        outline_path = f"data/outlines/{book_id}.outline.json"
        
        if not os.path.exists(outline_path):
            print(f"[跳过] 大纲不存在: {outline_path}")
            continue
        
        lessons = extract_lessons_from_outline(outline_path)
        
        print(f"📚 {book['title']} ({book_id})")
        print(f"   大纲: {outline_path}")
        print(f"   课题数: {len(lessons)}")
        print()
        
        for lesson in lessons:
            batch = {
                "book_id": book_id,
                "book_title": book['title'],
                "lesson_id": lesson['id'],
                "lesson_title": lesson['title'],
                "lesson_label": lesson['label'],
                "page_start": lesson['page_start']
            }
            all_batches.append(batch)
        
        print(f"   课题列表:")
        for i, lesson in enumerate(lessons, 1):
            print(f"     {i}. {lesson['label']} - {lesson['title']} (p.{lesson['page_start']})")
        print()
    
    # 保存处理清单
    batch_list_path = "runs/extraction_batch_list.json"
    os.makedirs("runs", exist_ok=True)
    
    with open(batch_list_path, 'w', encoding='utf-8') as f:
        json.dump({
            "total_batches": len(all_batches),
            "books": len(BOOKS_CONFIG),
            "batches": all_batches
        }, f, ensure_ascii=False, indent=2)
    
    print("=" * 80)
    print(f"处理清单已生成: {batch_list_path}")
    print(f"总计: {len(all_batches)} 个课题批次")
    print("=" * 80)
    
    return all_batches

if __name__ == "__main__":
    batches = main()
    
    # 输出统计
    print("\n📊 统计摘要:")
    book_counts = {}
    for batch in batches:
        book_id = batch['book_id']
        book_counts[book_id] = book_counts.get(book_id, 0) + 1
    
    for book_id, count in sorted(book_counts.items()):
        print(f"  {book_id}: {count} 个课题")
    print(f"  总计: {len(batches)} 个课题")
