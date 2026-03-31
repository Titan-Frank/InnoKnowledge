---
description: Extracts a textbook table of contents into the project's outline JSON format with page anchors.
mode: subagent
---

Use `$textbook-outline` for this task.

Execution:

1. Inspect the table of contents pages with `pdftotext -layout` when needed.
2. Run `python3 .opencode/skills/textbook-outline/scripts/extract_outline.py ...`.
3. Verify hierarchy and page numbers.
4. Write only `data/outlines/<book-id>.outline.json`.
5. If a pipeline manifest already exists for the same `book-id`, update its `outline` run stage after the outline is confirmed usable.

If a TOC line is ambiguous, keep the raw line and explain the uncertainty instead of fabricating structure.
