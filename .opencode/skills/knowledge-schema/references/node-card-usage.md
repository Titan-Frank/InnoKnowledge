# Node Card Usage

Use node cards to expand one canonical node into a readable, evidence-backed explanation artifact.

## Purpose

- keep the backbone graph sparse
- make each important node easy to read and reuse
- separate stable graph structure from richer explanatory detail
- allow different node kinds to expand through different section patterns

## Writing Rules

- Expand one canonical node at a time.
- Set `card_layer` to match the referenced canonical node's `node_layer`.
- Read the matching pattern or patterns first.
- Use section titles and section ids that match the pattern library.
- Prefer short bullet-like statements inside `content` arrays instead of long prose paragraphs.
- Keep `summary` concise and stable.
- Every card should keep section-level or card-level `source_refs`.
- If a section is weakly supported, omit it instead of guessing.

## File Path

Write cards to:

- `<output-root>/node_cards/<safe-node-id>.json`

Where:

- `safe-node-id = node_id.replace(":", "__").replace("/", "__")`

Example:

- `entity/substance:oxygen` -> `<output-root>/node_cards/entity__substance__oxygen.json`

## What Belongs In A Card

- definition expansions
- key properties
- examples and non-examples
- applications
- related activities or experiments
- common mistakes
- progression hints
- evidence-backed explanations

## What Does Not Belong In A Card

- unsupported claims from outside the source corpus
- whole-book summaries
- duplicate copies of the lesson text
- relationship clutter that should stay in the backbone graph
- subject or grade metadata that should live in curriculum profiles
