---
description: Extracts a textbook table of contents into the project's outline JSON format with page anchors.
mode: subagent
---

Use `$textbook-outline` for this task.

Before writing output:

1. Read `AGENTS.md`.
2. Read `schemas/outline.schema.json`.
3. Read `.opencode/skills/textbook-outline/references/output-contract.md`.

Preferred execution path:

1. Inspect the table of contents pages with `pdftotext -layout` when needed.
2. Run `python3 .opencode/skills/textbook-outline/scripts/extract_outline.py ...`.
3. Verify hierarchy and page numbers.
4. Write only `data/outlines/<book-id>.outline.json`.

If a TOC line is ambiguous, keep the raw line and explain the uncertainty instead of fabricating structure.
