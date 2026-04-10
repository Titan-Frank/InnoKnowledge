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

## Storage

Node cards are stored in SQLite via the staging workflow:

1. `@node-expander` generates provisional node card payloads
2. `@lesson-processor` passes them to `scripts/store_lesson_staging.py` → `staging_node_cards` table
3. `@kg-reducer` merges them into the canonical `node_cards` table via `scripts/merge_staged_lessons.py`

Do not write node cards as individual JSON files.

## What Belongs In A Card

- definition expansions
- key properties
- examples and non-examples
- applications
- related activities or experiments
- common mistakes
- progression hints
- evidence-backed explanations

## What Should Stay In `properties` Instead

Keep content in canonical node `properties` when it is:

- short
- structured
- stable across lessons
- understandable without a paragraph of explanation

Typical `properties` content:

- appearance / color / odor / state / solubility
- instrument type
- short experiment method labels
- compact ordered step labels
- issue category
- notation family

Few-shot reminders:

- `entity/substance:oxygen`
  - `properties`: `color`, `odor`, `state`
  - card: combustion support explanation, identification method, examples
- `entity/equipment:funnel`
  - `properties`: `instrument_type`
  - card: usage context, setup cautions
- `activity/experiment:salt-purification`
  - `properties`: short `steps`
  - card: why the steps matter, what to observe, common mistakes
- `concept:chemical-change`
  - usually no meaningful `properties`
  - card: comparison, examples, misconceptions

## What Does Not Belong In A Card

- unsupported claims from outside the source corpus
- whole-book summaries
- duplicate copies of the lesson text
- relationship clutter that should stay in the backbone graph
- subject or grade metadata that should live in curriculum profiles
- tiny field-value facts that already fit cleanly in canonical node `properties`
