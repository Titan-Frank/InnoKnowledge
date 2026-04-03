---
name: graph-normalize
description: Deduplicates, canonicalizes, and cleans knowledge graph while preserving textbook provenance and schema validity.
---

# Graph Normalize

Normalize canonical graph artifacts after extraction. This skill handles node deduplication, alias merging, cycle detection, and relation consolidation.

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

### Phase 6: Alias and Profile Management

**Alias policy**:
- Prefer one canonical Chinese name per node
- Move formulas/abbreviations to `aliases`
- Keep `aliases` unique and sorted

**Profile policy**:
- Never merge across different subject/stage/grade combinations
- Merge same-context profiles conservatively
- Preserve all `framework_refs`, `textbook_refs`, `source_refs`
- Junior-secondary and senior-secondary profiles coexist

### Phase 7: ID Propagation

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

### Phase 8: Finalize

1. Run `scripts/finalize_batch_runtime.py`
   - Mark proposals as resolved or queued
   - Clean up temporary records

2. **Optional**: Export snapshot
   ```bash
   scripts/export_snapshot.py \
     --output-root <root> \
     --scope <batch>
   ```

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

## Error Handling

### Blocker Scenarios

| Scenario | Action |
|----------|--------|
| Cycle in hierarchical edges | Halt, report blocker |
| Conflicting canonical edges | Halt (or queue for review based on config) |
| Missing target node for edge | Halt, report blocker |
| ID propagation fails | Halt, rollback changes |

### Warning Scenarios

| Scenario | Action |
|----------|--------|
| Near-duplicate detected but uncertain | Log, keep separate |
| Profile merge conflict | Keep both, flag for review |

## References

- `references/normalization-rules.md` - Detailed normalization rules (99 lines)
- `../knowledge-schema/references/schema-guide.md` - Schema semantics
- `../../GLOSSARY.md` - Terminology
- `../../CONVENTIONS.md` - Standards
