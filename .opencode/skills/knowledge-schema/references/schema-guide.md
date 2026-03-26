# Schema Guide

Use this guide together with the V2 JSON schema files in `schemas/v2/`.

## Canonical Node Model

Canonical nodes represent stable knowledge objects that should remain reusable across textbooks, grade bands, and subjects.

### `node_kind`

- `entity`: a distinguishable object such as a substance, organism, place, person, or institution
- `concept`: an abstract concept, category, or definition
- `process`: a change process, mechanism, or evolution process
- `principle`: a law, rule, theorem, mechanism, or general principle
- `method`: a reusable method for solving or doing something
- `skill`: an assessable capability or operational skill
- `representation`: a symbol system, notation, diagram, formula, or model representation
- `activity`: an experiment, investigation, task, or learning activity
- `event`: a historical or real-world event
- `issue`: a discussable issue or problem space

### `node_layer`

- `backbone`: the node belongs to the main knowledge trunk and should remain visible in a default backbone view
- `support`: the node is canonical and reusable, but mainly supports explanation, procedure, representation, equipment, experiment, or contextual expansion around backbone nodes

Use `node_layer` to separate the main knowledge network from auxiliary canonical nodes without losing provenance or graph connectivity.

Typical defaults:

- usually `backbone`:
  - `concept`
  - `principle`
  - `process`
  - stable `entity` nodes such as substances or essential microscopic entities
- usually `support`:
  - `method`
  - `activity`
  - `representation`
  - equipment-like `entity` nodes
  - `issue`

If a node is globally reusable but should not dominate the main map, keep it canonical and mark it `support`.

### `learning_modes`

Use one or more:

- `factual`
- `conceptual`
- `procedural`
- `metacognitive`

These are instructional descriptors, not ontology classes.

### `bridge_tags`

Use bridge tags to mark concepts that can connect across disciplines:

- `system`
- `structure`
- `function`
- `change`
- `interaction`
- `energy`
- `matter`
- `evidence`
- `model`
- `representation`
- `measurement`
- `classification`
- `rule`
- `scale`
- `causality`
- `uncertainty`

## Curriculum Profiles

Curriculum profiles are the stage-specific or subject-specific projection of a canonical node.

Use them for:

- `subject`
- `school_stage`
- `grade_band`
- `curriculum_role`
- `mastery_level`
- `learning_objectives`
- `framework_refs`
- `textbook_refs`

Do not write these fields into the canonical node unless needed temporarily for migration compatibility.

## Edge Types

### Classification / structure

- `is_a`
- `instance_of`
- `contains`
- `part_of`

### Dependency / progression

- `prerequisite_for`
- `depends_on`
- `extends`

### Semantic / causal

- `explains`
- `causes`
- `affects`
- `has_property`

### Operational / application

- `uses`
- `measures`
- `produces`
- `consumes`
- `applies_to`

### Representation / cross-disciplinary

- `represented_by`
- `symbolizes`
- `analogous_to`
- `same_as`
- `related_to`

Canonical edges are knowledge-to-knowledge relations. Lesson-level provenance belongs in mentions.

## Mention Records

Mentions bridge local source anchors to graph objects.

- `source_type`: textbook, curriculum, exercise, assessment, note, media, other
- `source_id`: the source artifact id
- `anchor_ref`: the local anchor inside that source
- `target_type`: node, edge, profile, or card
- `target_id`: the target graph object id
- `role`: how the source treats the target
- `source_refs`: evidence records that justify the mention

## Evidence Records

Evidence records capture source-local support.

- `source_type`: where the evidence came from
- `source_id`: the source artifact id
- `anchor_ref`: the local source anchor
- `excerpt`: a short, local supporting passage
- `locator`: page, figure, table, section, or other locator string
- `extraction_method`: manual, pdftotext, ocr, speech_to_text, mixed

Keep evidence local and specific. One evidence record should support one localized claim or a tightly related cluster of claims.

## Pattern Records

Patterns are reusable expansion templates for node cards.

- They guide how a `node_kind` should be expanded.
- They define required card sections.
- They do not replace evidence or curriculum profile alignment.

Use the pattern library in `data/patterns/unified-knowledge-patterns.v2.json`.

## Node Cards

Node cards are structured explanation artifacts for one canonical node.

- one card maps to one canonical node
- cards are pattern-guided
- cards expand detail without inflating the backbone graph
- cards should cite evidence through `source_refs`
- cards may link to curriculum profiles through `profile_refs`

## ID Guidance

- Use ASCII IDs only.
- Keep canonical IDs stable across reruns.
- Prefer semantically meaningful IDs instead of timestamps.
- Legacy IDs are allowed during migration, but new work should prefer node-kind-aware IDs such as:
  - `entity/substance:oxygen`
  - `activity/experiment:oxygen-content-determination`
  - `representation/symbol:o2`

## Confidence Guidance

- `0.9` to `1.0`: directly stated in text, table, caption, or curriculum wording
- `0.7` to `0.89`: relation is explicit but wording is slightly normalized
- `0.5` to `0.69`: conservative local inference from the same lesson or source block
- Below `0.5`: avoid writing the edge unless the user explicitly wants exploratory graph building
