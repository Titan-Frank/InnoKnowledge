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
2. Resolve the active output root from the caller or the current run manifest before writing.
3. Treat the active SQLite dataset as the source of truth before resolving relation proposals.
4. Deduplicate nodes and exact duplicate edges conservatively.
5. Merge aliases and same-context profiles without collapsing cross-stage coverage.
6. Finalize the batch runtime flow with `scripts/finalize_batch_runtime.py` so proposal storage, promotion, snapshot export, and SQLite QA happen as part of normalization.
7. Resolve relation proposals only after checking current-scope evidence and conflicts.
8. Propagate canonical id changes to dependent artifacts.

Write targets:

- `<output-root>/graph/knowledge.nodes.jsonl`
- `<output-root>/graph/knowledge.edges.jsonl`
- `<output-root>/profiles/knowledge.profiles.jsonl`
- `<output-root>/graph/<book-id>.mentions.jsonl` when target ids change
- `<output-root>/node_cards/<safe-node-id>.json` when canonical node ids change

Handoff:

- If running under `@kg-pipeline`, return enough detail for the caller to mark the batch `normalize` stage and continue to strict QA.
- Do not declare normalization finished while the batch relation-proposals artifact has not been processed through SQLite runtime finalize.
