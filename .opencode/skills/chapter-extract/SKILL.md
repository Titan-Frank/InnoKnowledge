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
- Append new stage-specific curriculum profiles instead of overwriting profiles from other stages.
- Never delete existing junior-secondary records while extracting senior-secondary material, or vice versa.
- Write provenance to `data/v2/graph/<book-id>.mentions.jsonl` and `data/v2/graph/<book-id>.evidence.jsonl`.
- If the user explicitly requests a versioned root such as `data/v3/`, write the same file layout there instead of `data/v2/`.
- Keep one JSON object per line.
- If a concept only appears in an activity, keep the activity evidence.
- If an edge is only weakly implied, omit it or lower confidence.
- Prefer V2 `node_kind`-aware ids such as `entity/substance:oxygen` or `activity/experiment:oxygen-content-determination`.
- Every canonical node must set `node_layer` to `backbone` or `support`.
- Every canonical edge must set `edge_layer`, and use `backbone_expand = true` only when the edge should open a support node from a backbone node.
- Default to `support` for reusable but auxiliary methods, activities, representations, equipment, or issue nodes unless the user explicitly wants them in the visible backbone.
- Write legacy `data/graph/` outputs only if the user explicitly asks for compatibility output.
- Treat pre-existing canonical graph files as cumulative project memory. Do not remove existing nodes, edges, profiles, mentions, or evidence unless the user explicitly requests deletion.

## References

- `references/extraction-rules.md`
- `../knowledge-schema/references/schema-guide.md`
