# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Knowledge Map Extraction project that transforms chemistry textbook content into structured, evidence-backed knowledge graphs. Uses a Manager-Worker architecture orchestrated via the `opencode` CLI tool.

## Key Commands

### Run Pipeline (Primary Interface)

```bash
# Interactive TUI (recommended)
opencode

# Process entire book (lessons processed sequentially)
opencode run --agent kg-pipeline "处理 chem-grade8 全书"

# Process single lesson
opencode run --agent kg-pipeline "处理 chem-grade8 的 struct:chem-grade8:lesson:1-1-1"
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
python scripts/export_snapshot.py data/v4 --db storage/knowledge.sqlite --dataset-id v4

# Check data consistency
python check_data_consistency.py

# QA validation
python scripts/strict_qa_sqlite.py --dataset-id v4

# Graph integrity check
python scripts/check_graph_integrity.py --dataset-id v4
```

## Architecture

```
@kg-pipeline (Manager - pure orchestration)
│
├── @outline-reader (generates outline if needed)
│
└── FOR each lesson (sequential, one Task per lesson):
    └── @lesson-processor (Worker - complete workflow)
        ├── $chapter-extract (extract nodes/edges to SQLite)
        ├── @node-expander × N (parallel Tasks for node cards)
        ├── $graph-normalize (deduplication, cycle detection)
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
- Write to SQLite via `$chapter-extract` skill or `scripts/extract_lesson_sqlite.py`
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
- `.opencode/GLOSSARY.md` - Terminology definitions
- `.opencode/CONVENTIONS.md` - Coding and documentation standards
