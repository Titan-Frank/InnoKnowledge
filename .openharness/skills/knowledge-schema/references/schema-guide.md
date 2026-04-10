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

This field is required and must contain at least one value.

Practical defaults:

- `concept`, `principle`, `process`, backbone `entity`, `representation` -> `conceptual`
- support `entity` -> `factual`
- `method`, `skill`, `activity` -> `procedural`
- `issue` -> `conceptual`

### `properties`

Use `properties` for compact, stable, structured facts that can be expressed as key-value data without losing meaning.

Good fits for `properties`:

- short attribute-value pairs
- small controlled lists
- compact structured values that are likely to be reused in filtering or display
- stable descriptors that do not depend on long explanation

Typical examples:

- substance appearance, color, odor, solubility, state
- equipment type or instrument category
- experiment method, materials, or short step labels
- representation notation family
- issue category or application type

Avoid using `properties` for:

- long explanatory paragraphs
- examples and non-examples
- procedural detail with important caveats
- misconception handling
- evidence discussion
- curriculum expectations
- anything that needs sentence-level context to be understood safely

Rule of thumb:

- if the content still makes sense as a short field-value pair, prefer `properties`
- if the content needs bullets, narrative, comparison, caution, or interpretation, prefer a node card section

Examples:

- good `properties`
  - `{"color":"无色","odor":"无气味"}`
  - `{"instrument_type":"玻璃仪器"}`
  - `{"method":"红磷燃烧法"}`
  - `{"steps":["溶解","过滤","蒸发"]}`
- better in node card, not `properties`
  - why a method works
  - how to distinguish related concepts
  - common errors in an experiment
  - textbook examples with interpretation

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

Preservation policy:

- One canonical node may have multiple curriculum profiles across subjects, school stages, and grade bands.
- When new senior-secondary or other stage coverage is added, append a new profile for that context instead of overwriting earlier junior-secondary coverage.
- Only merge profiles when they describe the same `subject` + `school_stage` + `grade_band` context.
- The fact that a current source does not mention an older stage is not evidence for deleting that older stage profile.

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

Use only these schema-valid edge types. Do not invent near-synonyms such as `relates_to`, `represents`, `contrasts_with`, or `improves`.

## Edge Layer

- `edge_layer = backbone`: the edge belongs in the default backbone view and usually connects two backbone nodes
- `edge_layer = support`: the edge mainly belongs to support expansion and usually involves at least one support node
- `backbone_expand = true`: selecting the backbone endpoint should expand the support endpoint in the viewer
- `backbone_expand = false`: the edge should not be used as a default support-expansion trigger

Typical defaults:

- usually `edge_layer = backbone`, `backbone_expand = false`:
  - backbone-to-backbone structural relations
  - stable prerequisite, explanation, or classification relations inside the main trunk
- usually `edge_layer = support`, `backbone_expand = true`:
  - backbone-to-support relations used to open experiments, methods, representations, or issue contexts around a backbone node
- usually `edge_layer = support`, `backbone_expand = false`:
  - support-to-support operational relations
  - support relations that should remain local detail rather than default expansion handles

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
- `extraction_method`: manual, ocr, speech_to_text, mixed

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
- `card_layer` should normally match the canonical node's `node_layer`
- cards are pattern-guided
- cards expand detail without inflating the backbone graph
- cards should cite evidence through `source_refs`
- cards may link to curriculum profiles through `profile_refs`

### Properties Vs Node Cards

Use this split consistently:

- `properties`
  - stable
  - compact
  - structured
  - reusable for filtering or quick scanning
- `node card`
  - explanatory
  - comparative
  - cautionary
  - example-rich
  - sectioned by pattern

Few-shot examples:

1. `entity/substance:oxygen`
   - put in `properties`
     - `{"color":"无色","odor":"无味","state":"气体"}`
   - put in node card
     - supporting combustion explanation
     - common laboratory identification method and caveats
     - textbook experiment interpretation

2. `entity/equipment:funnel`
   - put in `properties`
     - `{"instrument_type":"玻璃仪器"}`
   - put in node card
     - when to use it in filtration
     - common setup mistakes
     - relation to filter paper and receiving vessel

3. `activity/experiment:salt-purification`
   - put in `properties`
     - `{"steps":["溶解","过滤","蒸发"]}`
   - put in node card
     - why this order matters
     - observation points
     - safety cautions
     - error-prone steps

4. `concept:chemical-change`
   - usually keep `properties` empty unless the source gives a small, stable taxonomy field
   - put in node card
     - definition expansion
     - comparison with physical change
     - positive and negative examples
     - common confusion points

5. `representation/formula:chemical-equation`
   - put in `properties`
     - `{"notation_type":"symbolic-representation"}`
   - put in node card
     - how to read it
     - balance interpretation
     - relation to reactant and product

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
