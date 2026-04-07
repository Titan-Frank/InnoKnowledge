---
name: textbook-outline
description: Extracts structural outline from OCR-completed textbook markdown. Use when processing a new textbook to generate its structural skeleton.
user-invocable: true
---

# Textbook Outline

Create the textbook skeleton before extracting lesson knowledge. Parses markdown headings, page markers, and structural labels to generate outline JSON.

## Quick Start

```bash
# Called by @outline-reader
# Requires:
#   --book-md-path (OCR-completed markdown)
#   --book-id (e.g., chem-grade8-all-in-one)
```

## Workflow

### Phase 1: Pre-flight

1. Read `../../AGENTS.md`
2. Read `../../GLOSSARY.md`
3. Read `schemas/outline.schema.json`
4. Verify markdown source exists and is OCR-completed

### Phase 2: Parse Markdown Structure

1. **Extract headings**
   ```bash
   rg -n "^(#{1,6})\s+|^第[一二三四五六七八九十0-9]+[章单元课节专题主题]" "<book.md>"
   ```

2. **Extract page markers**
   ```bash
   rg -n "^\[?Page[[:space:]]+[0-9]+\]?|^<!--\s*page:" "<book.md>"
   ```

3. **Identify structure types**
   - `theme` - 主题/大单元
   - `topic` - 专题
   - `lesson` - 课题/课程
   - `activity` - 活动/实验
   - `review` - 复习

### Phase 3: Build Outline

1. **Map hierarchy**
   - H1 → Theme
   - H2 → Topic
   - H3 → Lesson
   - H4 → Activity/Subsection

2. **Assign page anchors**
   - Find nearest page marker before each item
   - Derive `page_start` from reliable markers
   - If no reliable markers, report blocker

3. **Generate IDs**
   - Format: `struct:{book-id}:{type}:{path}`
   - Path: `lesson:X-Y-Z` for lesson, `activity:X-Y-Z-A` for activity

### Phase 4: Generate Marked Markdown (NEW)

**This is the key improvement for accurate lesson extraction.**

1. **Read original markdown**
   ```bash
   Read the complete markdown file
   ```

2. **Identify lesson boundaries using LLM**
   
   For each lesson in the outline:
   - Find the exact start position in markdown
   - Find the exact end position (start of next lesson or end of file)
   - Use semantic understanding (not just title matching)
   
   Signals to use:
   - Title/heading text
   - Page markers (if available)
   - Content structure (objectives, examples, exercises)
   - Natural breaks between sections

3. **Insert boundary markers**
   
   Generate a new file with HTML-style markers:
   
   ```markdown
   <!-- LESSON_START id="struct:book:lesson:1-1-1" title="课题1：开启化学之门" pages="3-14" -->
   
   ... original markdown content for this lesson ...
   
   <!-- LESSON_END id="struct:book:lesson:1-1-1" -->
   ```

4. **Write marked markdown**
   ```
   data/outlines/{book-id}.marked.md
   ```

5. **Validate coverage**
   - Check that all lessons have markers
   - Verify no overlapping ranges
   - Ensure complete coverage of the source file

### Phase 5: Validate and Write

1. **Validate hierarchy**
   - Ensure logical parent-child relationships
   - No orphaned lessons
   - No duplicate IDs

2. **Write outputs**
   ```
   data/outlines/{book-id}.outline.json
   data/outlines/{book-id}.marked.md   (NEW)
   ```

3. **Update manifest** (if exists)
   ```
   {output-root}/runs/{book-id}.pipeline.json
   ```

## Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--book-md-path` | Path | Yes | OCR-completed markdown file |
| `--book-id` | String | Yes | Book identifier (`{subject}{stage}{...}`) |

## Output

**Files**:
1. `data/outlines/{book-id}.outline.json` - Outline structure
2. `data/outlines/{book-id}.marked.md` - Markdown with lesson boundary markers (NEW)

**Structure**:

```json
{
  "book_id": "chem-grade8-all-in-one",
  "title": "化学（八年级全一册）",
  "source_path": "ocr/chem-grade8.md",
  "structure": [
    {
      "id": "struct:chem-grade8:theme:1",
      "kind": "theme",
      "label": "主题一",
      "title": "走进化学世界",
      "page_start": 1,
      "page_end": 45,
      "children": [
        {
          "id": "struct:chem-grade8:lesson:1-1-1",
          "kind": "lesson",
          "label": "课题 1",
          "title": "化学使世界变得更加绚丽多彩",
          "page_start": 1,
          "page_end": 8
        }
      ]
    }
  ]
}
```

## Structure Types

| Kind | Extract? | Notes |
|------|----------|-------|
| `theme` | No | Container only, no nodes/profiles |
| `topic` | Yes | Standalone introductions |
| `lesson` | Yes | Core content, always extract |
| `activity` | Yes | Experiments as activity nodes |
| `review` | No | Provenance anchor only |

## Key Rules

### Markdown Parsing

- Use heading blocks (`#`, `##`, etc.) as primary structure
- Use explicit page markers for page anchors
- Preserve raw lines if parsed ambiguously
- Keep `label` close to textbook wording
- Use `title` for human-readable Chinese title

### Page Anchors

- Extract from `<!-- page: X -->` or `[Page X]` markers
- Derive `page_start` from nearest reliable marker
- Stop and report blocker if markers are unreliable
- Never fabricate page numbers

### ID Generation

Structure-based IDs:
```
struct:{book-id}:theme:{n}
struct:{book-id}:topic:{n-m}
struct:{book-id}:lesson:{n-m-p}
struct:{book-id}:activity:{n-m-p-q}
struct:{book-id}:review:{n-m}
```

### Stability

- Keep outline stable for downstream batching
- Stable IDs enable reproducible pipelines
- Patch conservatively if source markdown changes

## Error Handling

### Blocker Scenarios

| Scenario | Action |
|----------|--------|
| No reliable page markers | Halt, report blocker |
| Ambiguous structure | Keep raw line, log uncertainty |
| Duplicate IDs detected | Halt, report blocker |
| Circular hierarchy | Halt, report blocker |

### Warning Scenarios

| Scenario | Action |
|----------|--------|
| Missing heading levels | Log, attempt to infer |
| Empty sections | Log, skip empty items |

## References

- `references/output-contract.md` - Field-level contract
- `../../GLOSSARY.md` - Terminology
- `../../CONVENTIONS.md` - Standards
