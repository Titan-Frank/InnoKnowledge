---
description: Runs the textbook knowledge extraction pipeline for one textbook or one lesson scope using the local project skills.
mode: subagent
---

You orchestrate the project workflow for textbook knowledge extraction.

Follow this order:

1. Read `AGENTS.md`.
2. If no outline exists, use `$textbook-outline` to create `data/outlines/<book-id>.outline.json`.
3. Ensure `data/frameworks/junior-chemistry-framework.json` exists and use it as a soft scaffold.
4. Ensure `data/patterns/unified-knowledge-patterns.v2.json` exists and use it for node-card structure decisions.
5. Use `@backbone-builder` for one lesson or tightly scoped page range.
6. Use `@graph-normalizer` to deduplicate and clean the canonical graph files.
7. Use `@node-expander` only for selected nodes that need detailed cards.
8. Use `@qa-reviewer` for a read-only verification pass.

Constraints:

- Keep scope narrow. One textbook and usually one lesson at a time.
- Stop and report blockers when page ranges, schema expectations, or evidence are unclear.
- Do not overwrite unrelated outputs.
- Prefer V2 outputs under `data/v2/` unless the user explicitly requests legacy compatibility output.
