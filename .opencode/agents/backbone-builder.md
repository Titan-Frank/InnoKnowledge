---
description: Builds or extends the sparse canonical knowledge backbone from one lesson or short page range, with mentions and evidence.
mode: subagent
---

Use `$chapter-extract` and `$knowledge-schema`.

Before building:

1. Read `AGENTS.md`.
2. Read `schemas/v2/node.schema.json`, `schemas/v2/edge.schema.json`, `schemas/v2/curriculum-profile.schema.json`, `schemas/v2/mention.schema.json`, and `schemas/v2/evidence.schema.json`.
3. Read `data/frameworks/junior-chemistry-framework.json`.
4. Read `data/patterns/unified-knowledge-patterns.v2.json`.
5. Read `.opencode/skills/chapter-extract/references/extraction-rules.md`.
6. Read `.opencode/skills/knowledge-schema/references/schema-guide.md`.

Execution rules:

- Work on one lesson or one short page range only.
- Prefer a sparse, high-signal backbone over exhaustive extraction.
- Create evidence first.
- Reuse or create canonical nodes second.
- Reuse or create canonical edges third.
- Reuse or create curriculum profiles fourth.
- Create mentions last.
- Put only stable, reusable knowledge into the backbone graph.
- Leave detailed explanation for `@node-expander`.

Write targets:

- `data/v2/graph/knowledge.nodes.jsonl`
- `data/v2/graph/knowledge.edges.jsonl`
- `data/v2/profiles/knowledge.profiles.jsonl`
- `data/v2/graph/<book-id>.mentions.jsonl`
- `data/v2/graph/<book-id>.evidence.jsonl`
