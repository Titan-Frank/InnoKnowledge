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

## Node Layer Policy

- Preserve `node_layer` when merging or renaming nodes.
- Do not change a node from `support` to `backbone` unless the normalized target is clearly a main knowledge anchor.
- When merging two nodes with different layers, prefer the more conservative result:
  - keep `backbone` only if both nodes are clearly backbone-worthy
  - otherwise keep `support` and report the case if uncertain

## Profile Policy

- Do not merge curriculum profiles across different subject / school_stage / grade_band combinations.
- If two profiles point to the same canonical node and the same stage context, merge objectives and references conservatively.
- Preserve all `framework_refs`, `textbook_refs`, and `source_refs`.
- Preserve older stage coverage when newer stage coverage is added. Junior-secondary and senior-secondary profiles for the same canonical node should coexist.
- Do not treat missing coverage in the current batch as a reason to delete an existing profile.
- Do not delete a profile unless it is an exact duplicate or the user explicitly requests removal.

## Evidence Policy

- Never break the provenance chain from canonical targets to mentions and evidence.
- When canonical ids change, update every affected profile, mention, and node card.
- Keep `card_layer` aligned with the surviving canonical node's `node_layer`.

## Edge Policy

- Deduplicate exact matches on `from`, `to`, and `edge_type`.
- Preserve the highest confidence only when the relation is otherwise identical.
- Do not collapse semantically different edge types even if endpoints are the same.
- Preserve `edge_layer` and `backbone_expand` when endpoints stay semantically aligned.
- If a normalized merge changes a node from backbone-connected to support-connected, recompute `edge_layer` and `backbone_expand` conservatively instead of carrying an obviously stale value.
- When a new relation proposal conflicts with an existing canonical edge, do not overwrite the old edge automatically.
- Prefer one of:
  - keep the old edge and leave the new relation in review
  - keep both only if they are not actually semantically conflicting
  - resolve by explicit review or user instruction
- Treat candidate relation acceptance as a separate decision from duplicate-edge cleanup.
- When PostgreSQL runtime changes the canonical graph, export the current dataset snapshot back into `<output-root>/` in the same batch instead of leaving the published file layer stale.

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

## Isolated Node Policy

### Definition

Isolated nodes are nodes with **no incoming or outgoing edges**.

### Detection Priority

1. **Backbone nodes** - MUST have edges unless intentionally isolated with documented reason
2. **Support nodes** - MAY be isolated if serving as auxiliary reference

### Resolution Workflow

When an isolated node is detected:

1. **Check node_kind context**:
   - `concept/*` - Should connect to parent concepts or related topics
   - `entity/*` - Should connect to usage context or containment
   - `activity/*` - Should connect to equipment, substances, or methods
   - `method/*` - Should connect to applications or extensions
   - `representation/*` - Should connect to what it represents

2. **Search for related nodes**:
   - Query current batch for semantically related nodes
   - Verify evidence support in textbook excerpts
   - Prefer existing evidence over adding new edges

3. **Add edges if evidence exists**:
   - Use appropriate edge type based on relationship
   - Prefer `related_to` for weak or uncertain relations
   - Link `source_refs` to existing evidence

4. **Document if intentionally isolated**:
   - Add reason to `notes` field
   - Examples: "Placeholder for future content", "Cross-reference entry", "Introductory concept awaiting connection"

5. **Flag for review if uncertain**:
   - Do NOT auto-add edges without evidence
   - Create review task for human judgment

### Acceptable Isolation Scenarios

Isolation is ACCEPTABLE when:
- Node is introduced in early lessons (connections appear later)
- Node is a placeholder or reference entry
- Support node serving as auxiliary information
- Lesson context shows intentional standalone presentation

Isolation is PROBLEMATIC when:
- Backbone node in middle/later lessons
- Node kind typically requires context (e.g., `activity/experiment` without equipment)
- Multiple isolated nodes suggest systematic extraction gap

### Excessive Isolation Threshold

If **>10% of backbone nodes** are isolated after resolution attempts:
- **HALT** the pipeline
- Report systematic extraction gap
- Review extraction quality before continuing
