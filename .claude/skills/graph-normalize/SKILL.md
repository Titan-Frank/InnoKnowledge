---
name: graph-normalize
description: Deduplicates, canonicalizes, and cleans knowledge graph while preserving textbook provenance and schema validity. Use after extraction to normalize the knowledge graph.
user-invocable: true
---

# Graph Normalize

Normalize canonical graph artifacts after extraction. This skill handles node deduplication, alias merging, cycle detection, isolated node resolution, and relation consolidation.

## Quick Start

```bash
# Called by @kg-pipeline after extraction
# Requires:
#   --output-root (active version)
#   --batch-anchor or --batch-group (for scope)
```

## Workflow

### Phase 1: Pre-flight

1. Read `../../AGENTS.md` for principles
2. Read `../../GLOSSARY.md` for terminology
3. Read `references/normalization-rules.md`
4. Verify `--output-root` exists and contains SQLite dataset
5. Determine scope:
   - Single batch: `--batch-anchor struct:book:lesson:X-Y-Z`
   - Batch group: `--batch-group lesson-X-Y-Z,lesson-X-Y-Z+1,`

### Phase 2: Load Current State

1. Connect to SQLite dataset
2. Load canonical tables:
   - `nodes`, `edges`
   - `profiles`, `mentions`, `evidence`
3. Identify nodes/edges created in current scope for potential deduplication

### Phase 3: Node Deduplication

**Merge candidates** (conservative):

1. Same `node_kind` + identical `canonical_name`
2. Same `node_kind` + one name in other's `aliases`
3. Same `node_kind` + only whitespace/punctuation differs
4. Same `node_kind` + legacy-vs-v2 naming differs

**Never merge** across:
- Different `node_kind` or `node_subkind`
- Without explicit evidence or user approval

**Merge procedure**:

```
For each candidate pair:
  ├─ Verify same semantics
  ├─ Choose survivor (prefer stable ID)
  ├─ Merge aliases
  ├─ Merge profiles (same context only)
  ├─ Update mentions to survivor
  ├─ Propagate ID changes to edges
  └─ Delete duplicate
```

### Phase 4: Edge Consolidation

1. **Exact duplicates**: Same `(from, to, edge_type)`
   - Keep one with highest confidence
   - Merge evidence references

2. **Conflicting relations**: New proposal vs existing edge
   - Do not auto-overwrite
   - Options:
     - Keep old, queue new for review
     - Keep both if not semantically conflicting
     - Request user resolution

3. **Update `edge_layer` and `backbone_expand`**
   - Recompute if node layer changed
   - backbone→backbone: `edge_layer=backbone, backbone_expand=false`
   - backbone↔support: `edge_layer=support, backbone_expand=true`

### Phase 5: Cycle Detection

**Check hierarchical/dependency edges**

Must NOT cycle:
- `is_a`, `instance_of`, `contains`, `part_of`
- `prerequisite_for`, `depends_on`, `extends`

```
Algorithm:
1. Build graph with restricted edge types
2. Run cycle detection (DFS or Tarjan)
3. For each found cycle:
   ├─ Identify problematic edge
   ├─ Log cycle for review
   └─ Halt if cycle includes backbone edges
```

**Acceptable cycles** (association edges):
- `related_to`, `explains`, `uses`, `produces`

### Phase 6: Isolated Node Detection & Resolution

**Definition**: Isolated nodes have NO edges connecting them to the graph.

**Detection algorithm**:
```sql
-- Find nodes with no incoming or outgoing edges
SELECT node_id, canonical_name, node_kind, node_layer
FROM nodes n
WHERE NOT EXISTS (
    SELECT 1 FROM edges e 
    WHERE e.source = n.node_id OR e.target = n.node_id
);
```

**Resolution workflow**:

```
For each isolated node:
  ├─ Determine if isolation is intentional
  │   ├─ Check node_kind (some types may be intentionally isolated)
  │   ├─ Check node_layer (backbone nodes should rarely be isolated)
  │   └─ Check lesson context (introductory concepts may be standalone)
  │
  ├─ If isolation is problematic:
  │   ├─ Search for semantically related nodes in current batch
  │   ├─ Verify relation has evidence support from textbook
  │   ├─ If evidence exists:
  │   │   └─ Add appropriate edge (prefer `related_to` for weak relations)
  │   └─ If no evidence:
  │       └─ Flag for human review, do NOT auto-add edge
  │
  └─ If isolation is intentional:
      └─ Document reason in node.notes field
```

**Edge type selection for resolution**:

| Node Kind | Preferred Edge Types | Notes |
|-----------|---------------------|-------|
| `concept/*` | `is_a`, `related_to` | Check for parent concepts first |
| `entity/*` | `contains`, `related_to`, `uses` | Check for containment or usage |
| `activity/*` | `uses`, `produces`, `measures` | Link to equipment or substances |
| `method/*` | `applies`, `extends` | Link to parent methods |
| `representation/*` | `represents`, `explains` | Link to what it represents |

**Isolation acceptance criteria**:

Isolation is ACCEPTABLE when:
- Node is explicitly introduced in current lesson but not yet connected (early in book)
- Node is a placeholder or cross-reference entry
- Node has `node_layer=support` and serves as auxiliary reference
- Lesson context shows intentional standalone presentation

Isolation is PROBLEMATIC when:
- Node has `node_layer=backbone` (core concepts should connect)
- Node appears in middle/later lessons (should have established relations)
- Node kind typically requires context (`activity/experiment` needs equipment, etc.)
- Multiple isolated nodes suggest systematic extraction gap

**Output**:
- Updated edges table with new connections
- Updated nodes.notes for intentionally isolated nodes
- Report listing: resolved nodes, flagged nodes, intentional isolations

### Phase 7: Alias and Profile Management

**Alias policy**:
- Prefer one canonical Chinese name per node
- Move formulas/abbreviations to `aliases`
- Keep `aliases` unique and sorted

**Profile policy**:
- Never merge across different subject/stage/grade combinations
- Merge same-context profiles conservatively
- Preserve all `framework_refs`, `textbook_refs`, `source_refs`
- Junior-secondary and senior-secondary profiles coexist

### Phase 8: ID Propagation

When canonical IDs change:

1. Update `profiles.node_id`
2. Update `mentions.target_id`
3. Update `edges.source` / `edges.target`
4. Update `node_cards` references
5. Update `evidence` references if applicable

```sql
-- Example propagation pattern
UPDATE edges SET source = ? WHERE source = ?;
UPDATE edges SET target = ? WHERE target = ?;
UPDATE mentions SET target_id = ? WHERE target_id = ?;
```

### Phase 9: Finalize

1. Run `scripts/finalize_batch_runtime.py`
   - Mark proposals as resolved or queued
   - Clean up temporary records

## Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--output-root` | Path | Yes | Active output directory |
| `--batch-anchor` | String | No* | Single batch ID |
| `--batch-group` | String | No* | Comma-separated batch IDs |

*At least one of `--batch-anchor` or `--batch-group` required.

## Output

**Primary**: SQLite canonical tables (updated)

**Secondary**: Optional JSON/JSONL snapshots

**State**: SQLite runtime records updated

## Key Rules

### Code Management

When generating or executing code:

1. **Temporary Code**: Do NOT save
   - One-off scripts for debugging
   - Quick prototypes
   - Throwaway verification scripts

2. **Reusable Code**: Save to project
   - Utility scripts that solve common problems
   - Reusable functions/modules
   - Scripts in `scripts/` directory

3. **Specified Code Errors**: Fix as needed
   - If documented commands/scripts have errors, fix them based on actual context
   - Update documentation if the fix is permanent
   - Report significant discrepancies to user

### Merge Policy
- Conservative: only clear duplicates
- Semantic safety: avoid domain-only merges
- Prefer `related_to` over forced merge

### Preservation
- Never drop evidence while merging
- Never break provenance chain
- Keep `card_layer` aligned with node layer

### Profile Handling
- Preserve older coverage when adding new
- Missing current batch coverage != deletion warrant
- Explicit user instruction required for profile deletion

### Edge Safety
- No auto-overwrite of conflicting edges
- Candidate acceptance ≠ duplicate cleanup
- Keep edge semantics distinct

### Cycle Prevention
**Must be acyclic**:
`is_a`, `instance_of`, `contains`, `part_of`, `prerequisite_for`, `depends_on`, `extends`

**Resolution on cycle detection**:
1. Identify edge causing cycle
2. Review semantics
3. Resolve by: delete, retype, or manual review

### Isolated Node Resolution
**Evidence-first**: Only add edges with textbook evidence support
**Conservative connection**: Prefer `related_to` for uncertain relations
**Backbone priority**: Backbone nodes must connect; support nodes may be isolated
**Documentation**: Intentionally isolated nodes must have reason in `notes` field
**Systematic gaps**: High isolated node rate indicates extraction issues, not normalization issues

## Error Handling

### Blocker Scenarios

| Scenario | Action |
|----------|--------|
| Cycle in hierarchical edges | Halt, report blocker |
| Conflicting canonical edges | Halt (or queue for review based on config) |
| Missing target node for edge | Halt, report blocker |
| ID propagation fails | Halt, rollback changes |
| Excessive isolated backbone nodes (>10%) | Halt, report systematic extraction gap |

### Warning Scenarios

| Scenario | Action |
|----------|--------|
| Near-duplicate detected but uncertain | Log, keep separate |
| Profile merge conflict | Keep both, flag for review |
| Isolated backbone node (single) | Auto-resolve if evidence exists, else flag |
| Isolated support node | Document in notes, continue |

## References

- `references/normalization-rules.md` - Detailed normalization rules (99 lines)
- `../knowledge-schema/references/schema-guide.md` - Schema semantics
- `../../GLOSSARY.md` - Terminology
- `../../CONVENTIONS.md` - Standards
