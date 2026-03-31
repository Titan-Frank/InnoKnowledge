# Knowledge Map Extraction Project

This project turns textbook content into a stable, evidence-backed, cross-disciplinary knowledge map that can later be imported into a graph database or ontology system.

## Goal

- Keep the main backbone as canonical knowledge points and relations.
- Treat the knowledge map as global-first, not textbook-first.
- Use curriculum framework files as reference scaffolds, not rigid ontologies.
- Use textbook structure only as provenance anchors, not as the primary knowledge tree.
- Keep every node, edge, profile, and node card traceable to evidence.
- Separate:
  - knowledge backbone
  - curriculum profile
  - node card
  - provenance

## Required Workflow

1. Create or refresh `data/outlines/<book-id>.outline.json`.
2. Read the relevant framework and pattern files before creating new canonical nodes.
3. Use the backbone flow to extract one lesson or one tightly scoped page range at a time.
4. Reuse or extend canonical knowledge in the current versioned graph files under the active output root, such as `data/v4/`.
5. Record curriculum-stage projections in `<output-root>/profiles/knowledge.profiles.jsonl`.
6. Record book-local provenance in `<output-root>/graph/<book-id>.mentions.jsonl` and `<output-root>/graph/<book-id>.evidence.jsonl`.
7. Expand node cards only after the backbone node is stable enough to deserve detailed explanation.
8. Run a read-only QA pass before trusting the result.

Do not skip the outline stage for a new textbook unless the user explicitly asks for ad hoc extraction.

## Default Entry Rule

- If the user asks generically to "extract", "generate", "build", or "refresh" a knowledge map without explicitly limiting the stage, treat that as an end-to-end pipeline request.
- The default project entry for such requests is `@kg-pipeline`, not `@backbone-builder`.
- A generic extraction request should normally cover:
  - outline refresh if needed
  - backbone extraction
  - graph normalization
  - read-only QA
- Use `@backbone-builder`, `@graph-normalizer`, or `@node-expander` directly only when the user explicitly asks for a single stage or when a prior pipeline run is being resumed from a specific stage.

## Whole-Book Rule

- If the user asks to process a whole textbook, do not treat the whole book as one extraction context.
- For whole-book work, first read or refresh the outline, then make a plan from outline anchors.
- Split execution into lesson-sized or tightly scoped chapter-sized batches.
- Prefer lesson-level batches whenever the outline is detailed enough.
- Use multi-agent orchestration for whole-book work:
  - one orchestrator agent keeps the book-level plan
  - worker agents process separate lessons or small batches
  - normalization and QA should run after each batch or after a small group of batches, not only at the very end
- Never ask a single extraction agent to ingest the full textbook body in one prompt unless the user explicitly asks for an ad hoc whole-book pass.
- When reporting progress for whole-book work, report by completed outline anchors or lesson batches.

## Output Contract

- Active output root: `data/<version>/`
  - Examples: `data/v2/`, `data/v3/`, `data/v4/`, `data/v4.1/`, `data/vx/`
  - The version folder is the run target for this extraction pass, not a permanent requirement to use `data/v2/`
- Outline: `data/outlines/<book-id>.outline.json`
- Framework: `data/frameworks/*.json`
- Pattern library: `data/patterns/unified-knowledge-patterns.v2.json`
- Canonical nodes: `<output-root>/graph/knowledge.nodes.jsonl`
- Canonical edges: `<output-root>/graph/knowledge.edges.jsonl`
- Curriculum profiles: `<output-root>/profiles/knowledge.profiles.jsonl`
- Mentions: `<output-root>/graph/<book-id>.mentions.jsonl`
- Evidence: `<output-root>/graph/<book-id>.evidence.jsonl`
- Node cards: `<output-root>/node_cards/<safe-node-id>.json`
  - Use `safe-node-id = node_id` with every `:` replaced by `__` and every `/` replaced by `__`

The legacy files under `data/graph/` and `data/node_cards/` are compatibility outputs. New extraction work should default to the active versioned output root above unless the user explicitly asks for legacy output.

If the user explicitly asks for a specific versioned root such as `data/v3/` or `data/v4/`, use that root. If the run already has an agreed version root, continue writing there. Do not assume `data/v2/` is the default main output; here `v2`, `v3`, `v4`, and similar names refer to run/version directories under `data/`.

Read these schema files before writing output:

- `schemas/framework.schema.json`
- `schemas/outline.schema.json`
- `schemas/v2/node.schema.json`
- `schemas/v2/edge.schema.json`
- `schemas/v2/curriculum-profile.schema.json`
- `schemas/v2/mention.schema.json`
- `schemas/v2/evidence.schema.json`
- `schemas/v2/node-card.schema.json`
- `schemas/v2/pattern-library.schema.json`

## Evidence Rules

- Every mention must reference at least one evidence record.
- Evidence must include source identity, anchor, locator, and extraction method.
- Canonical nodes, edges, and profiles must be supportable through mentions and evidence, even if the evidence is not embedded directly on the canonical record.
- Prefer exact textbook wording for local evidence excerpts.
- If a relation is inferred rather than explicit, keep it conservative and lower confidence.

## Knowledge Map Rules

- The primary tree is knowledge-centric, not chapter-centric.
- A canonical node should remain stable across textbooks, subjects, and grade bands whenever identity is clear.
- Use `node_kind` as the primary ontology axis.
- Every canonical node must also declare `node_layer` as either `backbone` or `support`.
- Every canonical edge must also declare `edge_layer` and `backbone_expand`.
- Use `learning_modes` as a secondary instructional axis.
- Use curriculum profiles to express subject-, stage-, and grade-specific expectations.
- Keep textbook outline anchors in mentions and evidence, not as the main parent-child structure for canonical nodes.
- Keep the canonical graph sparse. If a detail is explanatory rather than structural, prefer putting it into a node card section instead of promoting it into a new backbone node.

## Node Layer Rules

- Use `node_layer = backbone` for core knowledge anchors that define the main map, such as stable concepts, principles, processes, and key entities.
- Use `node_layer = support` for auxiliary canonical nodes that mainly serve explanation, procedure, representation, equipment, experiments, or contextual issue expansion around backbone nodes.
- A support node may still be canonical and reusable across books, but it should not dominate the main backbone view.
- When a node could reasonably live in either layer, prefer `support` unless it is clearly a cross-stage, cross-book knowledge anchor.

## Edge Layer Rules

- Use `edge_layer = backbone` for canonical relations that belong in the default main-trunk view.
- Use `edge_layer = support` for relations that mainly serve expanded explanation around backbone nodes.
- Use `backbone_expand = true` only when the edge should be used to expand a support node from a selected backbone node.
- In normal extraction, `backbone_expand = true` should usually mean one endpoint is `backbone` and the other is `support`.
- Keep `backbone_expand = false` for backbone-to-backbone relations and support-to-support relations unless the user explicitly wants a different interaction model.

## Curriculum Profile Rules

- A curriculum profile is a projection of one canonical node into one subject/stage/grade context.
- Put `subject`, `school_stage`, `grade_band`, `curriculum_role`, and `mastery_level` in the profile, not in the canonical node.
- Use `framework_refs` primarily on profiles; duplicate them on nodes only when they improve discoverability.
- A canonical node may have multiple profiles.
- When a canonical node is taught in a new subject, school stage, or grade band, append a new profile instead of overwriting an existing one.
- Do not merge or replace profiles across different `subject` / `school_stage` / `grade_band` contexts.
- If the context is the same, update conservatively by merging objectives and references; do not delete prior supported content without explicit user approval.

## Preservation Rules

- Extraction and normalization are append-first and non-destructive by default.
- When adding new senior-secondary knowledge, never delete or replace existing junior-secondary nodes, profiles, mentions, evidence, or node cards just because the current source focuses on a different stage.
- Absence from the current lesson, textbook, or framework is not evidence that an existing canonical record should be deleted.
- Preserve cross-stage accumulation: the same canonical node may remain linked to multiple stages, grades, textbooks, and curriculum profiles at the same time.
- Deletion of an existing canonical node, canonical edge, curriculum profile, mention, evidence record, or node card requires explicit user instruction.
- If a rerun would shrink coverage, stop and report the conflict instead of writing a destructive update.

## Node Card Rules

- One node card maps to exactly one canonical node.
- Every node card must declare `card_layer`, and it should normally match the referenced canonical node's `node_layer`.
- A node card expands a node with structured sections, not free-form essay text.
- Every node card must cite evidence via `source_refs`.
- Use the pattern library to decide which sections are required for each node kind.
- If evidence is weak or incomplete, omit the section or state the gap conservatively in the section content.

## ID Rules

- Use lowercase ASCII IDs with `:`, `/`, and `-` only.
- Recommended prefixes:
  - `entity/`
  - `concept:`
  - `process:`
  - `principle:`
  - `method:`
  - `skill:`
  - `representation/`
  - `activity/`
  - `event:`
  - `issue:`
  - `profile:`
  - `node-card:`
  - `framework:`
  - `pattern:`
  - `struct:`
  - `mention:`
  - `evidence:`
  - `edge:`
- Keep IDs stable across reruns for the same knowledge object whenever possible.
- Legacy-style IDs such as `substance:oxygen` are allowed during migration, but new work should prefer `node_kind`-aware IDs such as `entity/substance:oxygen`.

## Extraction Boundaries

- Work on one textbook at a time.
- Work on one lesson or one short page range at a time.
- If the user requests a whole textbook, convert it into a planned sequence of lesson-level or small-batch extraction tasks.
- Prefer merging into the shared canonical knowledge files when the identity is clear.
- If identity across books, stages, or subjects is unclear, keep the new node separate and flag it for normalization instead of forcing a merge.
- Do not invent latent knowledge that is not grounded in the source text, tables, diagrams, captions, or clearly local curriculum statements.

## Preferred Tools

- Use project skills in `.opencode/skills/` before improvising a new workflow.
- Prefer `pdftotext -layout` for fast text extraction.
- Use the outline extraction script for TOC parsing before attempting manual JSON writing.
- Use the curriculum framework file as a soft anchor when naming or grouping canonical nodes.
- Use the pattern library to keep node cards consistent across node kinds.

## Review Checklist

- Schema-valid fields only.
- Every canonical node has a valid `node_layer`.
- Every canonical edge has valid `edge_layer` and `backbone_expand`.
- No canonical edge whose endpoints are missing.
- No curriculum profile whose node is missing.
- No mention without evidence.
- No evidence without an anchor.
- No duplicated canonical nodes that differ only by whitespace, punctuation, aliases, or legacy-vs-v2 naming.
- No relation promoted to the canonical graph unless the source evidence clearly supports it.
- If a node card exists, it should have a valid `card_layer`, its sections should match at least one referenced pattern, and every section should be supportable by the card's evidence.
