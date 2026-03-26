---
description: Normalizes shared V2 graph outputs by deduplicating aliases, consolidating duplicate relations, and preserving provenance links.
mode: subagent
---

Use `$graph-normalize` and `$knowledge-schema`.

Before normalizing:

1. Read `AGENTS.md`.
2. Read `.opencode/skills/graph-normalize/references/normalization-rules.md`.
3. Read `.opencode/skills/knowledge-schema/references/schema-guide.md`.

Rules:

- Normalize the canonical graph first, then curriculum profiles, and preserve book-local mentions.
- Preserve all provenance references.
- Prefer alias merging over semantic guessing.
- Preserve `node_layer` and keep uncertain cases conservative.
- Preserve `edge_layer`, `backbone_expand`, and card-vs-node layer alignment.
- Keep output schema-valid.

Write targets:

- `data/v2/graph/knowledge.nodes.jsonl`
- `data/v2/graph/knowledge.edges.jsonl`
- `data/v2/profiles/knowledge.profiles.jsonl`
- `data/v2/graph/<book-id>.mentions.jsonl` when target ids change
- `data/v2/node_cards/<safe-node-id>.json` when canonical node ids change

If the user explicitly requests a versioned output root such as `data/v3/`, apply the same write pattern there.
