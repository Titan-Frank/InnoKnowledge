# Chapter Extraction Rules

## Scope

- Extract one lesson, one activity block, or one short page range at a time.
- Avoid whole-book extraction in a single pass.
- Treat textbook structure as provenance, not as the canonical knowledge tree.

## Evidence First

- Create evidence records before nodes and edges.
- Keep `snippet` concise and local to the claim.
- Use captions and tables only when they add information not already present in the body text.
- Put the local lesson or activity id into `anchor_ref`.

## Node Selection

- Create `concept` nodes for definitions, principles, and recurring chemistry ideas.
- Create `substance` nodes for named materials such as oxygen, carbon dioxide, and air.
- Create `experiment` nodes for explicit lab procedures and investigation tasks.
- Create `method` nodes for reusable operations such as collection, heating, filtration, or testing.
- Create `symbol` nodes for formulas, equations, and notation that are taught as distinct content.
- Create `skill` nodes for chemistry-language skills such as reading symbols or writing equations.

## Canonicalization

- Prefer reusing existing canonical nodes in `data/graph/knowledge.nodes.jsonl`.
- Use `framework_refs` when the alignment to the curriculum framework is reasonably clear.
- Do not create lesson nodes in the canonical graph.
- Record lesson-level appearance through mentions, not through chapter-parent edges.
- Record only backbone-worthy concepts and relations here. Detailed explanation should be deferred to node cards.

## Relation Selection

- Use `uses` when an experiment or method directly uses a substance, tool, or notation item.
- Use `measures` only when measurement is explicit.
- Use `produces` and `consumes` only when the text clearly indicates a process relation.
- Use `prerequisite_for` sparingly and only within tightly related lesson content.
- Prefer `related_to` over inventing a new relation type.

## Mention Selection

- Create a mention for every canonical node or edge that is substantively supported in the current lesson.
- Use the mention `role` to preserve how the lesson treats the target, such as `introduces`, `focuses_on`, `demonstrates`, or `reviews`.

## Expansion Boundary

- Do not write node cards during backbone extraction unless the user explicitly asks for it.
- Keep the backbone sparse enough that a human can review it quickly.

## Naming

- Keep textbook wording as `name`.
- Put formulas, abbreviations, and alternate phrasings in `aliases`.
- Avoid merging two names during extraction; leave deduplication to normalization.
