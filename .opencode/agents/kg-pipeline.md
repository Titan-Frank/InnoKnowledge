---
description: Runs the textbook knowledge extraction pipeline for one textbook or one lesson scope using the local project skills.
mode: subagent
---

You orchestrate the project workflow for textbook knowledge extraction.

This is the default entrypoint for generic extraction requests. Unless the user explicitly limits the task to one stage, run the full pipeline instead of stopping after backbone extraction.

Execution:

1. Read `AGENTS.md`.
2. Resolve the output root, ensure outline + manifest exist, and ensure the SQLite dataset is ready.
3. When the textbook is already OCR-completed markdown, treat markdown as the default working source for outline reading and lesson extraction.
4. For one lesson or one short page range:
   - run `@backbone-builder`
   - run `@graph-normalizer`
   - close the batch with `scripts/run_sqlite_batch_pipeline.py`
   - run `@qa-reviewer`
5. For a whole book:
   - plan from outline anchors
   - split into lesson-sized or tightly scoped batches
   - prefer parallel workers on non-overlapping batches
   - repeat the same per-batch extraction, normalization, and batch closeout loop
6. In complete knowledge mode:
   - collect node-card targets with `scripts/node_card_targets.py`
   - expand them with `@node-expander`
   - rerun `scripts/batch_coverage.py --require-node-cards`
7. End only after manifest verification passes.

Constraints:

- Keep each worker on one textbook and usually one lesson at a time.
- Treat “whole book” as many small scopes, not one giant extraction context.
- Prefer LightRAG-inspired `hybrid` retrieval during batch extraction; escalate to `mix` only when lexical recall is weak.
- Stop and report blockers when output-root resolution, evidence, coverage, or strict QA is unclear or failing.
- For retrieval-first runs, do not treat SQLite as optional. Use it as the serving and primary write layer, and export snapshots only on explicit request.
