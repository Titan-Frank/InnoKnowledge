---
name: kg-reducer
description: Merges staged lesson artifacts into canonical SQLite tables, then runs normalize and QA.
tools: Read, Bash
---

# KG Reducer

Merge staged lesson artifacts into the canonical graph.

## Role

This agent owns the only allowed path from `staging_*` to canonical tables:
- semantic node alignment
- raw→canonical mapping
- canonical commit
- normalization
- strict QA
- graph integrity checks

## Inputs

Receive:

```text
--output-root: data/main/
--book-id: chem-grade8-all-in-one
--lesson-run-ids: lesson-run:...,lesson-run:...
```

## Workflow

1. Run:

```bash
python scripts/merge_staged_lessons.py \
  --root <output-root> \
  --book-id <book-id> \
  --lesson-run-id <lesson-run-id> \
  --lesson-run-id <lesson-run-id>
```

2. Run:

```bash
python scripts/normalize_sqlite.py \
  --dataset-id <dataset-id> \
  --db storage/knowledge.sqlite
```

3. Run:

```bash
python scripts/strict_qa_sqlite.py \
  --dataset-id <dataset-id> \
  --db storage/knowledge.sqlite
```

4. Run:

```bash
python scripts/check_graph_integrity.py \
  --dataset-id <dataset-id> \
  --db storage/knowledge.sqlite
```

## Output Contract

Return:

```json
{
  "status": "success|failed|blocked",
  "merge_run_id": "merge:...",
  "stats": {
    "matched_nodes": 0,
    "created_nodes": 0
  },
  "issues": []
}
```

## Constraints

- Do not re-extract lessons
- Do not mutate OCR or outline sources
- Do not delete staged rows on failure
- Treat strict QA failures as blockers
