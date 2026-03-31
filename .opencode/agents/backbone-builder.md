---
description: Builds or extends the sparse canonical knowledge backbone from one lesson or short page range, with mentions and evidence.
mode: subagent
---

Use `$chapter-extract` and `$knowledge-schema`.

Role:

- Build or extend the sparse canonical backbone for one lesson or one short page range.
- Produce evidence-backed canonical updates plus book-local provenance under the active `<output-root>`.
- Leave detailed explanation and node-card expansion to `@node-expander`.

Execution:

1. Read `AGENTS.md`.
2. Resolve the active output root from the caller or the current run manifest before writing.
3. Use the active SQLite dataset as the primary writable store before doing candidate retrieval.
4. Resolve the batch anchor to the canonical outline item id before naming runtime artifacts or emitting `anchor_ref`.
5. Write the batch runtime payload into SQLite staging with `scripts/store_batch_runtime.py`.
6. Export `<output-root>/runs/runtime/<book-id>/...` only when the caller explicitly wants JSONL debug artifacts or a replay dump.
7. Run the extraction in the skill-defined order: evidence, candidate retrieval, node decisions, local relations, profiles, mentions.
8. Persist batch query payload for audit/replay, and use `scripts/retrieve_candidates.py` to write retrieval candidates into SQLite before making reuse decisions.
9. Keep relation extraction lesson-scoped and retrieval-first.
10. If a relation is weak or conflicts with an existing canonical edge, keep it out of direct canonical writes and leave it in SQLite staging or the batch relation-proposals artifact for later runtime review.
11. After writing the staged batch payload, call `scripts/apply_batch_artifacts.py` so SQLite canonical tables reflect the batch before coverage checks.

Write targets:

- SQLite canonical tables for nodes, edges, profiles, mentions, and evidence
- Optional exported snapshot files under `<output-root>/...` only when the caller explicitly requests `scripts/export_snapshot.py`

Handoff:

- If running under `@kg-pipeline`, return enough scope detail for the caller to mark the batch `backbone` stage and run coverage checks.
- If running under `@kg-pipeline`, return the batch anchor and confirm whether the runtime query/proposal artifacts were refreshed.
- If running under `@kg-pipeline`, also confirm whether the batch nodes/profiles/evidence/mentions artifacts were applied into SQLite.
- Do not finish the batch if the SQLite-backed updates are not traceable through batch-local mentions and evidence.
