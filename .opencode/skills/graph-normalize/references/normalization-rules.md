# Graph Normalization Rules

## Merge Policy

- Merge nodes only when they are clearly the same entity within the same textbook.
- Good merge candidates:
  - same `node_type` and identical `name`
  - same `node_type` and one `name` appears in the other's `aliases`
  - same `node_type` and only whitespace or punctuation differs

## Canonical Name Policy

- Prefer the textbook's Chinese label as `name`.
- Move formula, abbreviation, and alternate wording into `aliases`.
- Keep `aliases` unique and sorted when practical.

## Evidence Policy

- Never break the provenance chain from canonical targets to mentions and evidence.
- When canonical ids change, update every affected mention.

## Edge Policy

- Deduplicate exact matches on `from`, `to`, and `edge_type`.
- Preserve the highest confidence only when the relation is otherwise identical.

## Safety Policy

- Avoid semantic merges that depend on outside chemistry knowledge.
- If two nodes might be related but are not obviously identical, connect them with `related_to` or keep them separate.
