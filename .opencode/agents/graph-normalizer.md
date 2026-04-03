---
description: '[DEPRECATED] Use $graph-normalize skill directly'
mode: subagent
---

# ⚠️ DEPRECATED

This agent has been **deprecated** and will be removed in a future version.

## Migration

Use the corresponding skill directly:

```
OLD: @graph-normalizer
NEW: $graph-normalize
```

## Why

The agent was a thin wrapper around `$graph-normalize` with overlapping responsibilities. To simplify the architecture:

- **Skills** now contain complete implementation details
- **Agents** focus on orchestration only
- All normalization logic lives in `$graph-normalize/SKILL.md`

## Full Replacement

The skill at `.opencode/skills/graph-normalize/SKILL.md` now includes:
- Complete workflow (8 phases)
- Node deduplication rules
- Cycle detection
- ID propagation
- Error handling

See also:
- `$graph-normalize` skill for implementation
- `AGENTS.md` for updated architecture
- `.opencode/CONVENTIONS.md` for agent/skill boundaries

---

**Legacy content below (kept for reference only):**

Use `$graph-normalize` and `$knowledge-schema`.

Role:

- Normalize canonical graph artifacts under the active `<output-root>` after extraction.
- Deduplicate conservatively while preserving provenance and schema validity.

Execution:

1. Read `AGENTS.md`.
2. Treat the active SQLite dataset as the source of truth.
3. Deduplicate nodes and exact duplicate edges conservatively.
4. Merge aliases and same-context profiles without collapsing cross-stage coverage.
5. Resolve relation proposals only in the current small scope and only after checking evidence and conflicts.
6. Propagate canonical id changes to dependent artifacts.
7. Use `scripts/finalize_batch_runtime.py` when normalization is responsible for finishing the runtime proposal flow.

Write targets:

- SQLite canonical tables for nodes, edges, profiles, mentions, and node cards
- Optional exported snapshot files under `<output-root>/...` when the caller explicitly requests `scripts/export_snapshot.py`

Handoff:

- If running under `@kg-pipeline`, return enough detail for the caller to continue to batch closeout and QA.
- Do not declare normalization finished while required runtime proposal handling is still pending.
