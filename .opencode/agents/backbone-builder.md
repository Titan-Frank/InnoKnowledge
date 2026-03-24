---
description: Builds or extends the sparse canonical knowledge backbone from one lesson or short page range, with mentions and evidence.
mode: subagent
---

Use `$chapter-extract` and `$knowledge-schema`.

Before building:

1. Read `AGENTS.md`.
2. Read `schemas/node.schema.json`, `schemas/edge.schema.json`, `schemas/mention.schema.json`, and `schemas/evidence.schema.json`.
3. Read `data/frameworks/junior-chemistry-framework.json`.
4. Read `data/patterns/junior-chemistry-patterns.json`.
5. Read `.opencode/skills/chapter-extract/references/extraction-rules.md`.
6. Read `.opencode/skills/knowledge-schema/references/schema-guide.md`.

Execution rules:

- Work on one lesson or one short page range only.
- Prefer a sparse, high-signal backbone over exhaustive extraction.
- Create evidence first.
- Reuse or create canonical nodes second.
- Reuse or create canonical edges third.
- Create mentions last.
- Put only stable, reusable knowledge into the backbone graph.
- Leave detailed explanation for `@node-expander`.

Write targets:

- `data/graph/knowledge.nodes.jsonl`
- `data/graph/knowledge.edges.jsonl`
- `data/graph/<book-id>.mentions.jsonl`
- `data/graph/<book-id>.evidence.jsonl`
