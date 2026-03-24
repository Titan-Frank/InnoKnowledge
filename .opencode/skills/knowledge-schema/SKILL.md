---
name: knowledge-schema
description: Applies the project's canonical node, edge, evidence, and outline schema for textbook knowledge extraction. Use when creating or normalizing graph artifacts under `data/graph/`, defining IDs, choosing relation types, or checking whether extraction outputs match the project's schema.
---

# Knowledge Schema

Use this skill as the schema authority for every extraction task. Do not invent new node types or edge types unless the user asks to evolve the schema.

## Workflow

1. Read the JSON schema files in `schemas/`.
2. Read `references/schema-guide.md` for semantic guidance.
3. Read `references/framework-usage.md` and `data/frameworks/junior-chemistry-framework.json` when aligning concepts to the curriculum backbone.
4. Read `data/patterns/junior-chemistry-patterns.json` before expanding a node into a card.
5. Write JSONL with one object per line for canonical nodes, canonical edges, mentions, and evidence.
6. Write node cards as JSON objects under `data/node_cards/`.
7. Keep canonical IDs stable and provenance explicit.

## Rules

- Canonical knowledge records are global-first, not book-first.
- Provenance belongs in mentions and evidence.
- Detailed explanation belongs in node cards, not in the backbone graph.
- Prefer fewer, cleaner relation types over many nearly identical ones.
- Keep Chinese names in `name` and normalized short aliases in `aliases`.
- Use `framework_refs` when a node or edge clearly aligns to the curriculum framework.
- Use `pattern_refs` on node cards to record which pattern guided the expansion.
- Use `properties` for extensible details instead of creating ad hoc top-level keys.

## References

- `references/schema-guide.md`
- `references/framework-usage.md`
- `references/node-card-usage.md`
- `schemas/framework.schema.json`
- `schemas/pattern-library.schema.json`
- `schemas/node.schema.json`
- `schemas/edge.schema.json`
- `schemas/mention.schema.json`
- `schemas/evidence.schema.json`
- `schemas/node-card.schema.json`
- `schemas/outline.schema.json`
