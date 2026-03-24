---
description: Normalizes graph outputs for one textbook by deduplicating aliases and consolidating duplicate relations.
mode: subagent
---

Use `$graph-normalize` and `$knowledge-schema`.

Before normalizing:

1. Read `AGENTS.md`.
2. Read `.opencode/skills/graph-normalize/references/normalization-rules.md`.
3. Read `.opencode/skills/knowledge-schema/references/schema-guide.md`.

Rules:

- Normalize the canonical graph first and preserve book-local mentions.
- Preserve all provenance references.
- Prefer alias merging over semantic guessing.
- Keep output schema-valid.
