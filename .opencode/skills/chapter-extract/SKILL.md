---
name: chapter-extract
description: Extracts one lesson or a small page range into evidence-backed canonical updates, curriculum profiles, mentions, and evidence under the active output root after the outline already exists.
---

# Chapter Extract

Use this skill for one lesson or one tightly scoped page range at a time. `AGENTS.md` remains the authority for pipeline order, preservation rules, output-root resolution, and evidence requirements.

## Workflow

1. Read `AGENTS.md`.
2. Read `schemas/v2/node.schema.json`, `schemas/v2/edge.schema.json`, `schemas/v2/curriculum-profile.schema.json`, `schemas/v2/mention.schema.json`, and `schemas/v2/evidence.schema.json`.
3. Read `../knowledge-schema/references/schema-guide.md`, `../knowledge-schema/references/framework-usage.md`, and `references/extraction-rules.md`.
4. Locate the lesson scope from `data/outlines/<book-id>.outline.json`.
5. Read the OCR-completed markdown source for the target lesson. Use heading blocks, lists, tables, callouts, and explicit page markers as the primary source structure.
6. Work in this order:
   - split the lesson into small evidence-bearing units
   - create batch-local evidence and a provisional local graph
   - prepare query / node / profile / evidence / mention / proposal payloads
   - retrieve a constrained seed candidate set with `scripts/retrieve_candidates.py`, preferring `--mode hybrid`
   - switch to `--mode mix` only when lexical recall is weak and profile/evidence text should assist
   - use `scripts/local_subgraph.py` when a narrowed neighborhood helps reuse decisions
   - persist with `scripts/store_batch_runtime.py`
   - apply staged artifacts with `scripts/apply_batch_artifacts.py`

## Output Rules

- Work on one lesson or one short page range only.
- Use SQLite as the primary write target and treat `<output-root>/...` as an optional exported snapshot shape, not the live source of truth.
- Update canonical nodes and edges only when the lesson provides evidence-backed canonical additions.
- Append curriculum projections and provenance into SQLite first.
- Keep SQLite `batch_runtime_records` as the default replay source for one batch.
- Keep the extraction evidence-first and candidate-retrieval-first.
- Treat LightRAG-style `hybrid` / `mix` retrieval as a narrowing aid, not as evidence.
- Keep the batch-local provisional graph richer than the canonical graph when the lesson needs temporary support nodes or unresolved alternatives.
- Use GraphRAG-style local subgraph reasoning only as a narrowing aid. Do not treat a chapter summary or a retrieved neighborhood as direct evidence.
- For OCR-completed markdown sources, prefer `extraction_method = "ocr"` unless the batch clearly mixes manual cleanup or other source transforms.
- Use markdown-local headings or block markers as `anchor_ref` context when preparing evidence and mentions, but keep the final batch anchor aligned to the canonical outline id.
- Every emitted node must include at least one schema-valid `learning_modes` value.
- Every emitted relation proposal must use a schema-valid `edge_type`; do not invent near-synonyms.
- If a concept appears only inside an activity or experiment, preserve that activity evidence instead of inventing a stronger claim.
- If a relation is weak, inferred, or conflicting, keep it out of canonical edges and leave it for review.

## References

- `references/extraction-rules.md`
- `references/graphrag-inspired-workflow.md`
- `../../../references/retrieval-first-extraction-architecture.md`
- `../knowledge-schema/references/schema-guide.md`
