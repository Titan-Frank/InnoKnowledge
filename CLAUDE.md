# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Knowledge Map Extraction project that transforms chemistry textbook content into structured, evidence-backed knowledge graphs. Uses a Manager-Worker architecture with staging/canonical two-phase writes.

## Development Commands

### Infrastructure

```bash
# Start PostgreSQL (with pgvector extension)
docker compose up -d

# Default connection
DATABASE_URL=postgresql://okm:okm@localhost:5432/knowledge
```

### Web Viewer (TypeScript monorepo)

```bash
npm install                  # Install all workspace dependencies
npm run dev                  # Hono API (tsx watch) + Vite HMR viewer concurrently
npm run build                # Build server + viewer
npm run serve                # Production: build + start single-process server
npm run check                # TypeScript type-check all workspaces

# Endpoints:
# API:    http://127.0.0.1:8765/api/health
# Viewer: http://127.0.0.1:5173/viewer/ (dev) or http://127.0.0.1:8765/viewer/ (prod)
```

### Python Pipeline Scripts

```bash
# Staging: write lesson extraction to staging tables (auto-embed)
python scripts/store_lesson_staging.py \
  --root data/main --book-id chem-grade8 \
  --batch-anchor struct:chem-grade8:lesson:1-1-1 \
  --nodes-json '<json>' --edges-json '<json>' --profiles-json '<json>' \
  --mentions-json '<json>' --evidence-json '<json>' --node-cards-json '<json>'

# Skip embedding (offline / no API)
python scripts/store_lesson_staging.py ... --no-embed

# Merge: staging → canonical (semantic alignment + dedup)
python scripts/merge_staged_lessons.py --root data/main --book-id chem-grade8 --lesson-run-id <id>
python scripts/merge_staged_lessons.py ... --dry-run  # preview without writing

# Normalize: dedup, cycle detection, isolated node resolution
python scripts/normalize.py --dataset-id main

# Validation
python scripts/strict_qa.py --dataset-id main
python scripts/check_graph_integrity.py --dataset-id main
python scripts/check_graph_integrity.py --dataset-id main --fail-on-cycles

# Utilities
python scripts/retrieve_candidates.py --mode hybrid --dataset-id main  # semantic retrieval
python scripts/backfill_embeddings.py --dataset-id main                # regenerate embeddings
python scripts/cluster_nodes.py --dataset-id main                      # community detection + PCA layout
python scripts/migrate_sqlite_to_pg.py                                 # legacy migration
```

### Direct PostgreSQL Queries

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM nodes;"
psql "$DATABASE_URL" -c "SELECT id, canonical_name FROM nodes ORDER BY created_at DESC LIMIT 10;"
```

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
7. 运行 scripts/normalize.py 归一化
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

## Architecture

### Pipeline (Manager-Worker-Reducer)

```
@kg-pipeline (Manager - pure orchestration, no business logic)
│
├── @outline-reader (generates outline if needed)
│
├── FOR each lesson (one Task per lesson):
│   └── @lesson-processor (Worker - staging workflow)
│       ├── /chapter-extract (extract nodes/edges/evidence)
│       ├── @node-expander × N (parallel Tasks for node cards)
│       └── scripts/store_lesson_staging.py (auto-embed + write staging)
│
├── @kg-reducer (merge staging → canonical, serial only)
│   ├── scripts/merge_staged_lessons.py (semantic alignment)
│   ├── scripts/normalize.py (deduplication, cycle detection)
│   ├── scripts/strict_qa.py (quality check)
│   └── scripts/check_graph_integrity.py (integrity check)
│
└── @qa-reviewer (optional read-only review)
```

**Critical**: Each lesson MUST be processed in a separate Task. Never process multiple lessons in one context.

### Web Viewer (TypeScript monorepo)

```
packages/
├── types/     # Shared API type definitions
├── server/    # Hono + postgres (pg) API server
│   └── src/
│       ├── db/        # Connection + queries
│       ├── routes/    # health, bundle, meta, node-card, search
│       ├── services/  # embedding service
│       └── data/      # frameworks, patterns, outlines
└── viewer/    # Vite + React + Sigma.js + Graphology
    └── src/
        ├── graph/     # Graphology adapters, layout, visibility, presentation
        ├── store/     # Zustand stores (graphStore, types)
        ├── hooks/     # Data loading, node card, boot data, Sigma
        └── components/ # AppShell, Sidebar, DetailPanel, GraphStage, etc.
```

### Storage (PostgreSQL)

All data lives in PostgreSQL via `DATABASE_URL`. JSONL/JSON files are derived exports only.

**Canonical tables**: `nodes`, `edges`, `profiles`, `mentions`, `evidence`, `node_cards`, `node_terms`, `evidence_links`, `datasets`, `source_artifacts`

**Staging tables**: `staging_nodes`, `staging_edges`, `staging_profiles`, `staging_mentions`, `staging_evidence`, `staging_node_cards`

**Operational tables**: `lesson_runs`, `merge_runs`, `canonical_node_map`, `batch_runtime_records`, `retrieval_candidates`, `relation_proposals`, `review_queue`, `profile_textbooks`

PG schema: `schemas/pg/knowledge_store.sql`

## Core Principles

1. **PostgreSQL-first**: PostgreSQL is the single source of truth (via `DATABASE_URL`). JSONL/JSON files are derived exports only.
2. **Task-per-lesson**: Lessons processed in isolated Tasks to prevent context explosion.
3. **Evidence-backed**: Every node and edge must have textbook provenance via mentions/evidence.
4. **Retrieval-first**: Retrieve candidates before reasoning; never operate on full graph.
5. **Staging/canonical separation**: Lesson workers write only `staging_*` tables. Only `@kg-reducer` merges into canonical tables.

## Embedding

Nodes are automatically embedded via `scripts/embedding_client.py` during staging:

- **Model**: `Qwen/Qwen3-Embedding-4B` (2560-dim, Chinese-optimized)
- **Auth**: `EMBEDDING_API_KEY` environment variable (Bearer token)
- **Storage**: `embedding vector(2560)` column via pgvector extension
- **Auto-embed**: `store_lesson_staging.py --embed` (default on)
- **Text composition**: `canonical_name + definition + aliases`
- **Usage in pipeline**:
  - `merge_staged_lessons.py`: pgvector `<=>` operator for semantic node alignment (`--embedding-threshold 0.92`)
  - `retrieve_candidates.py`: vector channel via pgvector for semantic retrieval (`--mode hybrid` or `--mode vector`)

If the embedding server is unreachable, the pipeline continues with NULL embeddings — no crash, degraded merge accuracy only.

## Critical Constraints

### Do NOT
- Process multiple lessons in one context
- Write directly to JSONL files (write to PostgreSQL only)
- Use deprecated scripts in `/deprecated/` (e.g., `extract_chemistry_*.py`)
- Delete nodes without explicit user instruction
- Write canonical tables directly from lesson workers (use staging tables)
- Let multiple workers write canonical tables concurrently

### Always
- Process lessons via @kg-pipeline with one isolated Task per lesson
- Keep lesson extraction parallelism limited to staging writes
- Write to staging via `scripts/store_lesson_staging.py`
- Merge staging to canonical via `scripts/merge_staged_lessons.py`
- Verify data in PostgreSQL (not JSONL) after operations

## Schema Reference

JSON schemas in `schemas/v2/`:
- `node.schema.json` - Canonical nodes with `node_kind`, `node_layer`, `learning_modes`
- `edge.schema.json` - Relationships with `edge_type`, `edge_layer`
- `curriculum-profile.schema.json` - Subject/grade-specific projections
- `mention.schema.json` - Textbook location references
- `evidence.schema.json` - Source text excerpts
- `node-card.schema.json` - Detailed node documentation

Node types: `concept`, `entity` (subkinds: substance, equipment), `activity`, `method`, `principle`, `representation`

Edge types — **Hierarchical** (no cycles): `is_a`, `instance_of`, `contains`, `part_of`, `prerequisite_for`, `depends_on`, `extends`. **Association** (cycles OK): `explains`, `causes`, `affects`, `uses`, `measures`, `produces`, `consumes`, `has_property`, `related_to`

## Documentation

- `AGENTS.md` - Complete architecture, constraints, and checklists
- `CHANGELOG.md` - Version history and change log
- `schemas/v2/README.md` - Schema design rationale
- `.claude/GLOSSARY.md` - Terminology definitions
- `.claude/CONVENTIONS.md` - Coding and documentation standards
