# Architecture Refactor: Manager-Worker Pattern

## Date: 2026-04-02

## Summary

Refactored the agent architecture from a "flat task chain" to a "manager-worker pattern" to improve clarity, maintainability, and separation of concerns.

## Changes

### 1. Created `@lesson-processor` Agent

**File**: `.opencode/agents/lesson-processor.md`

**Role**: Encapsulates ALL business logic for processing a single lesson

**Responsibilities**:
- Extraction (via `$chapter-extract` skill)
- Node expansion (parallel Tasks to `@node-expander`)
- Normalization (via `$graph-normalize` skill)
- Closeout (run scripts)
- QA validation (via `@qa-reviewer`)

**Key Principle**: Process ONE lesson only, then return status to parent.

### 2. Simplified `@kg-pipeline` Agent

**File**: `.opencode/agents/kg-pipeline.md`

**Role**: Pure orchestrator with NO business logic

**Responsibilities**:
- **Plan** - Determine which lessons to process
- **Spawn** - Launch subagent Tasks
- **Monitor** - Check completion status
- **Decide** - Continue or halt based on results

**What it DOESN'T do**:
- No extraction logic
- No direct SQLite writes
- No schema validation
- No state accumulation

### 3. Updated `AGENTS.md`

**Changes**:
- Replaced "Flat Hierarchy" architecture diagram with "Manager-Worker Pattern"
- Updated Layer definitions to reflect clear separation
- Workflow Overview now references `@lesson-processor` as the business logic carrier
- Emphasized that Manager only spawns and monitors, never executes

## Architecture Comparison

### Before (Flat Task Chain)

```
@kg-pipeline
├── Task($chapter-extract, lesson-1)
├── Task(@node-expander, node-A)
├── Task(@node-expander, node-B)
├── Task($graph-normalize, lesson-1)
├── Task(closeout, lesson-1)
├── Task(@qa-reviewer, lesson-1)
│
├── Task($chapter-extract, lesson-2)
└── ...

Problem: @kg-pipeline had to know all extraction details
```

### After (Manager-Worker)

```
@kg-pipeline (Manager)
├── Task(@outline-reader) if needed
│
└── FOR each lesson:
    └── Task(@lesson-processor)
        ├── $chapter-extract
        ├── Task(@node-expander) × N (parallel)
        ├── $graph-normalize
        ├── closeout scripts
        └── @qa-reviewer

Benefit: Clear separation - Manager decides "what", Worker knows "how"
```

## Benefits

### 1. Clear Responsibility Boundaries

**Manager** (@kg-pipeline):
- Only orchestrates
- No domain knowledge required
- Easy to test (only checks spawn/monitor logic)

**Worker** (@lesson-processor):
- All domain logic in one place
- Self-contained workflow
- Clear input/output contract

### 2. Better Maintainability

- **Before**: Extraction logic scattered across kg-pipeline and skills
- **After**: All lesson processing logic in one agent file

- **Before**: Changes to workflow required editing kg-pipeline
- **After**: Changes only affect lesson-processor

### 3. Improved Readability

- **Before**: 358 lines in kg-pipeline (orchestration + business logic mixed)
- **After**: 150 lines in kg-pipeline (pure orchestration) + 200 lines in lesson-processor (business logic)

### 4. Easier Debugging

- **Before**: Failure could be in any layer, hard to isolate
- **After**: 
  - Failure to spawn? → Manager issue
  - Failure in extraction? → Worker issue
  - Clear ownership of each failure type

### 5. Better Testing

- **Manager**: Test only spawn/monitor logic (mock workers)
- **Worker**: Test complete workflow in isolation

## Migration Notes

### For Users

**No changes required** - entry point remains `@kg-pipeline`

Usage is identical:
```
@kg-pipeline --book-md-path data/sources/book.md
```

### For Developers

**New Agent**: When adding workflow steps:
1. Add logic to `@lesson-processor`
2. Update lesson-processor.md
3. Manager automatically benefits

**Manager Changes**: When changing orchestration:
1. Modify `@kg-pipeline`
2. No need to touch business logic

## Validation Checklist

- [x] Created `@lesson-processor.md` with complete workflow
- [x] Simplified `@kg-pipeline.md` to pure orchestration
- [x] Updated `AGENTS.md` architecture section
- [x] Maintained backward compatibility (entry point unchanged)
- [x] Preserved all critical rules (Task-per-lesson, serial execution, etc.)
- [x] Clear separation: Manager = spawn/monitor, Worker = execute/validate

## Future Improvements

Potential next steps:

1. **Add retry logic** in Manager for transient failures
2. **Add checkpointing** to resume from failed lesson
3. **Add parallel book processing** (multiple books concurrently, each with serial lessons)
4. **Add metrics collection** in Manager (timing, success rates)
5. **Add circuit breaker** pattern for repeated failures

## Questions?

See:
- `AGENTS.md` - Project architecture
- `.opencode/agents/kg-pipeline.md` - Manager agent
- `.opencode/agents/lesson-processor.md` - Worker agent
