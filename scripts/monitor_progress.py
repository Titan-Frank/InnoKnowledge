#!/usr/bin/env python3
"""
处理进度监控脚本 - 实时监控7本教材的处理状态
"""

import sqlite3
import json
from pathlib import Path
from datetime import datetime

def check_database_stats():
    """检查SQLite数据库统计"""
    db_path = "storage/knowledge.sqlite"
    
    if not Path(db_path).exists():
        print(f"[警告] 数据库不存在: {db_path}")
        return None
    
    stats = {}
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # 各表行数
        tables = ['nodes', 'edges', 'profiles', 'mentions', 'evidence', 'node_cards']
        for table in tables:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                stats[table] = cursor.fetchone()[0]
            except:
                stats[table] = 0
        
        conn.close()
        return stats
        
    except Exception as e:
        print(f"[错误] 数据库查询失败: {e}")
        return None

def check_manifests():
    """检查所有教材的manifest文件"""
    manifests = {}
    runs_dir = Path("runs")
    
    if not runs_dir.exists():
        return manifests
    
    for manifest_file in runs_dir.glob("*.pipeline.json"):
        try:
            with open(manifest_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            book_id = data.get('book_id', manifest_file.stem.replace('.pipeline', ''))
            completed = sum(1 for b in data.get('batches', []) if b.get('status') == 'completed')
            total = len(data.get('batches', []))
            
            manifests[book_id] = {
                'total': total,
                'completed': completed,
                'status': data.get('status', 'unknown'),
                'progress': f"{completed}/{total} ({completed/total*100:.1f}%)" if total > 0 else "N/A"
            }
        except Exception as e:
            print(f"[警告] 无法读取 manifest: {manifest_file}")
    
    return manifests

def main():
    print("=" * 80)
    print("沪科技版化学教材处理进度监控")
    print("=" * 80)
    print(f"检查时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    # 检查manifest
    manifests = check_manifests()
    
    print("【教材处理进度】")
    print("-" * 80)
    
    books = [
        "chem-grade8-all-in-one",
        "chem-grade9-all-in-one", 
        "chem-senior-required-1",
        "chem-senior-required-2",
        "chem-senior-elective-1",
        "chem-senior-elective-2",
        "chem-senior-elective-3"
    ]
    
    total_completed = 0
    total_lessons = 0
    
    for book_id in books:
        manifest = manifests.get(book_id, {'completed': 0, 'total': 0, 'progress': '0/0 (0%)'})
        total_completed += manifest.get('completed', 0)
        total_lessons += manifest.get('total', 0)
        
        status = manifest.get('status', 'pending')
        status_icon = "✅" if status == "completed" else "⏳" if status == "in_progress" else "⭕"
        
        completed = manifest.get('completed', 0)
        total = manifest.get('total', 0)
        
        if total > 0:
            progress_bar_length = 20
            filled = int(completed / total * progress_bar_length)
            bar = "█" * filled + "░" * (progress_bar_length - filled)
            pct = completed / total * 100
        else:
            bar = "░" * 20
            pct = 0
        
        print(f"{status_icon} {book_id[:40]:<40} | {bar} | {completed:>3}/{total:<3} ({pct:>5.1f}%)")
    
    print("-" * 80)
    if total_lessons > 0:
        overall_pct = total_completed / total_lessons * 100
        print(f"总计: {total_completed}/{total_lessons} 课题完成 ({overall_pct:.1f}%)")
    else:
        print("总计: 0/0 课题完成")
    print()
    
    # 检查数据库统计
    stats = check_database_stats()
    if stats:
        print("【数据库统计】")
        print("-" * 80)
        print(f"Nodes:       {stats.get('nodes', 0):>5}")
        print(f"Edges:       {stats.get('edges', 0):>5}")
        print(f"Profiles:    {stats.get('profiles', 0):>5}")
        print(f"Mentions:    {stats.get('mentions', 0):>5}")
        print(f"Evidence:    {stats.get('evidence', 0):>5}")
        print(f"Node Cards:  {stats.get('node_cards', 0):>5}")
        print()
    
    print("=" * 80)

if __name__ == "__main__":
    main()
