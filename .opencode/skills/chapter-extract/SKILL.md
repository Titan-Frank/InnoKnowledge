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
5. Extract source text with `pdftotext -layout`.
6. Work in this order:
   - create batch-local evidence
   - prepare batch-local query / node / profile / evidence / mention / proposal payloads
   - retrieve a constrained candidate node set with `scripts/retrieve_candidates.py`
   - decide node reuse or creation
   - persist the batch runtime payload with `scripts/store_batch_runtime.py`
   - export `<output-root>/runs/runtime/<book-id>/<batch-anchor>.*.jsonl` only when the caller wants debug files
   - apply the batch artifacts into SQLite with `scripts/apply_batch_artifacts.py`

## Output Rules

- Work on one lesson or one short page range only.
- Use SQLite as the primary write target and treat `<output-root>/...` as an optional exported snapshot shape, not the live source of truth.
- Update canonical nodes and edges only when the lesson provides evidence-backed canonical additions.
- Append curriculum projections and provenance into SQLite first.
- Keep SQLite `batch_runtime_records` as the default replay source for one batch.
- Export runtime JSONL files only when debugging, sharing, or replaying a batch outside SQLite is useful.
- Keep one JSON object per line.
- Keep the extraction evidence-first and candidate-retrieval-first.
- If a concept appears only inside an activity or experiment, preserve that activity evidence instead of inventing a stronger claim.
- If a relation is weak, inferred, or conflicting, keep it out of canonical edges and leave it for review.

## References

- `references/extraction-rules.md`
- `../../../references/retrieval-first-extraction-architecture.md`
- `../knowledge-schema/references/schema-guide.md`
