---
description: Extract knowledge from a single lesson
agent: lesson-processor
subtask: true
---

Process lesson `$1` from book `$ARGUMENTS`.

**Parameters:**
- Book ID: First argument (e.g., `chem-grade8`)
- Lesson anchor: Second argument (e.g., `1-1-1`)

**Workflow:**
1. Load lesson content from `data/sources/{book-id}-all-in-one.md`
2. Load outline from `data/outlines/{book-id}.outline.json` to locate lesson
3. Execute `$chapter-extract` skill for this lesson only
4. Write results to SQLite via `scripts/insert_batch.py`
5. Report counts and any issues

**Constraints:**
- Process ONLY the specified lesson
- Do NOT continue to next lesson
- Return structured result: `{status, counts, issues}`
