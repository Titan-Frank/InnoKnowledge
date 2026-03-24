# Node Card Usage

Use node cards to expand one canonical node into a readable, evidence-backed explanation artifact.

## Purpose

- keep the backbone graph sparse
- make each important node easy to read and reuse
- separate stable graph structure from richer explanatory detail

## Writing Rules

- Expand one canonical node at a time.
- Read the matching pattern or patterns first.
- Use section titles and section ids that match the pattern library.
- Prefer short bullet-like statements inside `content` arrays instead of long prose paragraphs.
- Every card must keep a concise `summary` at the top.
- Every card must include `source_refs`.
- If a section is weakly supported, omit it instead of guessing.

## File Path

Write cards to:

- `data/node_cards/<safe-node-id>.json`

Where:

- `safe-node-id = node_id.replace(":", "__")`

Example:

- `substance:oxygen` -> `data/node_cards/substance__oxygen.json`

## What Belongs In A Card

- definitions
- key properties
- examples and non-examples
- applications
- related experiments
- common mistakes
- next learning directions

## What Does Not Belong In A Card

- unsupported claims from outside the textbook corpus
- whole-book summaries
- duplicate copies of the entire lesson text
- relationship clutter that should stay in the backbone graph
