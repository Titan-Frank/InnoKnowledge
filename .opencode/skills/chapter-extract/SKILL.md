---
name: chapter-extract
description: Extracts concepts, substances, experiments, methods, symbols, and evidence-backed relations from one textbook lesson or a small page range. Use when turning a lesson into canonical knowledge updates plus book-local mentions and evidence after the textbook outline already exists.
---

# Chapter Extract

Use this skill on one lesson at a time. Keep extraction narrow and evidence-first so the graph stays reviewable.

## Workflow

1. Read `AGENTS.md`.
2. Read `schemas/v2/node.schema.json`, `schemas/v2/edge.schema.json`, `schemas/v2/curriculum-profile.schema.json`, `schemas/v2/mention.schema.json`, and `schemas/v2/evidence.schema.json`.
3. Read `../knowledge-schema/references/schema-guide.md`, `../knowledge-schema/references/framework-usage.md`, and `references/extraction-rules.md`.
4. Find the lesson page range from `data/outlines/<book-id>.outline.json`.
5. Extract lesson text with `pdftotext -layout`.
6. Create evidence records first.
7. Reuse or create canonical nodes second.
8. Reuse or create canonical edges third.
9. Reuse or create curriculum profiles fourth.
10. Create book-local mentions last.

## Output Rules

- Work on one lesson or one short page range only.
- Update `data/v2/graph/knowledge.nodes.jsonl` and `data/v2/graph/knowledge.edges.jsonl` only when canonical additions are justified.
- Update `data/v2/profiles/knowledge.profiles.jsonl` when the lesson provides a stable subject/stage projection for a canonical node.
- Write provenance to `data/v2/graph/<book-id>.mentions.jsonl` and `data/v2/graph/<book-id>.evidence.jsonl`.
- Keep one JSON object per line.
- If a concept only appears in an activity, keep the activity evidence.
- If an edge is only weakly implied, omit it or lower confidence.
- Prefer V2 `node_kind`-aware ids such as `entity/substance:oxygen` or `activity/experiment:oxygen-content-determination`.
- Write legacy `data/graph/` outputs only if the user explicitly asks for compatibility output.

## References

- `references/extraction-rules.md`
- `../knowledge-schema/references/schema-guide.md`
