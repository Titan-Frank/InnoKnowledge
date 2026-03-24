---
name: graph-normalize
description: Deduplicates, canonicalizes, and cleans the shared knowledge graph while preserving textbook provenance and schema validity. Use when canonical nodes and edges already exist and you need alias merging, duplicate cleanup, or relation consolidation before QA or graph import.
---

# Graph Normalize

Use this skill after extraction and before graph import. Normalize the canonical knowledge graph conservatively and preserve textbook mentions and evidence.

## Workflow

1. Read `AGENTS.md`.
2. Read `../knowledge-schema/references/schema-guide.md`.
3. Read `references/normalization-rules.md`.
4. Deduplicate canonical nodes conservatively.
5. Merge aliases and framework refs.
6. Remove exact duplicate canonical edges.
7. Update mentions only when target ids change.
8. Preserve schema-valid output files under `data/graph/`.

## Rules

- Never drop evidence while merging.
- Prefer one canonical Chinese name per concept node.
- Keep formulas and alternate wording in `aliases`.
- Preserve mentions and evidence when canonical ids change.
- Preserve `same_as` edges only if they are still useful for audit; otherwise fold them into aliases.
- Do not merge across node types unless there is an explicit user request.

## References

- `references/normalization-rules.md`
- `../knowledge-schema/references/schema-guide.md`
