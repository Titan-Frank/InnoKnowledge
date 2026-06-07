# Knowledge Map Extraction Project

Turn textbook content into a stable, evidence-backed, cross-disciplinary world knowledge map.

## Core Principles

1. Global-first, not textbook-first
2. Evidence-backed
3. Retrieval-first extraction
4. PostgreSQL-first
5. Lesson staging first, canonical commit second
6. Non-destructive by default

## Unified Standard

Current runtime uses the unified world knowledge standard only.

Current version: `V1.2`

### Four Layers

1. Top ontology
   `entity`, `concept`, `property`, `process`, `event`, `method`, `rule`, `representation`, `resource`
2. Taxonomy table
   Controlled classification terms
3. Fact relation layer
   Stable object relations
4. Domain extension layer
   K12 and domain-specific teaching extensions
5. Evidence and provenance plane
   Cross-layer evidence constraints via mentions, evidence, and node cards

### `schema` vs `tag`

- `schema` defines formal structure, allowed node classes, relations, taxonomy, and domain extensions.
- `tag` is retrieval-only and must not be used as the primary classification mechanism.

### Research Grounding

- BFO / OWL support the top ontology and formal constraints.
- SKOS supports controlled taxonomy instead of free tags as primary classification.
- W3C PROV supports evidence and provenance design.
- UNESCO / ISCED support separating domain-stage projection from object ontology.
- Ryle / Polanyi support distinguishing propositional and practical knowledge.
- Anderson & Krathwohl support `learning_mode` as `factual / conceptual / procedural / metacognitive`.

## Runtime Architecture

```
outline -> parallel lesson staging -> canonical merge -> normalize -> qa -> integrity
```

### Roles

- Manager: orchestrates only
- Lesson worker: extracts one lesson and writes only `world_staging_*`
- Reducer: merges staged data into canonical `world_*`

## Storage

Canonical tables:

- `world_nodes`
- `world_edges`
- `world_taxonomy_terms`
- `world_taxonomy_edges`
- `world_domain_profiles`
- `world_mentions`
- `world_evidence`
- `world_node_cards`

Operational tables:

- `world_lesson_runs`
- `world_staging_nodes`
- `world_staging_edges`
- `world_staging_domain_profiles`
- `world_staging_mentions`
- `world_staging_evidence`
- `world_staging_node_cards`
- `world_merge_runs`
- `world_canonical_node_map`
- `retrieval_candidates`

## Required Constraints

### Whole-book rule

Never process a whole textbook in one extraction context unless explicitly requested.

### Staging rule

Lesson workers may write only:

- `world_lesson_runs`
- `world_staging_*`

They must never write canonical `world_*` tables directly.

### Reducer rule

Only reducer steps may:

- create canonical nodes
- merge duplicates
- remap edges, mentions, evidence, node cards
- finalize QA status

## Required Schemas

- `schemas/framework.schema.json`
- `schemas/outline.schema.json`
- `schemas/world-knowledge.schema.json`
- `schemas/world-knowledge-edge.schema.json`
- `schemas/world-taxonomy-term.schema.json`
- `schemas/world-domain-profile.schema.json`

## Review Checklist

- Each lesson is processed independently
- Lesson workers write only `world_staging_*`
- Canonical merge happens after staging
- Every node has a valid top ontology class
- Every edge uses a valid relation type
- Every mention links to evidence
- Every node has a domain profile
- Every node has a node card
- Hierarchical edges must be acyclic

## Deprecated

The old `v2` schema and runtime are retired. Do not use `schemas/v2/*` or old `nodes/edges/profiles` table assumptions.
