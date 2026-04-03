---
description: '[DEPRECATED] Use $chapter-extract skill directly'
mode: subagent
---

# ⚠️ DEPRECATED

This agent has been **deprecated** and will be removed in a future version.

## Migration

Use the corresponding skill directly:

```
OLD: @backbone-builder
NEW: $chapter-extract
```

## Why

The agent was a thin wrapper around `$chapter-extract` with overlapping responsibilities. To simplify the architecture:

- **Skills** now contain complete implementation details
- **Agents** focus on orchestration only
- All extraction logic lives in `$chapter-extract/SKILL.md`

## Full Replacement

The skill at `.opencode/skills/chapter-extract/SKILL.md` now includes:
- Complete workflow (6 phases)
- Input/output specifications
- Error handling
- All rules previously duplicated here

See also:
- `$chapter-extract` skill for implementation
- `AGENTS.md` for updated architecture
- `.opencode/CONVENTIONS.md` for agent/skill boundaries

---

**Legacy content below (kept for reference only):**

Use `$chapter-extract` and `$knowledge-schema`.

Role:

- Build or extend the sparse canonical backbone for one lesson or one short page range.
- Produce evidence-backed canonical updates plus book-local provenance under the active `<output-root>`.
- Leave detailed explanation and node-card expansion to `@node-expander`.

Execution:

1. Read `AGENTS.md`.
2. Resolve the output root and canonical batch anchor.
3. If the textbook source is already OCR-completed markdown, use the markdown lesson content as the default working source.
4. Use SQLite as the primary writable store.
5. Follow the chapter-extract skill order:
   - micro-chunk evidence
   - local claim grouping
   - LightRAG-inspired seed retrieval, preferring `scripts/retrieve_candidates.py --mode hybrid`
   - narrow local subgraph reasoning when needed
   - node, profile, mention, evidence, and proposal payloads
6. Persist the batch runtime payload with `scripts/store_batch_runtime.py`.
7. Apply staged artifacts with `scripts/apply_batch_artifacts.py`.
8. Leave weak or conflicting relations in runtime review flow instead of writing them directly as canonical edges.

Retrieval notes:

- Default to `--mode hybrid` so lexical node reuse and relation-neighborhood support are fused before reuse decisions.
- Use `--mode mix` only when lesson terminology is sparse and profile/evidence text is needed as secondary recall.

Write targets:

- SQLite canonical tables for nodes, edges, profiles, mentions, and evidence
- Optional exported snapshot files under `<output-root>/...` only when the caller explicitly requests `scripts/export_snapshot.py`

Handoff:

- If running under `@kg-pipeline`, return the canonical batch anchor and whether runtime artifacts were written and applied.
- Do not finish the batch if the SQLite-backed updates are not traceable through batch-local mentions and evidence.
