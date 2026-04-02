# Knowledge Map Extraction Project

This project turns textbook content into a stable, evidence-backed, cross-disciplinary knowledge map that can later be imported into a graph database or ontology system.

## Goal

- Keep the main backbone as canonical knowledge points and relations.
- Treat the graph as global-first, not textbook-first.
- Use framework files as soft scaffolds, not rigid ontologies.
- Use textbook structure as provenance anchors, not as the primary knowledge tree.
- Keep nodes, edges, profiles, node cards, mentions, and evidence traceable.

## Instruction Ownership

- `AGENTS.md` is the project-wide source of truth for workflow order, preservation policy, and output contracts.
- `.opencode/agents/*.md` should stay orchestration-focused.
- `.opencode/skills/*/SKILL.md` should stay capability-focused.
- If instructions overlap, resolve them in this order:
  - user request
  - `AGENTS.md`
  - agent file
  - skill file

## Default Entry

- Generic requests to extract, build, refresh, or generate a knowledge map should use `@kg-pipeline`.
- Use `@backbone-builder`, `@graph-normalizer`, or `@node-expander` directly only when the user explicitly asks for one stage or a run is being resumed from that stage.
- For per-batch closeout, prefer `scripts/run_sqlite_batch_pipeline.py` instead of manually chaining apply, coverage, finalize, and QA steps.
- Treat OCR-completed textbook markdown as the default and only working source.

## Core Workflow

1. Create or refresh `data/outlines/<book-id>.outline.json`.
2. Resolve the active output root.
3. Initialize or refresh `<output-root>/runs/<book-id>.pipeline.json`.
4. Ensure the active SQLite dataset is available before retrieval-first batch work.
5. Extract one lesson or one tightly scoped page range at a time.
6. Work retrieval-first:
   - split the lesson into small evidence-bearing units
   - build batch-local evidence and a provisional local graph in SQLite staging
   - retrieve a small seed candidate set, preferring LightRAG-inspired `hybrid` mode by default
   - use `mix` mode when lexical seed hits are sparse and profile/evidence text should act as secondary support
   - reason in a narrow local subgraph before deciding node reuse, node creation, or relation proposals
7. Write runtime artifacts into SQLite staging with `scripts/store_batch_runtime.py`.
8. Close the batch with `scripts/run_sqlite_batch_pipeline.py`.
9. Expand node cards only after the backbone is stable enough.
10. Trust a batch only after read-only QA passes.

## Whole-Book Rule

- Never process a whole textbook as one extraction context unless the user explicitly asks for an ad hoc whole-book pass.
- For whole-book work:
  - refresh or read the outline first
  - split into lesson-sized or tightly scoped chapter-sized batches
  - prefer lesson-level batches
  - run normalization and QA after each batch or after a small adjacent batch group
  - report progress by completed lesson anchors

## Complete Knowledge Mode

- If the user asks for complete knowledge, complete explanations, or direct node-card generation, treat the run as complete knowledge mode.
- In complete knowledge mode:
  - do not stop at the sparse backbone
  - after normalization and QA, collect targets with `scripts/node_card_targets.py`
  - expand returned nodes with `@node-expander`
  - rerun `scripts/batch_coverage.py --require-node-cards`

## Strict Execution Rules

- Resolve the active output root before writing graph artifacts.
- Resolve the output root in this order:
  - a user-explicit root such as `data/v4/`
  - an existing run manifest for the same `book-id`
  - a single existing version root that already contains the same book's mentions or evidence
- If multiple candidate version roots exist for the same `book-id`, stop and ask instead of guessing.
- Before retrieval-first work, ensure the active SQLite dataset exists.
- Use heading structure, explicit page markers, and local section anchors from markdown as the source-side structure for outline and lesson extraction.
- If resuming from an exported snapshot or bootstrapping from existing files, use:
  - `scripts/sync_output_root_to_sqlite.py --replace --activate --preserve-runtime`
- For each batch, manifest order is always:
  - `backbone`
  - `normalize`
  - `qa`
- Do not mark a later stage complete while an earlier required stage is still pending.
- `scripts/run_sqlite_batch_pipeline.py` is the standard batch closer and should automatically:
  - run `scripts/apply_batch_artifacts.py`
  - run `scripts/batch_coverage.py`
  - attempt `scripts/local_subgraph.py` after coverage
  - run `scripts/finalize_batch_runtime.py`
  - run `scripts/strict_qa.py`
  - generate `scripts/batch_group_rollup.py` when a lesson window is available or explicitly requested
- Missing retrieval seeds must not fail the whole batch closeout by themselves. `local_subgraph.py` may emit a skipped report instead.
- After each batch backbone pass, treat missing batch-local mentions or broken mention-to-evidence links as blockers.
- If strict QA fails, stop the pipeline, record the batch as blocked, and report the issues before continuing.

## Retrieval-First Rules

- Do not perform relation extraction against the whole canonical graph context.
- Retrieve a small candidate set first, then reason inside a narrowed local subgraph.
- Prefer `scripts/retrieve_candidates.py --mode hybrid` for default batch work.
- Use `--mode local` for the most conservative replay/debug runs and `--mode mix` when local lexical recall is too weak.
- Apply hard filters before relation judgment:
  - `node_kind`
  - `subject`
  - `school_stage`
  - `grade_band`
- Extract relations in two steps:
  - local lesson relation proposals
  - small-scope normalization and cross-lesson linking
- Do not promote a canonical edge unless the current source provides explicit evidence.
- If a relation is weak, inferred, or conflicting, keep it out of canonical edges and leave it for review.
- Prefer slow, conservative edge promotion over aggressive graph growth.

## SQLite-First Rules

- SQLite is the primary serving and write layer during pipeline execution.
- `<output-root>` JSON/JSONL files are derived snapshot exports for viewer, Git review, and publishing.
- Default batch extraction should write runtime artifacts into SQLite staging first, not into runtime JSONL files.
- The canonical `batch-anchor` is the outline item id, for example `struct:chem-grade8-all-in-one:lesson:1-1-1`.
- Helper scripts may accept shorthand such as `lesson-1-1-1`, but SQLite rows and exported snapshots should normalize back to canonical outline ids.
- Use `scripts/export_batch_runtime.py` only for explicit debug export.
- `scripts/apply_batch_artifacts.py` should read SQLite `batch_runtime_records` by default. Runtime files should be used only through explicit file arguments.

## Provenance and Preservation

- Every canonical node must have at least one mention pointing to a textbook location.
- Every mention must reference at least one evidence record.
- Evidence must include source identity, anchor, locator, and extraction method.
- No canonical edge should be added without an evidence-backed anchor path from the current source scope.
- Extraction and normalization are append-first and non-destructive by default.
- Absence from the current lesson or textbook is not evidence that an existing canonical record should be deleted.
- Deleting canonical nodes, edges, profiles, mentions, evidence, or node cards requires explicit user instruction.
- If a rerun would shrink supported coverage, stop and report the conflict instead of writing a destructive update.

## Output Contract

- Active output root: `data/<version>/`
- Outline: `data/outlines/<book-id>.outline.json`
- Run manifest: `<output-root>/runs/<book-id>.pipeline.json`
- Canonical nodes: `<output-root>/graph/knowledge.nodes.jsonl`
- Canonical edges: `<output-root>/graph/knowledge.edges.jsonl`
- Curriculum profiles: `<output-root>/profiles/knowledge.profiles.jsonl`
- Mentions: `<output-root>/graph/<book-id>.mentions.jsonl`
- Evidence: `<output-root>/graph/<book-id>.evidence.jsonl`
- Node cards: `<output-root>/node_cards/<safe-node-id>.json`

Legacy files under `data/graph/` and `data/node_cards/` are compatibility outputs. New work should use the active versioned output root unless the user explicitly asks for legacy output.

## Required Schemas

Read these before writing output:

- `schemas/framework.schema.json`
- `schemas/outline.schema.json`
- `schemas/v2/node.schema.json`
- `schemas/v2/edge.schema.json`
- `schemas/v2/curriculum-profile.schema.json`
- `schemas/v2/mention.schema.json`
- `schemas/v2/evidence.schema.json`
- `schemas/v2/node-card.schema.json`
- `schemas/v2/pattern-library.schema.json`

## Detailed References

Use the skill references for artifact-specific detail:

- `.opencode/skills/knowledge-schema/references/schema-guide.md`
- `.opencode/skills/chapter-extract/references/extraction-rules.md`
- `.opencode/skills/graph-normalize/references/normalization-rules.md`
- `.opencode/skills/knowledge-schema/references/node-card-usage.md`
- `.opencode/skills/knowledge-schema/references/framework-usage.md`

## Review Checklist

- Schema-valid fields only.
- Every canonical node has at least one mention with evidence.
- Every canonical node has a valid `node_layer`.
- Every canonical edge has valid `edge_layer` and `backbone_expand`.
- No canonical edge whose endpoints are missing.
- No curriculum profile whose node is missing.
- No mention without evidence.
- No evidence without an anchor.
- No duplicate canonical nodes that differ only by whitespace, punctuation, aliases, or legacy-vs-v2 naming.
- No relation promoted to the canonical graph unless the source evidence clearly supports it.
