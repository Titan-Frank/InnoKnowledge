---
name: chapter-extract
description: Extracts one lesson or small page range into lesson-local staged artifacts. Use when processing textbook content for knowledge extraction.
user-invocable: true
---

# Chapter Extract

## Single Lesson Scope Only

Process **exactly one lesson** and stop.

This skill returns lesson-local artifacts only. It does **not** commit canonical graph updates.

## Workflow

### Phase 1: Pre-flight

1. Read `../../AGENTS.md`
2. Read `../../GLOSSARY.md`
3. Resolve `--output-root`
4. Verify `--batch-anchor`
5. Check SQLite is accessible
6. Read required schemas:
   - `schemas/v2/node.schema.json`
   - `schemas/v2/edge.schema.json`
   - `schemas/v2/curriculum-profile.schema.json`
   - `schemas/v2/mention.schema.json`
   - `schemas/v2/evidence.schema.json`

### Phase 2: Load and Chunk

1. Locate the lesson from `data/outlines/{book-id}.outline.json`
2. Read lesson markdown
3. Split into evidence-bearing units:
   - definition paragraphs
   - example paragraphs
   - experiment steps
   - captions
   - table row groups
4. Create lesson-local evidence first

### Phase 3: Retrieval-First Reasoning

For each evidence unit:

1. Extract candidate concepts, entities, and relations
2. Retrieve canonical candidates with `scripts/retrieve_candidates.py`
3. Use retrieval only as a narrowing signal
4. Produce **lesson-local raw nodes and edges**
5. Do not make final canonical merge decisions here

### Phase 4: Build Complete Lesson Bundle

Return lesson-local arrays:
- `nodes`
- `edges`
- `profiles`
- `mentions`
- `evidence`
- `new_backbone_nodes`

Rules:
- support nodes are recommended where applicable
- required properties should be filled when present in evidence
- every backbone node must have profile + mention + evidence support
- edge endpoints must refer to lesson-local node IDs
- `source_refs` must refer to lesson-local evidence IDs

### Phase 5: Return Structured Output

Return:

```json
{
  "nodes": [...],
  "edges": [...],
  "profiles": [...],
  "mentions": [...],
  "evidence": [...],
  "new_backbone_nodes": ["concept:...", "entity/..."],
  "counts": {
    "nodes": 5,
    "edges": 3,
    "profiles": 5,
    "mentions": 12,
    "evidence": 15
  }
}
```

The caller is responsible for:
1. expanding provisional node cards
2. calling `scripts/store_lesson_staging.py`
3. verifying staging completeness

## Constraints

- Do not call `insert_batch.py`
- Do not write canonical `nodes`, `edges`, `profiles`, `mentions`, `evidence`, or `node_cards`
- Do not continue to the next lesson
- Do not operate on the whole graph directly

## Key Rules

### Scope
- one lesson only
- stop after the requested `batch-anchor`

### Storage
- canonical SQLite tables are not the output of this skill
- the output of this skill is a lesson-local artifact bundle

### Evidence First
- split to evidence units before node decisions
- every node and edge must remain evidence-backed

### Retrieval First
- retrieve candidates before reasoning
- use retrieval as narrowing aid, not as evidence

### Node Layers
- `backbone` for stable cross-lesson anchors
- `support` for auxiliary content
