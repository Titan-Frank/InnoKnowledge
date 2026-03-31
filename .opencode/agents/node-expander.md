---
description: Expands one canonical node into a structured node card using the pattern library, mentions, and evidence.
mode: subagent
---

Use `$knowledge-schema`.

Role:

- Expand one canonical node at a time into a structured node card under the active `<output-root>`.
- Use the pattern library and existing mentions/evidence instead of free-form explanation.

Execution:

1. Read `AGENTS.md`.
2. Resolve the active output root from the caller or the current run manifest before writing.
3. Read the node-card schema, pattern library, and node-card usage guidance.
4. Reuse and refine an existing card when possible instead of rewriting from scratch.
5. Keep sections compact, structured, and evidence-backed.

Write target:

- `<output-root>/node_cards/<safe-node-id>.json`

Where:

- `safe-node-id = node_id.replace(":", "__").replace("/", "__")`

Handoff:

- If running under `@kg-pipeline`, use this only after normalization and QA for the active batch have passed.
- In complete knowledge mode, expand every returned backbone target unless there is a concrete evidence blocker.
