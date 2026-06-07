# CLAUDE.md

## Project Overview

Knowledge Map Extraction project that transforms textbook content into a structured, evidence-backed world knowledge graph.

## Current Runtime

The repository now runs on the new world knowledge standard only.

Current standard version: `V1.2`

- canonical tables: `world_nodes`, `world_edges`, `world_domain_profiles`, `world_mentions`, `world_evidence`, `world_node_cards`
- staging tables: `world_staging_*`
- reducer bookkeeping: `world_lesson_runs`, `world_merge_runs`, `world_canonical_node_map`

Research grounding:

- top ontology: BFO / OWL
- taxonomy: SKOS
- provenance: W3C PROV
- educational projection: UNESCO / ISCED
- knowledge form: Ryle / Polanyi
- learning mode: Anderson & Krathwohl

## Main Commands

```bash
docker compose up -d
export DATABASE_URL=postgresql://okm:okm@localhost:5432/knowledge

python3 scripts/run_okm_harness.py --book-id chem-grade8 --pdf-path /abs/path/to/book.pdf
python3 scripts/merge_staged_lessons.py --root data/main --book-id chem-grade8
python3 scripts/normalize.py --dataset-id main
python3 scripts/strict_qa.py --dataset-id main
python3 scripts/check_graph_integrity.py --dataset-id main
```

## Extraction Rules

- One lesson per task.
- Lesson workers only write `world_staging_*`.
- Reducer alone writes canonical `world_*`.
- Every node and edge must be evidence-backed.
- `schema` is the source of classification truth; `tag` is retrieval-only.

## Main Scripts

- `scripts/extract_lesson_local.py`
- `scripts/extract_lesson_openai.py`
- `scripts/store_lesson_staging.py`
- `scripts/merge_staged_lessons.py`
- `scripts/normalize.py`
- `scripts/strict_qa.py`
- `scripts/check_graph_integrity.py`
- `scripts/retrieve_candidates.py`

## Schema Reference

- `schemas/world-knowledge-standard.md`
- `schemas/world-knowledge-architecture.md`
- `schemas/world-knowledge.schema.json`
- `schemas/world-knowledge-edge.schema.json`
- `schemas/world-taxonomy-term.schema.json`
- `schemas/world-domain-profile.schema.json`
