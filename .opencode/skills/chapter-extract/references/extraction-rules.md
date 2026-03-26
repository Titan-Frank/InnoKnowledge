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

- Prefer reusing existing canonical nodes in `data/v2/graph/knowledge.nodes.jsonl`.
- Create or refine curriculum profiles in `data/v2/profiles/knowledge.profiles.jsonl`.
- Use `framework_refs` primarily on profiles.
- Do not create lesson nodes in the canonical graph.
- Record lesson-level appearance through mentions, not through chapter-parent edges.
- Record only backbone-worthy concepts and relations here. Detailed explanation should be deferred to node cards.

## Relation Selection

- Use `contains` and `part_of` only for stable structural relations.
- Use `is_a` for clear type membership.
- Use `has_property` when a property is stable and reusable.
- Use `uses` when an activity or method directly uses a substance, tool, or representation.
- Use `measures` only when measurement is explicit.
- Use `produces` and `consumes` only when the source clearly indicates a process relation.
- Use `prerequisite_for` and `depends_on` sparingly and only when learning or semantic dependence is clear.
- Prefer `related_to` over inventing a new relation type.

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
