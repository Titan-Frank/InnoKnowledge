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
export OPENAI_API_KEY=your_api_key

npm run server-pipeline-run -w packages/pipeline -- --book-id chem-grade8 --pdf-path /abs/path/to/book.pdf --db "$DATABASE_URL"
npm run parallel-lesson-pipeline -w packages/pipeline -- --root data/main --dataset-id main --book-id chem-grade8 --db "$DATABASE_URL"
```

## Extraction Rules

- One lesson per task.
- Lesson workers only write `world_staging_*`.
- Reducer alone writes canonical `world_*`.
- Every node and edge must be evidence-backed.
- `schema` is the source of classification truth; `tag` is retrieval-only.

## Main TypeScript Commands

- `npm run server-pipeline-run -w packages/pipeline`
- `npm run extract-lesson-openai -w packages/pipeline`
- `npm run store-staging -w packages/pipeline`
- `npm run staging-quality -w packages/pipeline`
- `npm run parallel-lesson-pipeline -w packages/pipeline`
- `npm run retrieve-candidates -w packages/pipeline`

## Schema Reference

- `schemas/world-knowledge-standard.md`
- `schemas/world-knowledge-architecture.md`
- `schemas/world-knowledge.schema.json`
- `schemas/world-knowledge-edge.schema.json`
- `schemas/world-taxonomy-term.schema.json`
- `schemas/world-domain-profile.schema.json`
