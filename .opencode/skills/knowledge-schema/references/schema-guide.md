# Schema Guide

Use this guide together with the JSON schema files in `schemas/`.

## Node Types

- `concept`: chemistry concept or principle
- `substance`: named substance, material, gas, liquid, or mixture
- `experiment`: explicit experiment, procedure, or lab task
- `method`: procedural method or operation
- `skill`: chemistry language or representational skill
- `symbol`: chemical symbol, formula, equation, or notation item
- `question`: guiding question or prompt worth preserving as a node

Canonical nodes are global knowledge objects. Textbook structure should stay in outlines and mentions.

## Edge Types

- `contains`: a broader concept contains a narrower concept
- `explains`: one node explains another
- `uses`: an experiment or method uses a substance, tool, or symbol
- `measures`: an experiment or method measures a target
- `produces`: a process or experiment produces a result or substance
- `consumes`: a process or experiment consumes a substance
- `part_of`: part-whole relation when `contains` would point the opposite way
- `prerequisite_for`: one concept must be understood before another
- `same_as`: duplicate or alias relation preserved before merge
- `related_to`: weak but grounded semantic relation

Canonical edges are knowledge-to-knowledge relations. Lesson-level provenance belongs in mentions.

## Mention Records

Mentions are the bridge from textbooks to canonical knowledge.

- `book_id`: the source textbook id
- `anchor_ref`: the textbook structure item such as a lesson or activity
- `target_type`: `node` or `edge`
- `target_id`: the canonical node id or edge id
- `role`: how the textbook anchor treats the target, such as introducing or reviewing it
- `source_refs`: the evidence records that justify this mention

## Pattern Records

Patterns are reusable expansion templates.

- they guide how a node type should be explained
- they define recommended card sections
- they do not replace evidence or framework alignment

Use the pattern library in `data/patterns/junior-chemistry-patterns.json`.

## Node Cards

Node cards are structured explanation artifacts for one canonical node.

- one card maps to one canonical node
- cards are pattern-guided
- cards expand detail without inflating the backbone graph
- cards should cite evidence through `source_refs` and may also cite section-level evidence

## ID Guidance

- Use ASCII IDs only.
- Prefix by record family when possible.
- Keep canonical IDs stable across reruns and across textbooks.
- Prefer deterministic IDs from meaning or normalized labels, not timestamps.

## Evidence Guidance

- Keep `snippet` short and specific.
- Keep `page_start` and `page_end` aligned to the PDF pages actually inspected.
- Use one evidence record for one localized claim or cluster of closely related claims.
- Keep `anchor_ref` aligned to the lesson, activity, or review block being processed.

## Framework Guidance

- Use the framework file as a reference scaffold, not as a hard ontology.
- A canonical node may link to zero, one, or several framework items.
- Leave `framework_refs` empty when the mapping is too uncertain.

## Pattern Guidance

- Match a node to one or more patterns based on node type and intended explanation depth.
- Use the pattern's required sections as the minimum card structure.
- A node card may cite multiple patterns when the node spans more than one mode, but prefer the smallest sensible set.

## Confidence Guidance

- `0.9` to `1.0`: directly stated in text, table, or caption
- `0.7` to `0.89`: relation is explicit but wording is slightly normalized
- `0.5` to `0.69`: conservative local inference from the same lesson
- Below `0.5`: avoid writing the edge unless the user explicitly wants exploratory graph building
