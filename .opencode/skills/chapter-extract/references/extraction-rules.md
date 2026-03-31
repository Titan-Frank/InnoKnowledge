# Chapter Extraction Rules

## Scope

- Extract one lesson, one activity block, or one short page range at a time.
- Avoid whole-book extraction in a single pass.
- Treat textbook structure as provenance, not as the canonical knowledge tree.

## Evidence First

- Create evidence records before nodes and edges.
- Keep `excerpt` concise and local to the claim.
- Use captions and tables only when they add information not already present in the body text.
- Put the local lesson or activity id into `anchor_ref`.

## Three-Layer Selection Rule

### G1: Backbone Node

Create a canonical node only when the item:

1. can be defined independently
2. can connect to other nodes through stable relations
3. is likely to recur across lessons, textbooks, or stages
4. can stand as a learning goal or assessment focus

### G2: Card Section / Micro-claim

Keep these out of the backbone by default:

- local properties
- key judgment points
- procedural substeps
- common errors
- explanatory examples

These belong in node cards later.

### G2.5: `properties` Vs Node Card

Use canonical node `properties` only for compact structured facts.

Put information into `properties` when it is:

1. short enough to read as a field-value pair
2. stable for the canonical node
3. likely to help quick scanning, filtering, or future retrieval
4. not dependent on long explanation

Put information into node cards when it is:

1. explanatory
2. example-driven
3. cautionary
4. comparative
5. procedural with important context

Default extraction rule:

- if unsure, leave `properties` sparse and defer the detail to a node card
- do not invent filler properties just to avoid an empty section in the viewer

### G3: Evidence / Example

Keep these in provenance only:

- textbook sentences
- examples
- figure descriptions
- exercise prompts
- local observations

## Node Selection

- Create `concept` nodes for abstract ideas, categories, and definitions.
- Create `entity` nodes for named substances, organisms, places, persons, or institutional objects.
- Create `activity` nodes for explicit experiments, investigations, and task blocks worth preserving.
- Create `method` nodes for reusable operations such as collection, heating, filtration, testing, comparison, or source analysis.
- Create `principle` nodes for laws, mechanisms, rules, and stable explanatory claims.
- Create `representation` nodes for formulas, equations, diagrams, notation, and symbol systems taught as distinct content.
- Create `skill` nodes for reusable, assessable capabilities.
- Create `issue` nodes only when the source clearly frames a persistent topic as a discussable issue.

Use `node_subkind` when a narrower label helps:

- `entity/substance`
- `activity/experiment`
- `representation/symbol`

## Properties Selection

Good `properties` candidates:

- `entity/substance`
  - `appearance`
  - `color`
  - `odor`
  - `state`
  - `solubility`
- equipment-like `entity`
  - `instrument_type`
- `activity/experiment`
  - `method`
  - short `steps`
  - short `materials`
- `issue`
  - `issue_type`
  - `application_domain`
- `representation`
  - `notation_type`

Avoid putting these in `properties`:

- textbook sentences copied verbatim
- long lists of examples
- definitions that belong in `definition`
- grade/stage expectations that belong in profiles
- relation facts that belong in edges
- long explanation or reasoning that belongs in node cards

Few-shot examples:

1. `entity/substance:nitrogen`
   - good `properties`
     - `{"color":"无色","odor":"无气味","solubility":"难溶于水"}`
   - not `properties`
     - "氮气为什么能作保护气" -> node card

2. `entity/equipment:funnel`
   - good `properties`
     - `{"instrument_type":"玻璃仪器"}`
   - not `properties`
     - "过滤时如何配合玻璃棒使用" -> node card

3. `activity/experiment:salt-purification`
   - good `properties`
     - `{"steps":["溶解","过滤","蒸发"]}`
   - not `properties`
     - "为什么先过滤再蒸发" -> node card

4. `concept:chemical-change`
   - good `properties`
     - usually none
   - not `properties`
     - "与物理变化的区别、例子、易错点" -> node card

## Node Layer Selection

- Use `node_layer = backbone` when the node is a stable, cross-lesson knowledge anchor that should appear in the main knowledge trunk.
- Use `node_layer = support` when the node is mainly there to explain, operate on, evidence, represent, or contextualize a backbone node.
- Typical `backbone` nodes:
  - core concepts
  - principles
  - processes
  - key substances or other stable entities
  - essential microscopic entities when they are themselves learning anchors
- Typical `support` nodes:
  - experiments
  - reusable methods
  - equipment
  - formulas, equations, diagrams, and other representations
  - issue or application contexts
- If the node is reusable but would clutter the main trunk when shown by default, keep it canonical but mark it as `support`.

## Canonicalization

- Prefer reusing existing canonical nodes from the active SQLite dataset.
- Create or refine curriculum profiles in the active SQLite dataset.
- If the same canonical node is learned in a new stage or grade, add another curriculum profile for that context instead of replacing the old one.
- Do not delete prior stage coverage during a new extraction pass. Existing junior-secondary and senior-secondary profiles may coexist on the same canonical node.
- Use `framework_refs` primarily on profiles.
- Do not create lesson nodes in the canonical graph.
- Record lesson-level appearance through mentions, not through chapter-parent edges.
- Record only backbone-worthy concepts and relations here. Detailed explanation should be deferred to node cards.
- Before deciding reuse or relation creation, retrieve a small candidate node set using exact names, aliases, normalized terms, and filtered search.
- Persist the batch retrieval inputs in SQLite runtime staging, and export `<output-root>/runs/runtime/<book-id>/<batch-anchor>.queries.jsonl` only when a debug or replay dump is explicitly needed.
- Do not ask the extractor to reason over the whole canonical graph at once.

## Relation Selection

- Use `contains` and `part_of` only for stable structural relations.
- Use `is_a` for clear type membership.
- Use `has_property` when a property is stable and reusable.
- Use `uses` when an activity or method directly uses a substance, tool, or representation.
- Use `measures` only when measurement is explicit.
- Use `produces` and `consumes` only when the source clearly indicates a process relation.
- Use `prerequisite_for` and `depends_on` sparingly and only when learning or semantic dependence is clear.
- Prefer `related_to` over inventing a new relation type.
- Extract relations in two steps:
  - first as lesson-local proposals
  - then as small-scope normalized canonical edges
- Persist lesson-local relation proposals in SQLite runtime staging, and export `<output-root>/runs/runtime/<book-id>/<batch-anchor>.relation-proposals.jsonl` only when a debug or replay dump is explicitly needed.
- Only promote a proposal into a canonical edge when:
  - both endpoints are justified in the current constrained candidate context
  - the relation has explicit evidence support
  - the relation does not conflict with an existing canonical edge without review
- If a relation conflicts with an existing canonical edge, do not overwrite the older edge automatically.
- If evidence is weak or absent, keep the relation out of the canonical graph.

## Edge Layer Selection

- Use `edge_layer = backbone` when the relation should remain visible in the default main-trunk view.
- Use `edge_layer = support` when the relation mainly exists to attach experiments, methods, representations, equipment, or contextual issues around a backbone node.
- Use `backbone_expand = true` only when the relation should serve as a default expansion handle from a backbone node to a support node.
- Typical default:
  - backbone -> backbone: `edge_layer = backbone`, `backbone_expand = false`
  - backbone <-> support: `edge_layer = support`, `backbone_expand = true`
  - support <-> support: `edge_layer = support`, `backbone_expand = false`

## Mention Selection

- Create a mention for every canonical node, edge, or profile that is substantively supported in the current lesson.
- Use the mention `role` to preserve how the lesson treats the target, such as `introduces`, `defines`, `focuses_on`, `demonstrates`, or `reviews`.

## Expansion Boundary

- Do not write node cards during backbone extraction unless the user explicitly asks for it.
- Keep the backbone sparse enough that a human can review it quickly.

## Naming

- Keep textbook wording in `canonical_name` when it is stable and reusable.
- Put formulas, abbreviations, and alternate phrasings in `aliases`.
- Avoid merging two names during extraction; leave deduplication to normalization.
