# Knowledge Extraction Project

This project turns textbook content into a stable, evidence-backed knowledge representation that can later be imported into a graph database.

## Goal

- Keep the main backbone as canonical knowledge points and relations.
- Use the curriculum framework as a reference scaffold, not a rigid source of truth.
- Use textbook chapters only as provenance anchors, not as the primary knowledge tree.
- Keep every canonical node and edge traceable to textbook evidence.

## Required Workflow

1. Create or refresh `data/outlines/<book-id>.outline.json`.
2. Read `data/frameworks/junior-chemistry-framework.json` and `data/patterns/junior-chemistry-patterns.json` before creating new canonical nodes.
3. Use the backbone flow to extract one lesson or one tightly scoped page range at a time.
4. Reuse or extend canonical knowledge in `data/graph/knowledge.nodes.jsonl` and `data/graph/knowledge.edges.jsonl`.
5. Record book-local provenance in `data/graph/<book-id>.mentions.jsonl` and `data/graph/<book-id>.evidence.jsonl`.
6. Expand node cards only after the backbone node is stable enough to deserve detailed explanation.
7. Run a read-only QA pass before trusting the result.

Do not skip the outline stage for a new textbook unless the user explicitly asks for ad hoc extraction.

## Output Contract

- Outline: `data/outlines/<book-id>.outline.json`
- Framework: `data/frameworks/junior-chemistry-framework.json`
- Pattern library: `data/patterns/junior-chemistry-patterns.json`
- Canonical nodes: `data/graph/knowledge.nodes.jsonl`
- Canonical edges: `data/graph/knowledge.edges.jsonl`
- Mentions: `data/graph/<book-id>.mentions.jsonl`
- Evidence: `data/graph/<book-id>.evidence.jsonl`
- Node cards: `data/node_cards/<safe-node-id>.json`
  - Use `safe-node-id = node_id` with every `:` replaced by `__`

Read these schema files before writing output:

- `schemas/framework.schema.json`
- `schemas/pattern-library.schema.json`
- `schemas/outline.schema.json`
- `schemas/node.schema.json`
- `schemas/edge.schema.json`
- `schemas/mention.schema.json`
- `schemas/evidence.schema.json`
- `schemas/node-card.schema.json`

## Evidence Rules

- Every mention must reference at least one evidence record.
- Evidence must include the source PDF path, page range, and outline anchor.
- Canonical nodes and edges must be supportable through mentions and evidence, even if the evidence is not embedded directly on the canonical record.
- Prefer exact textbook wording for `name`.
- Put alternate wording, symbols, formulas, and short aliases in `aliases`.
- If a relation is inferred rather than explicit, keep it conservative and lower confidence.

## Knowledge Backbone Rules

- The primary tree is concept-centric, not chapter-centric.
- Prefer canonical IDs such as `concept:air-composition` or `substance:oxygen`.
- Link nodes and edges to curriculum framework items with `framework_refs` when it helps normalization.
- Use the pattern library as expansion guidance for what a mature node card should contain.
- Do not force every extracted node to map to the curriculum framework if the textbook contains a useful but more local concept.
- Keep textbook outline anchors in mentions and evidence, not as the main parent-child structure for canonical knowledge nodes.
- Keep the canonical graph sparse. If a detail is explanatory rather than structural, prefer putting it into a node card section instead of promoting it into a new backbone node.

## Node Card Rules

- One node card maps to exactly one canonical node.
- A node card expands a node with structured sections, not free-form essay text.
- Every node card must cite evidence via `source_refs`.
- Use the pattern library to decide which sections are required for each node type.
- If evidence is weak or incomplete, omit the section or state the gap conservatively in the section content.

## ID Rules

- Use lowercase ASCII IDs with `:` or `-`.
- Recommended prefixes:
  - `concept:`
  - `substance:`
  - `experiment:`
  - `method:`
  - `skill:`
  - `symbol:`
  - `question:`
  - `framework:`
  - `pattern:`
  - `struct:`
  - `mention:`
  - `evidence:`
  - `edge:`
- Keep IDs stable across reruns for the same textbook whenever possible.

## Extraction Boundaries

- Work on one textbook at a time.
- Work on one lesson or one short page range at a time.
- Prefer merging into the shared canonical knowledge files when the identity is clear.
- If identity across books is unclear, keep the new node separate and flag it for normalization instead of forcing a merge.
- Do not invent latent knowledge that is not grounded in the textbook text, tables, diagrams, or captions.

## Preferred Tools

- Use project skills in `.opencode/skills/` before improvising a new workflow.
- Prefer `pdftotext -layout` for fast text extraction.
- Use the outline extraction script for TOC parsing before attempting manual JSON writing.
- Use the curriculum framework file as a soft anchor when naming or grouping canonical nodes.
- Use the pattern library to keep node cards consistent across node types.

## Review Checklist

- Schema-valid fields only.
- No canonical edge whose endpoints are missing.
- No mention without evidence.
- No evidence without an outline anchor.
- No duplicated canonical nodes that differ only by whitespace, punctuation, or obvious aliases.
- No relation promoted to the canonical graph unless the book-local evidence clearly supports it.
- If a node card exists, its sections should match at least one referenced pattern and every section should be supportable by the card's evidence.
