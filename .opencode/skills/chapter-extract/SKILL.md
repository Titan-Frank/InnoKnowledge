---
name: chapter-extract
description: Extracts concepts, substances, experiments, methods, symbols, and evidence-backed relations from one textbook lesson or a small page range. Use when turning a lesson into canonical knowledge updates plus book-local mentions and evidence after the textbook outline already exists.
---

# Chapter Extract

Use this skill on one lesson at a time. Keep extraction narrow and evidence-first so the graph stays reviewable.

## Workflow

1. Read `AGENTS.md`.
2. Read `schemas/node.schema.json`, `schemas/edge.schema.json`, `schemas/mention.schema.json`, and `schemas/evidence.schema.json`.
3. Read `../knowledge-schema/references/schema-guide.md`, `../knowledge-schema/references/framework-usage.md`, and `references/extraction-rules.md`.
4. Find the lesson page range from `data/outlines/<book-id>.outline.json`.
5. Extract lesson text with `pdftotext -layout`.
6. Create evidence records first.
7. Reuse or create canonical nodes second.
8. Reuse or create canonical edges third.
9. Create book-local mentions last.

## Output Rules

- Work on one lesson or one short page range only.
- Update `data/graph/knowledge.nodes.jsonl` and `data/graph/knowledge.edges.jsonl` only when canonical additions are justified.
- Write provenance to `data/graph/<book-id>.mentions.jsonl` and `data/graph/<book-id>.evidence.jsonl`.
- Keep one JSON object per line.
- If a concept only appears in an activity, keep the activity evidence.
- If an edge is only weakly implied, omit it or lower confidence.

## References

- `references/extraction-rules.md`
- `../knowledge-schema/references/schema-guide.md`
