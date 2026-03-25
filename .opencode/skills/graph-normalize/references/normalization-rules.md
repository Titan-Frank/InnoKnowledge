# Graph Normalization Rules

## Merge Policy

- Merge nodes only when they are clearly the same canonical object.
- Good merge candidates:
  - same `node_kind` and identical `canonical_name`
  - same `node_kind` and one `canonical_name` appears in the other's `aliases`
  - same `node_kind` and only whitespace, punctuation, transliteration, or legacy-vs-v2 naming differs

## Canonical Name Policy

- Prefer a stable, textbook-grounded Chinese label as `canonical_name` when Chinese is the source language.
- Move formulas, abbreviations, and alternate wording into `aliases`.
- Keep `aliases` unique and sorted when practical.

## Profile Policy

- Do not merge curriculum profiles across different subject / school_stage / grade_band combinations.
- If two profiles point to the same canonical node and the same stage context, merge objectives and references conservatively.
- Preserve all `framework_refs`, `textbook_refs`, and `source_refs`.

## Evidence Policy

- Never break the provenance chain from canonical targets to mentions and evidence.
- When canonical ids change, update every affected profile, mention, and node card.

## Edge Policy

- Deduplicate exact matches on `from`, `to`, and `edge_type`.
- Preserve the highest confidence only when the relation is otherwise identical.
- Do not collapse semantically different edge types even if endpoints are the same.

## Safety Policy

- Avoid semantic merges that depend on outside domain knowledge alone.
- If two nodes might be related but are not obviously identical, connect them with `related_to` or keep them separate.

## Cycle Prevention Policy

### Edge Types That Must NOT Cycle

The following edge types form hierarchies or dependency structures and **must NOT create cycles**:

| Edge Type | Reason |
|-----------|--------|
| `is_a` | Type hierarchy cannot be circular |
| `instance_of` | Membership hierarchy cannot loop |
| `contains` | Containment hierarchy cannot be circular |
| `part_of` | Part-whole hierarchy cannot loop |
| `prerequisite_for` | Dependency chains must be acyclic |
| `depends_on` | Dependency chains must be acyclic |
| `extends` | Extension hierarchy must be acyclic |

### Edge Types That May Cycle

The following edge types represent associations and **cycles are acceptable**:

| Edge Type | Reason |
|-----------|--------|
| `related_to` | General associations can be bidirectional |
| `explains` | Mutual explanation is valid |
| `uses` | Operational relationships can be mutual |
| `produces` | Reversible systems may cycle |
| `measures` | Measurement relationships can point both ways in different contexts |
| `analogous_to` | Analogy is symmetric |
| `same_as` | Equivalence is symmetric |

### Cycle Resolution

When a cycle is detected in hierarchical edges:

1. identify the problematic edge
2. review the semantics
3. resolve by:
   - deleting the edge if incorrect
   - retyping the edge to a non-hierarchical type if the relation is valid but not hierarchical
   - keeping it only when the cycle is in an allowed edge family
