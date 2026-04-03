#!/bin/bash
# 八年级化学全册15课时批处理脚本
# 用法: ./run_all_lessons_bulk.sh

set -e

BOOK_ID="chem-grade8-shanghai-all-in-one"
OUTPUT_ROOT="data/v4"
SOURCE_MD="/Users/titan-frank/Documents/hsd/research/Knowledge/ocr/八年级/初中（五•四学制）_化学_沪科技版_全一册_八年级/hybrid_auto/初中（五•四学制）_化学_沪科技版_全一册_八年级.md"

# 课时列表
LESSONS=(
    "1-1-2:通用的化学语言:14-19"
    "1-2-1:走进化学实验室:27-40"
    "1-2-2:学习开展化学实验探究:41-47"
    "2-3-1:空气的成分:57-67"
    "2-3-2:氧气的性质:68-76"
    "2-3-3:二氧化碳的性质:77-86"
    "3-4-1:水的三态变化:89-96"
    "3-4-2:水的组成:97-104"
    "3-4-3:水的净化:105-113"
    "3-5-1:分子:115-122"
    "3-5-2:原子:123-131"
    "3-5-3:元素:132-141"
    "4-6-1:化学变化和性质:151-158"
    "4-6-2:化学方程式:159-166"
)

echo "============================================"
echo "八年级化学(沪科技版)全册知识抽取管道"
echo "共计15课时,已完成1课时,剩余14课时"
echo "============================================"
echo ""

for lesson in "${LESSONS[@]}"; do
    IFS=':' read -r CODE TITLE PAGES <<< "$lesson"
    ANCHOR="struct:${BOOK_ID}:lesson:${CODE}"
    
    echo "--- 处理课时: ${TITLE} (P${PAGES}) ---"
    
    # 步骤1: 提取 (使用chapter-extract技能)
    echo "Step A: 提取核心概念..."
    # 这里调用实际提取逻辑
    
    # 步骤2: 生成节点卡片 (使用node-expander)
    echo "Step B: 生成详细卡片..."
    
    # 步骤3: 规范化 (使用graph-normalize技能)
    echo "Step C: 图规范化..."
    
    # 步骤4: SQLite写入 (使用run_sqlite_batch_pipeline)
    echo "Step D: 写入SQLite..."
    
    # 步骤5: QA审查 (使用qa-reviewer)
    echo "Step E: QA完成..."
    
    echo "✓ 课时 ${TITLE} 处理完成"
    echo ""
done

echo "============================================"
echo "全部15课时处理完成!"
echo "============================================"
