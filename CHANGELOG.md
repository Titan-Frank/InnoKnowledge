# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

- Select and add the root license.
- Complete source-level rights metadata and clearance before treating the hosted inspection artifact as a public data release.

### Added - 2026-07-13

- Added deterministic cross-domain scans for possible canonical object alignments and evidence-review-only relations.
- Added `world_interdisciplinary_runs` and `world_interdisciplinary_candidates` with explicit pending, approved, rejected, and applied governance states.
- Added dataset-locked application of approved node alignments and evidence-backed relations, preserving review provenance on canonical edges.
- Added interdisciplinary overview, scan, review, and apply APIs plus a responsive React workbench for domain coverage, domain pairs, bridge objects, evidence review, and candidate application.
- Added interdisciplinary pending items to the pipeline quality dashboard and integrated candidate scanning into the end-to-end pipeline without automatic canonical writes.

### Changed - 2026-07-13

- Exposed shared runtime edge-type constants for front-end annotation and review controls; canonical writes continue to validate against the pipeline's executable relation set.
- Updated current architecture, schema standards, API contracts, prompt inventory, technical reports, and both README files to describe the governed interdisciplinary workflow and its evidence limits.

### Removed - 2026-07-13

- Removed the obsolete broad discussion draft and completed 2026-06-26 next-step plan after consolidating their active boundaries into current standards and implementation documents.

## [0.1.0] - 2026-07-13

This version records the first public inspection preview. It is not yet a tagged GitHub Release, and its textbook-derived artifact remains subject to the rights boundaries in `artifacts/okm-public-v0.1.0/RIGHTS.md` and `SOURCES.md`.

### Added - 2026-07-12

- Reworked the default README as an English public entry point and added a complete Chinese companion.
- Added verified product screenshots for the graph, textbook tree, quality dashboard, and grounded-answer views.
- Added GitHub continuous integration, contribution guidance, a security policy, citation metadata, provenance boundaries, and a public-release checklist.
- Added root `test` and `verify` commands plus Node.js 22 package metadata.
- Added a repository-authored populated graph and a one-command demo backed by an isolated PostgreSQL database.
- Added evidence-linked, pending-review pedagogical-profile generation by school stage, integrated after canonical normalization and exposed through `ApiUnit` domain profiles.
- Removed the implicit institutional embedding endpoint; embedding text is sent only after an endpoint is explicitly configured.
- Restricted the Docker PostgreSQL port binding to the local host.

### Release note

The repository does not yet include a public license. The technical-report author metadata, legacy import fixtures, and final release artifact set also require explicit review as documented in `docs/open-source-release-checklist.md`.

### Removed - 2026-06-23

#### TypeScript Pipeline Migration
- Removed the legacy Python staging writer `scripts/store_lesson_staging.py`; use `npm run store-staging -w packages/pipeline`.
- Removed the unused psycopg compatibility shim `scripts/psycopg_extras_shim.py`.
- Removed legacy Python stage scripts now covered by `packages/pipeline`: PostgreSQL check, MinerU Markdown preparation, outline chunking, batch planning, batch reducer, staging quality, retrieval, merge, normalize, strict QA, graph integrity, embeddings backfill, and clustering.
- Removed unused Python helper modules `scripts/knowledge_store_common.py`, `scripts/embedding_client.py`, and `scripts/okm_pathing.py`.
- Removed the legacy Python harness wrapper under `harness/`, `scripts/run_okm_harness.py`, and the retired harness workflow schema.
- Removed the old OpenHarness upload utility `oah_upload.py`.

## Historical entries for retired architectures

The entries below describe earlier Python, SQLite, and agent-based iterations. They are preserved as project history and must not be used as current setup instructions. Current behavior is documented in `README.md`, `docs/README.md`, and `docs/current-system-architecture.md`.

### Added - 2026-04-08

#### Parallel Staging Pipeline
- **`scripts/store_lesson_staging.py`** - Writes lesson-local extraction artifacts into explicit `staging_*` tables
- **`scripts/merge_staged_lessons.py`** - Aligns staged lesson nodes into canonical nodes and remaps edges, mentions, evidence, profiles, and node cards
- **`scripts/run_parallel_lesson_pipeline.py`** - Runs merge → normalize → QA for staged lesson batches
- **`scripts/parallel_batch_runner.py`** - Generates parallel lesson extraction plans from textbook outlines

#### Historical SQLite Schema
- Added `lesson_runs`, `staging_nodes`, `staging_edges`, `staging_profiles`, `staging_mentions`, `staging_evidence`, `staging_node_cards`
- Added `merge_runs` and `canonical_node_map` for reducer bookkeeping and raw→canonical traceability

### Changed - 2026-04-08

#### Workflow Rewrite
- Replaced direct lesson-to-canonical commit as the primary workflow with `parallel lesson staging -> global canonical merge -> normalize -> QA`
- Updated `normalize_sqlite.py` to rebuild `node_terms` and populate alias text into `node_search`
- Updated top-level docs to describe the new reducer-based architecture

### Added - 2026-04-02

#### New Documentation
- **QUICKSTART.md** - 5-minute quick start guide
- **DOCS_INDEX.md** - Documentation index with navigation by use case
- **CHANGELOG.md** - This file

#### New Agent
- **@lesson-processor** - Encapsulates complete lesson processing workflow
  - Extraction (via /chapter-extract)
  - Node expansion (parallel tasks)
  - Normalization (via /graph-normalize)
  - Closeout (scripts)
  - QA validation (via @qa-reviewer)

### Changed - 2026-04-02

#### Architecture Refactor
- **Manager-Worker Pattern** - Replaced flat task chain with clear separation:
  - **Manager** (@kg-pipeline): Only spawns and monitors tasks, NO business logic
  - **Worker** (@lesson-processor): All business logic in one place
  
- **@kg-pipeline** - Simplified from 358 lines to 150 lines
  - Removed all business logic details
  - Now pure orchestrator: Plan → Spawn → Monitor → Decide
  
- **AGENTS.md** - Updated architecture section
  - Replaced "Flat Hierarchy" diagram with "Manager-Worker Pattern"
  - Emphasized clear responsibility separation
  - Updated workflow description

- **README.md** - Complete rewrite
  - Removed deprecated content (@backbone-builder references)
  - Added correct opencode startup commands
  - Simplified structure
  - Added quick start examples
  
### Deprecated

#### Agents
- **@backbone-builder** - Use `/chapter-extract` skill directly
- **@graph-normalizer** - Use `/graph-normalize` skill directly

#### Scripts
- `scripts/extract_chemistry_complete.py` - Bypassed SQLite, removed
- `scripts/extract_chemistry_v4.py` - Bypassed SQLite, removed

## [Previous Versions]

### Architecture Evolution

1. **Initial**: Monolithic extraction scripts
2. **Agent-based**: Introduced agents for orchestration
3. **Flat Task Chain**: Direct task spawning without wrappers
4. **Manager-Worker** (then-current historical architecture): Clear separation of concerns

### Key Milestones

- **SQLite Migration**: Moved from JSONL to SQLite as primary storage
- **Task-Per-Lesson**: Isolated context for each lesson processing
- **Retrieval-First**: Candidate retrieval before reasoning
- **Immediate Expansion**: Node cards generated during extraction
- **Manager-Worker**: Clear responsibility boundaries

---

## Version Naming Convention

- **Added**: New features
- **Changed**: Changes to existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security improvements
