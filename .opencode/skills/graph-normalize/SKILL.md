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
6. Merge curriculum profiles only when the subject / stage / grade context is the same.
7. Remove exact duplicate canonical edges.
8. **Detect cycles in hierarchical edges** (`is_a`, `instance_of`, `contains`, `part_of`, `prerequisite_for`, `depends_on`, `extends`).
9. **Resolve cycles** by deleting or retyping problematic edges.
10. Update profiles, mentions, and node cards when target ids change.
11. Preserve schema-valid output files under `data/v2/`.

## Rules

- Never drop evidence while merging.
- Prefer one canonical Chinese name per concept node.
- Keep formulas and alternate wording in `aliases`.
- Preserve profiles, mentions, node cards, and evidence when canonical ids change.
- Preserve `same_as` edges only if they are still useful for audit; otherwise fold them into aliases.
- Preserve `node_layer` during normalization and do not silently upgrade `support` nodes into `backbone`.
- Do not merge across `node_kind` or `node_subkind` unless there is an explicit user request.
- Do not merge curriculum profiles across different subject / school_stage / grade_band contexts.
- **Hierarchical and dependency edges (`is_a`, `instance_of`, `contains`, `part_of`, `prerequisite_for`, `depends_on`, `extends`) must NOT form cycles.**
- Cycles in association edges (`related_to`, `explains`, `uses`) are acceptable.
- Legacy `data/graph/` compatibility files should remain untouched unless the user explicitly asks for a legacy normalization pass.

## References

- `references/normalization-rules.md`
- `../knowledge-schema/references/schema-guide.md`
