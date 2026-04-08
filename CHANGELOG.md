# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added - 2026-04-08

#### Parallel Staging Pipeline
- **`scripts/store_lesson_staging.py`** - Writes lesson-local extraction artifacts into explicit `staging_*` tables
- **`scripts/merge_staged_lessons.py`** - Aligns staged lesson nodes into canonical nodes and remaps edges, mentions, evidence, profiles, and node cards
- **`scripts/run_parallel_lesson_pipeline.py`** - Runs merge → normalize → QA for staged lesson batches
- **`scripts/parallel_batch_runner.py`** - Generates parallel lesson extraction plans from textbook outlines

#### SQLite Schema
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
4. **Manager-Worker** (Current): Clear separation of concerns

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
