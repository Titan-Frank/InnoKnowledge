# GraphRAG / LightRAG-Inspired Workflow

Use GraphRAG ideas as a workflow pattern, not as a reason to relax evidence rules.

## Purpose

- keep extraction local, auditable, and replayable
- build a lesson-local graph before touching the shared canonical graph
- use retrieval to narrow context instead of loading the whole graph
- use small-group summaries to support normalization, not to replace evidence

## Core Pattern

### 1. Micro-chunk First

- Do not reason over the full lesson body as one undifferentiated block.
- Split one lesson into small evidence-bearing units such as:
  - definition paragraph
  - example paragraph
  - experiment step block
  - figure caption
  - table row group
- Extract local claims from each unit first.

### 2. Local Graph First

- Build a batch-local provisional graph from the current lesson before canonical promotion.
- The batch-local graph may include:
  - local node candidates
  - local relation proposals
  - local support entities and representations
  - anchor-scoped evidence links
- Treat this local graph as the extraction working memory for the batch.

### 3. Seed Retrieval, Then Neighborhood Expansion

- Start canonical retrieval from a small seed set:
  - lesson title terms
  - glossary-like terms
  - formula or notation labels
  - experiment names
  - recurring entities
- After seed retrieval, inspect the immediate neighborhood of top candidates conceptually before deciding reuse or relation promotion.
- The goal is not to import a whole global graph, but to recover a small local subgraph relevant to the batch.

### 3.1 LightRAG-Style Retrieval Modes

- `local`: use exact / alias / prefix / FTS matching when you want the most conservative replay path.
- `global`: expand from lexical seed hits into a small relation neighborhood when relation context matters more than direct string overlap.
- `hybrid`: default mode. Fuse direct lexical support with graph-neighborhood support before ranking candidates.
- `mix`: use only when `hybrid` still misses plausible reuse options and profile/evidence text should act as secondary support.

In this project, these modes narrow candidate reuse decisions only. They do not weaken evidence or QA rules.

### 4. Promote Conservatively

- Reuse a canonical node only when the local graph and the retrieved neighborhood support the match.
- Promote a local relation proposal only when:
  - both endpoints remain justified in the narrowed local subgraph
  - the current lesson provides evidence for the relation
  - no unresolved conflict exists with the current canonical graph

### 5. Multi-Scale Summaries

- After a small group of lessons, write a compact chapter-level or topic-level summary for human review or normalization support.
- These summaries are:
  - review aids
  - coverage aids
  - normalization aids
- They are not canonical nodes or edges by default.

## Project Mapping

Map the GraphRAG-style stages into this project as follows:

- micro-chunks -> batch-local evidence units
- local graph -> PostgreSQL runtime staging for nodes, mentions, evidence, and relation proposals
- retrieval narrowing -> `scripts/retrieve_candidates.py`
- LightRAG-style fusion -> `scripts/retrieve_candidates.py --mode hybrid|mix`
- neighborhood-aware normalization -> `scripts/normalize.py` plus conservative review
- community / thematic summary -> chapter-level normalization notes or QA notes, not canonical graph writes

## Guardrails

- Do not let summary convenience override source evidence.
- Do not create community nodes just because a cluster is visible.
- Do not replace lesson-local provenance with model-invented global structure.
- Do not use a chapter summary as direct evidence for canonical edge promotion.
- Keep the canonical graph slower and cleaner than the local extraction graph.
