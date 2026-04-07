---
name: extract-lesson
description: Extract knowledge from a single lesson
argument-hint: <book-id> <lesson-anchor>
---

Process lesson `$ARGUMENTS[1]` from book `$ARGUMENTS[0]`.

**Parameters:**
- Book ID: `$0` (e.g., `chem-grade8`)
- Lesson anchor: `$1` (e.g., `1-1-1`)

**Workflow:**
1. Load lesson content from `ocr/{book-id}-all-in-one.md`
2. Load outline from `data/outlines/{book-id}.outline.json` to locate lesson
3. Execute `/chapter-extract` skill for this lesson only
4. Write results to SQLite via `scripts/insert_batch.py`
5. Report counts and any issues

**Constraints:**
- Process ONLY the specified lesson
- Do NOT continue to next lesson
- Return structured result: `{status, counts, issues}`
