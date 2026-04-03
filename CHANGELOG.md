# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added - 2026-04-02

#### New Documentation
- **QUICKSTART.md** - 5-minute quick start guide
- **DOCS_INDEX.md** - Documentation index with navigation by use case
- **CHANGELOG.md** - This file

#### New Agent
- **@lesson-processor** - Encapsulates complete lesson processing workflow
  - Extraction (via $chapter-extract)
  - Node expansion (parallel tasks)
  - Normalization (via $graph-normalize)
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
- **@backbone-builder** - Use `$chapter-extract` skill directly
- **@graph-normalizer** - Use `$graph-normalize` skill directly

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
