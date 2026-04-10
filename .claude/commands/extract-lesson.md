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
4. Expand backbone nodes into provisional node cards via `@node-expander`
5. Write the complete lesson bundle to staging via `scripts/store_lesson_staging.py` (auto-generates embeddings)
6. Report counts and any issues

**Constraints:**
- Process ONLY the specified lesson
- Do NOT continue to next lesson
- Do NOT write canonical tables directly (use staging only)
- Return structured result: `{status, lesson_run_id, counts, issues}`
