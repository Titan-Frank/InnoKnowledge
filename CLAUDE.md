# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Knowledge Map Extraction project that transforms chemistry textbook content into structured, evidence-backed knowledge graphs. Uses a Manager-Worker architecture with staging/canonical two-phase writes.

## Quick Start with Claude Code

### Process a Single Lesson

```
提取 chem-grade8 的课题 1-1-1

步骤：
1. 读取 .claude/skills/chapter-extract/SKILL.md 了解提取流程
2. 读取教材 ocr/ 目录下对应教材的 markdown 文件中课题 1-1-1 的内容
3. 提取节点、边、profiles、mentions、evidence
4. 为每个 backbone 节点生成 provisional node_card
5. 使用 scripts/store_lesson_staging.py 一次性写入完整 staging bundle（自动生成 embedding）
6. 使用 scripts/merge_staged_lessons.py 合并到 canonical 表
7. 运行 scripts/normalize_sqlite.py 归一化
```

### Process Entire Book

```
处理 chem-grade8 全书

按照 .claude/agents/kg-pipeline.md 的流程：
1. 读取 data/outlines/chem-grade8-all-in-one.outline.json 获取课题列表
2. 每个课题使用 Agent tool 启动独立 Task 处理
3. 课题 Task 可以并行运行，但每个 Task 只处理一个课题并只写 staging
4. 所有课题 staging 完成后运行 @kg-reducer 串行合并到 canonical
```

### Key Principles

1. **One lesson per Task** - 每个课题在独立 Task 中处理，避免 context 爆炸
2. **SQLite-first** - 所有数据写入 SQLite，JSONL 只是导出产物
3. **Evidence-backed** - 每个节点/边必须有教材出处
4. **Staging-first** - 先写 staging 表，再经 reducer 合并到 canonical 表

## Data Insertion

### Lesson Staging (推荐路径)

```bash
# 提取的课题数据写入 staging 表（自动生成 embedding）
python scripts/store_lesson_staging.py \
  --root data/main \
  --book-id chem-grade8 \
  --batch-anchor struct:chem-grade8:lesson:1-1-1 \
  --nodes-json '<json>' \
  --edges-json '<json>' \
  --profiles-json '<json>' \
  --mentions-json '<json>' \
  --evidence-json '<json>' \
  --node-cards-json '<json>'

# 跳过 embedding 生成（离线或无 API 时）
python scripts/store_lesson_staging.py ... --no-embed
```

### Canonical Merge

```bash
# 将 staging 数据合并到 canonical 表（语义对齐 + 去重）
python scripts/merge_staged_lessons.py \
  --root data/main \
  --book-id chem-grade8 \
  --lesson-run-id <lesson-run-id>

# Dry run 查看合并结果但不写入
python scripts/merge_staged_lessons.py ... --dry-run
```

### Data Viewing

```bash
# Start web viewer (TypeScript)
npm run dev
# Server: http://127.0.0.1:8765/viewer/
# Viewer dev: http://127.0.0.1:5173/viewer/

# Legacy Python viewer (still available)
python scripts/viewer_sqlite_api.py --port 8766

# Query SQLite directly
sqlite3 storage/knowledge.sqlite "SELECT COUNT(*) FROM nodes;"
sqlite3 storage/knowledge.sqlite "SELECT id, canonical_name FROM nodes ORDER BY created_at DESC LIMIT 10;"
```

### Export & Validation

```bash
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
├── FOR each lesson (one Task per lesson):
│   └── @lesson-processor (Worker - staging workflow)
│       ├── /chapter-extract (extract nodes/edges/evidence)
│       ├── @node-expander × N (parallel Tasks for node cards)
│       └── scripts/store_lesson_staging.py (auto-embed + write staging)
│
├── @kg-reducer (merge staging → canonical)
│   ├── scripts/merge_staged_lessons.py (semantic alignment)
│   ├── scripts/normalize_sqlite.py (deduplication, cycle detection)
│   ├── scripts/strict_qa_sqlite.py (quality check)
│   └── scripts/check_graph_integrity.py (integrity check)
│
└── @qa-reviewer (optional read-only review)
```

**Critical**: Each lesson MUST be processed in a separate Task. Never process multiple lessons in one context.

## Core Principles

1. **SQLite-first**: `storage/knowledge.sqlite` is the single source of truth. JSONL/JSON files are derived exports only.
2. **Task-per-lesson**: Lessons processed in isolated Tasks to prevent context explosion.
3. **Evidence-backed**: Every node and edge must have textbook provenance via mentions/evidence.
4. **Retrieval-first**: Retrieve candidates before reasoning; never operate on full graph.
5. **Staging/canonical separation**: Lesson workers write only `staging_*` tables. Only `@kg-reducer` merges into canonical tables.

## Embedding

Nodes are automatically embedded via `scripts/embedding_client.py` during staging:

- **Model**: `text-embedding-bge-large-zh-v1.5` (1024-dim, Chinese-optimized)
- **API**: `http://10.11.20.254:1234/v1/embeddings`
- **Auto-embed**: `store_lesson_staging.py --embed` (default on)
- **Text composition**: `canonical_name + definition + aliases`
- **Usage in pipeline**:
  - `merge_staged_lessons.py`: cosine similarity for semantic node alignment (`--embedding-threshold 0.92`)
  - `retrieve_candidates.py`: vector channel for semantic retrieval (`--mode hybrid` or `--mode vector`)

If the embedding server is unreachable, the pipeline continues with empty embeddings — no crash, degraded merge accuracy only.

## Storage Structure

```
storage/knowledge.sqlite
├── nodes            # Canonical knowledge nodes (with embedding_json)
├── edges            # Relationships
├── profiles         # Curriculum profiles (subject/grade-specific)
├── mentions         # Textbook references
├── evidence         # Source excerpts
├── node_cards       # Detailed node documentation
├── lesson_runs      # Lesson processing tracking
├── staging_nodes    # Staging: pre-merge node candidates
├── staging_edges    # Staging: pre-merge edge candidates
├── staging_profiles # Staging: pre-merge profile candidates
├── staging_mentions # Staging: pre-merge mention candidates
├── staging_evidence # Staging: pre-merge evidence candidates
└── staging_node_cards # Staging: pre-merge node card candidates

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
- Write canonical tables directly from lesson workers (use staging tables)

### Always
- Process lessons via @kg-pipeline with one isolated Task per lesson
- Keep lesson extraction parallelism limited to staging writes
- Write to staging via `scripts/store_lesson_staging.py`
- Merge staging to canonical via `scripts/merge_staged_lessons.py`
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
- `CHANGELOG.md` - Version history and change log
- `schemas/v2/README.md` - Schema design rationale
- `.claude/GLOSSARY.md` - Terminology definitions
- `.claude/CONVENTIONS.md` - Coding and documentation standards
