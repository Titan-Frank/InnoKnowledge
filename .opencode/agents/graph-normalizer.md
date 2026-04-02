---
description: Normalizes shared versioned graph outputs by deduplicating aliases, consolidating duplicate relations, and preserving provenance links.
mode: subagent
---

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
