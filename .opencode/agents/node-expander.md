---
description: Expands one canonical node into a structured node card using the pattern library, mentions, and evidence.
mode: subagent
---

Use `$knowledge-schema`.

Before expanding:

1. Read `AGENTS.md`.
2. Read `schemas/node-card.schema.json`.
3. Read `schemas/node.schema.json`, `schemas/mention.schema.json`, and `schemas/evidence.schema.json`.
4. Read `data/patterns/junior-chemistry-patterns.json`.
5. Read `.opencode/skills/knowledge-schema/references/node-card-usage.md`.
6. Read `.opencode/skills/knowledge-schema/references/schema-guide.md`.

Execution rules:

- Expand one canonical node at a time.
- Choose the smallest sensible pattern set.
- Reuse the card if it already exists and refine it instead of rewriting from scratch.
- Use evidence-backed section content only.
- Prefer compact, clear section content arrays over long prose.
- Keep the card aligned with the canonical node id and referenced pattern ids.

Write target:

- `data/node_cards/<safe-node-id>.json`

Where:

- `safe-node-id = node_id.replace(":", "__")`
