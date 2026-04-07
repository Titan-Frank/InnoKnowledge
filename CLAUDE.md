# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Knowledge Map Extraction project that transforms chemistry textbook content into structured, evidence-backed knowledge graphs. Uses a Manager-Worker architecture.

## Quick Start with Claude Code

### Process a Single Lesson

```
提取 chem-grade8 的课题 1-1-1

步骤：
1. 读取 .claude/skills/chapter-extract/SKILL.md 了解提取流程
2. 读取教材 data/sources/chem-grade8-all-in-one.md 中课题 1-1-1 的内容
3. 提取节点、边、profiles、mentions、evidence
4. 使用 scripts/insert_batch.py 写入 SQLite
5. 为每个 backbone 节点生成 node_card
6. 运行 scripts/normalize_sqlite.py 归一化
```

### Process Entire Book

```
处理 chem-grade8 全书

按照 .claude/agents/kg-pipeline.md 的流程：
1. 读取 data/outlines/chem-grade8-all-in-one.outline.json 获取课题列表
2. 每个课题使用 Agent tool 启动独立 Task 处理
3. 串行处理，等待每个 Task 完成后再启动下一个
4. 所有课题完成后运行归一化
```

### Key Principles

1. **One lesson per Task** - 每个课题在独立 Task 中处理，避免 context 爆炸
2. **SQLite-first** - 所有数据写入 SQLite，JSONL 只是导出产物
3. **Evidence-backed** - 每个节点/边必须有教材出处

## Data Insertion

使用通用脚本插入数据：

```bash
# 插入节点、边、profiles 等
python scripts/insert_batch.py --data '{"nodes": [...], "edges": [...], ...}'

# 或从文件读取
python scripts/insert_batch.py --input /tmp/batch_data.json
```

### Data Viewing

```bash
# Start web viewer
python scripts/viewer_sqlite_api.py --port 8765
# Access: http://127.0.0.1:8765/viewer/

# Query SQLite directly
sqlite3 storage/knowledge.sqlite "SELECT COUNT(*) FROM nodes;"
sqlite3 storage/knowledge.sqlite "SELECT id, canonical_name FROM nodes ORDER BY created_at DESC LIMIT 10;"
```

### Export & Validation

```bash
# Export from SQLite to JSONL (for external consumers)
python scripts/export_snapshot.py data/main --db storage/knowledge.sqlite --dataset-id main

# Check data consistency
python check_data_consistency.py

# QA validation
python scripts/strict_qa_sqlite.py --dataset-id main

# Graph integrity check
python scripts/check_graph_integrity.py --dataset-id main
```

## Architecture

```
@kg-pipeline (Manager - pure orchestration)
│
├── @outline-reader (generates outline if needed)
│
└── FOR each lesson (sequential, one Task per lesson):
    └── @lesson-processor (Worker - complete workflow)
        ├── /chapter-extract (extract nodes/edges to SQLite)
        ├── @node-expander × N (parallel Tasks for node cards)
        ├── /graph-normalize (deduplication, cycle detection)
        ├── scripts/run_sqlite_batch_pipeline.py (finalize)
        └── @qa-reviewer (quality check)
```

**Critical**: Each lesson MUST be processed in a separate Task. Never process multiple lessons in one context.

## Core Principles

1. **SQLite-first**: `storage/knowledge.sqlite` is the single source of truth. JSONL/JSON files are derived exports only.
2. **Task-per-lesson**: Lessons processed sequentially in isolated Tasks to prevent context explosion.
3. **Evidence-backed**: Every node and edge must have textbook provenance via mentions/evidence.
4. **Retrieval-first**: Retrieve candidates before reasoning; never operate on full graph.

## Storage Structure

```
storage/knowledge.sqlite
├── nodes          # Knowledge nodes
├── edges          # Relationships
├── profiles       # Curriculum profiles (subject/grade-specific)
├── mentions       # Textbook references
├── evidence       # Source excerpts
└── node_cards     # Detailed node documentation

data/
├── outlines/      # Book structure (JSON)
├── frameworks/    # Curriculum frameworks
└── patterns/      # Pattern library

runs/              # Pipeline execution tracking
```

## Critical Constraints

### Do NOT
- Process multiple lessons in one context
- Write directly to JSONL files (write to SQLite only)
- Use deprecated scripts in `/deprecated/` (e.g., `extract_chemistry_*.py`)
- Delete nodes without explicit user instruction

### Always
- Process lessons sequentially via @kg-pipeline
- Write to SQLite via `/chapter-extract` skill or `scripts/extract_lesson_sqlite.py`
- Verify data in SQLite (not JSONL) after operations

## Schema Reference

All schemas in `schemas/v2/`:
- `node.schema.json` - Canonical nodes with `node_kind`, `node_layer`, `learning_modes`
- `edge.schema.json` - Relationships with `edge_type`, `edge_layer`
- `curriculum-profile.schema.json` - Subject/grade-specific projections
- `mention.schema.json` - Textbook location references
- `evidence.schema.json` - Source text excerpts
- `node-card.schema.json` - Detailed node documentation

## Node Types

- `concept` - Abstract ideas, definitions
- `entity` - Named substances, objects (with `node_subkind`: substance, equipment)
- `activity` - Experiments, investigations
- `method` - Reusable operations
- `principle` - Laws, mechanisms
- `representation` - Formulas, diagrams

## Edge Types

**Hierarchical** (no cycles): `is_a`, `instance_of`, `contains`, `part_of`, `prerequisite_for`, `depends_on`, `extends`

**Association** (cycles OK): `explains`, `causes`, `affects`, `uses`, `measures`, `produces`, `consumes`, `has_property`, `related_to`

## Documentation

- `AGENTS.md` - Complete architecture, constraints, and checklists
- `PIPELINE_SAFETY.md` - Safety guidelines for data operations
- `QUICKSTART.md` - 5-minute getting started guide
- `schemas/v2/README.md` - Schema design rationale
- `.claude/GLOSSARY.md` - Terminology definitions
- `.claude/CONVENTIONS.md` - Coding and documentation standards
