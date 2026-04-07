# Task-Per-Lesson Execution Guide

## What is Task-Per-Lesson?

Task-Per-Lesson is a **critical execution pattern** that ensures each lesson is processed in an isolated LLM context. This prevents:

- **Context explosion**: LLM context grows beyond limits when processing multiple lessons
- **Cross-lesson contamination**: Concepts bleeding between lessons
- **Inconsistent deduplication**: Each lesson must see fresh SQLite state

## How It Works

### Correct Pattern ✅

```
Main Agent (@kg-pipeline)
│
├── Task #1: Process Lesson 1-1-1
│   ├── Extract nodes, profiles, evidence
│   ├── Expand node cards (parallel Tasks)
│   ├── Normalize graph
│   └── QA validation
│   └── RETURN results → Main Agent
│
├── Main Agent receives results
├── Main Agent updates manifest
│
├── Task #2: Process Lesson 1-1-2
│   ├── Extract nodes, profiles, evidence
│   ├── Expand node cards (parallel Tasks)
│   ├── Normalize graph
│   └── QA validation
│   └── RETURN results → Main Agent
│
├── Main Agent receives results
└── ... (repeat for each lesson)
```

### Wrong Pattern ❌

```
Subagent
│
├── Process Lesson 1-1-1
├── Process Lesson 1-1-2  ← ❌ Same context continues
├── Process Lesson 1-1-3  ← ❌ Context keeps growing
└── ... (eventually fails)
```

## How to Use

### Option 1: Use @kg-pipeline (Recommended)

@kg-pipeline is configured to automatically spawn isolated Tasks:

```bash
# Start pipeline
@kg-pipeline --book-id chem-grade8-shanghai-all-in-one --output-root data/v4

# It will:
# 1. Spawn Task for lesson 1-1-1
# 2. Wait for completion
# 3. Spawn Task for lesson 1-1-2
# 4. Wait for completion
# ... (sequential processing)
```

**Important**: @kg-pipeline should:
- Use `task()` tool for each lesson
- Wait for each Task to complete
- Then spawn next Task
- **NOT** let a subagent continue autonomously

### Option 2: Use run_single_lesson.py (Manual)

For maximum control, process each lesson manually:

```bash
# Generate prompt for next lesson
python scripts/run_single_lesson.py --book-id chem-grade8-shanghai-all-in-one

# This will output:
# "### 单课提取任务
#  课程信息: Lesson 1-1-2 - 通用的化学语言
#  ...
#  ⚠️ 完成这节课后，请运行：
#  python scripts/run_single_lesson.py ..."

# Then:
# 1. Copy the prompt
# 2. Start a NEW conversation/session
# 3. Paste the prompt
# 4. Complete the lesson
# 5. Run the script again for next lesson
```

This approach guarantees complete isolation between lessons.

## Verification

Check if Task-Per-Lesson pattern is being followed:

```bash
python scripts/verify_task_per_lesson.py --book-id <book-id>
```

This script checks:
- ✅ Lessons completed sequentially
- ✅ No batch processing detected
- ✅ Proper stage progression
- ❌ Flags issues if wrong pattern used

## Common Mistakes

### Mistake 1: Subagent Continues to Next Lesson

**Symptom**: One subagent processes multiple lessons without returning

**Solution**: Ensure subagent returns after completing one lesson:
```
Process lesson 1-1-1 → RETURN results
Main agent spawns new Task for lesson 1-1-2
```

### Mistake 2: Batch Processing

**Symptom**: Multiple lessons marked as completed at same timestamp

**Solution**: Use `task()` tool for each lesson, with proper wait between

### Mistake 3: Skipping Lessons

**Symptom**: Lesson 3 completed but lesson 2 is pending

**Solution**: Process lessons in strict outline order

## Debugging

If verification fails, check:

1. **Manifest**: `data/v4/runs/<book-id>.pipeline.json`
   - Look for sequential completion
   - Check timestamps

2. **SQLite**: `storage/knowledge.sqlite`
   - Check created_at timestamps for nodes
   - Should show progression across lessons

3. **Logs**: Check for Task spawn/complete patterns

## Implementation Details

For agent/skill developers:

### In @kg-pipeline

```python
# CORRECT
for lesson in lessons:
    result = task(
        description=f"process-{lesson['anchor']}",
        prompt=f"Process ONLY {lesson['anchor']}. STOP after completion.",
        subagent_type="general"
    )
    # Wait for result
    update_manifest(result)
    # Then spawn next

# WRONG
for lesson in lessons:
    process_lesson(lesson)  # ❌ Same context
```

### In /chapter-extract

```
⚠️ CRITICAL: Single Lesson Scope Only

This skill processes EXACTLY ONE lesson.
DO NOT continue to next lesson.
```

## Summary

**Task-Per-Lesson is mandatory** because:
- Each lesson gets fresh LLM context
- Prevents context explosion
- Ensures consistent deduplication
- Isolates failures to single lesson
- Enables processing of 100+ lessons

**Remember**:
- ✅ One Task per lesson
- ✅ Spawn Task → Wait → Spawn next Task
- ✅ Main agent orchestrates
- ❌ No continuous processing
- ❌ No subagent autonomy across lessons
