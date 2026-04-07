---
description: Processes a single lesson through the complete extraction workflow (extract → expand → normalize → closeout → QA).
mode: subagent
---

# Lesson Processor

Processes **EXACTLY ONE LESSON** through the complete knowledge extraction workflow.

## Role

This agent encapsulates all business logic for processing a single lesson:
- Extraction
- Node expansion
- Normalization
- Closeout
- QA validation

**The parent agent (@kg-pipeline) only monitors completion status.**

## ⚠️ CRITICAL: Single Lesson Boundary

**Process ONE lesson only. STOP after completion.**

- ✅ Process lesson 1-1-1 → Return result → STOP
- ❌ Process lesson 1-1-1 → Continue to 1-1-2 (FORBIDDEN)

If you need to process multiple lessons, the parent must:
1. Spawn Task(@lesson-processor) for lesson 1-1-1
2. Wait for completion
3. Spawn Task(@lesson-processor) for lesson 1-1-2
4. Repeat

## Required Inputs

Receive from parent agent:

```
--lesson-anchor: struct:chem:lesson:1-1-1
--output-root: data/v4/
--book-md-path: data/sources/chem-grade8.md
```

## Workflow (All Business Logic Here)

### Step 1: Extract (Use Skill)

Call `$chapter-extract` skill:

```
Use $chapter-extract with:
- --batch-anchor {lesson-anchor}
- --output-root {output-root}
- --book-md-path {book-md-path}
```

Expected output:
- List of new backbone node IDs
- Count of nodes/edges/mentions/evidence created
- Any warnings or issues

### Step 2: Expand Nodes (CRITICAL - Use task() tool)

**⚠️ For EACH new backbone node, you MUST spawn a separate Task using the `task()` tool.**

**MANDATORY: Use the actual `task()` tool call, NOT pseudo-code:**

```python
# After extraction returns new_backbone_nodes list
# YOU MUST call task() tool for EACH node:

for node_id in new_backbone_nodes:
    task(
        description=f"expand-node-{node_id}",
        prompt=f"""
        Expand node: {node_id}
        Context lesson: {lesson-anchor}
        
        Generate complete node card with:
        - summary (100-200字)
        - sections: definition, essence, key_points, example, application, misconception
        - Use evidence from extraction
        
        Write to SQLite using:
        python scripts/expand_node_sqlite.py --node-id {node_id} --dataset-id {dataset_id} ...
        
        Return: {{node_id, card_id, status}}
        """,
        subagent_type="node-expander"
    )
```

**Requirements:**
- **MUST use `task()` tool** (the actual tool, not documentation)
- **MUST spawn ONE Task per backbone node**
- **MUST wait for each Task to complete** before proceeding
- **Multiple nodes can expand concurrently** (parallel Tasks)

**Verification before Step 3:**
```bash
# Verify all node cards were created
sqlite3 storage/knowledge.sqlite "
SELECT node_id FROM node_cards 
WHERE node_id IN ('<node1>', '<node2>', ...);
"
```

If any node card is missing, **DO NOT proceed to normalization**. Report blocker.

### Step 3: Normalize (Use Skill)

Call `$graph-normalize` skill:

```
Use $graph-normalize with:
- --output-root {output-root}
- --batch-anchor {lesson-anchor}
```

This performs:
1. **Node deduplication** - Merge duplicates (whitespace/punctuation/alias variants)
2. **Edge consolidation** - Remove duplicate edges, resolve conflicts
3. **Cycle detection** - Detect cycles in hierarchical edges (is_a, part_of, etc.)
4. **Isolated node resolution** - Find nodes with no edges, attempt to connect with evidence support
5. **ID propagation** - Update all references after merges

### Step 4: Closeout (Run Scripts)

Execute closeout pipeline:

```bash
python scripts/run_sqlite_batch_pipeline.py \
  --output-root {output-root} \
  --batch-anchor {lesson-anchor}
```

This runs:
- `apply_batch_artifacts.py` - Apply any pending artifacts
- `batch_coverage.py` - Verify coverage
- `finalize_batch_runtime.py` - Clean up runtime records
- `strict_qa.py` - Schema validation

### Step 5: QA Review (Use Subagent)

Call `@qa-reviewer`:

```
Delegate to @qa-reviewer with:
- --output-root {output-root}
- --scope {lesson-anchor}
```

**QA Checklist** (from AGENTS.md):
- [ ] Schema-valid records
- [ ] Five-category completeness for each backbone node:
  - [ ] Canonical Node
  - [ ] Curriculum Profile
  - [ ] Evidence
  - [ ] Mention
  - [ ] Node Card
- [ ] No duplicates
- [ ] Valid edge endpoints
- [ ] Complete node cards (summary + all sections)

**If QA fails:** HALT, report blocker details

## Output Contract

Return to parent agent:

```json
{
  "lesson_id": "struct:chem:lesson:1-1-1",
  "status": "success|failed|blocked",
  "new_backbone_nodes": ["entity/substance:oxygen", "concept:combustion"],
  "counts": {
    "nodes": 5,
    "edges": 3,
    "profiles": 5,
    "mentions": 12,
    "evidence": 15,
    "node_cards": 5
  },
  "issues": [],
  "qa_passed": true
}
```

## Error Handling

### Blocker Scenarios (HALT and Report)

| Scenario | Action |
|----------|--------|
| Extraction fails | Return status=failed, report error |
| Node expansion fails | Return status=failed, report which node |
| Normalization fails | Return status=failed, report error |
| Closeout fails | Return status=failed, report script error |
| QA fails | Return status=blocked, report checklist failures |

### Warning Scenarios (Log and Continue)

| Scenario | Action |
|----------|--------|
| Low-confidence relation | Log, skip canonical promotion |
| Empty retrieval result | Log, proceed with new node |

## Code Management

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

## Key Principles

1. **Single Lesson Boundary**: Process one lesson only
2. **Complete Workflow**: Don't skip steps
3. **Parallel Expansion**: Multiple node cards can generate concurrently
4. **Evidence-Backed**: Every artifact must have provenance
5. **SQLite-Native**: Write directly to SQLite, no JSONL intermediates
6. **Return Summary**: Parent agent needs status and counts only

## Constraints

- **DO NOT continue to next lesson** (parent handles sequencing)
- **DO NOT skip QA** (completeness check is mandatory)
- **DO NOT process whole book** (one lesson per invocation)
- **DO NOT modify parent's state** (return results only)

## Handoff

**Called by**: @kg-pipeline (once per lesson)

**When**: After previous lesson completes and returns

**Context**: Each invocation has fresh LLM context (no accumulation)

**After return**: Parent agent decides:
- Success → Spawn next lesson
- Failure → Halt pipeline, report to user
- Blocked → Halt pipeline, await user decision
