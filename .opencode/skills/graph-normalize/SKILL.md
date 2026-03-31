---
name: graph-normalize
description: Deduplicates, canonicalizes, and cleans the shared knowledge graph while preserving textbook provenance and schema validity. Use when canonical nodes and edges already exist and you need alias merging, duplicate cleanup, or relation consolidation before QA or graph import.
---

# Graph Normalize

Use this skill after extraction and before graph import. `AGENTS.md` remains the authority for preservation policy, conflict handling, and pipeline sequencing.

## Workflow

1. Read `AGENTS.md`.
2. Read `../knowledge-schema/references/schema-guide.md`.
3. Read `references/normalization-rules.md`.
4. Work under the active `<output-root>`.
5. Deduplicate nodes and exact duplicate edges conservatively.
6. Merge aliases, framework refs, and same-context curriculum profiles.
7. Run `scripts/finalize_batch_runtime.py` for the active batch so relation proposals are stored, promoted conservatively, and exported back into the output root.
8. Resolve relation proposals only in the current small scope and only when evidence still supports them.
9. Detect cycles in hierarchical and dependency edges.
10. When canonical ids change, propagate updates to profiles, mentions, and node cards.

## Rules

- Never drop evidence while merging.
- Prefer one canonical Chinese name per concept node.
- Keep formulas and alternate wording in `aliases`.
- Preserve profiles, mentions, node cards, and evidence when canonical ids change.
- Preserve `same_as` edges only if they are still useful for audit; otherwise fold them into aliases.
- Do not merge across `node_kind` or `node_subkind` unless there is explicit evidence or explicit user approval.
- Do not auto-accept a conflicting new relation just because it is newer. Prefer review over overwrite.
- Hierarchical and dependency edges (`is_a`, `instance_of`, `contains`, `part_of`, `prerequisite_for`, `depends_on`, `extends`) must not form cycles.
- Cycles in association edges (`related_to`, `explains`, `uses`) are acceptable.

## References

- `references/normalization-rules.md`
- `../knowledge-schema/references/schema-guide.md`
