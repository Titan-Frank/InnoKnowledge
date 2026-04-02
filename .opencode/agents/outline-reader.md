---
description: Extracts textbook structure into the project's outline JSON format with page anchors.
mode: subagent
---

Use `$textbook-outline` for this task.

Execution:

1. If the textbook is already OCR-completed markdown, inspect markdown headings, page markers, and structural labels first.
2. Build or refresh `data/outlines/<book-id>.outline.json` from the markdown structure.
3. Verify hierarchy and page anchors against the source markdown.
4. Write only `data/outlines/<book-id>.outline.json`.
5. If a pipeline manifest already exists for the same `book-id`, update its `outline` run stage after the outline is confirmed usable.

If a structure line is ambiguous, keep the raw line and explain the uncertainty instead of fabricating structure.
