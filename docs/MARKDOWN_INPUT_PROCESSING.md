# Markdown Input Processing Requirements

## Problem Statement

Current extraction logic does NOT handle real textbook markdown format:

1. **extract_lesson_sqlite.py** is a placeholder (TODO: Add LLM extraction logic)
2. **marked.md** only has content descriptions, not actual content
3. **Real markdown** has complex structures (images, LaTeX, tables, fill-in blanks)

## Real Markdown Examples

### Example 1: Experiment Section
```markdown
# 实验探究

# 物质的变化

（1）如图1.1所示，将盛有少量水的试管固定在铁架台上，在试管底部小心加热至水沸腾（注意不要将试管中的水蒸干），取一片干燥、洁净的玻璃片靠近试管口。观察并记录实验现象。

![](images/cc32d53049f7e1aaedf71b5d280127b2616d58f6e96f132acf48a2653ea756bb.jpg)

![](images/59ea9ded961df5fff4767171b6f8373f691d48939629d6ac427f786da9591e45.jpg)  
$\triangle$ 图1.1 水的沸腾

(2) 向盛有约 $\frac{1}{3}$ 容积的水的烧杯中投入一小片维生素 C 泡腾片, 取一片干燥、洁净的玻璃片靠近烧杯口。观察并记录实验现象。

现象记录：
将水加热至沸腾时，试管中__________，玻璃片上__________。
向水中加入维生素C泡腾片后，烧杯中__________，玻璃片上__________。
```

### Example 2: Definition Section
```markdown
这种生成与原来不同的物质的变化叫做化学变化，也称为化学反应。化学反应前的原物质叫反应物，化学反应后产生的新物质叫生成物或产物。利用化学反应可以实现物质的转化。
```

### Example 3: Properties Section
```markdown
# 2. 化学性质与物理性质

每种物质都有其独特的性质。物质的有些性质不需要发生化学变化就能表现出来，如颜色、气味、熔点、沸点、密度、硬度、导电性、导热性等，这类性质叫做物理性质。物质在发生化学变化时表现出来的性质叫做化学性质。例如，维生素C泡腾片在水中能释放出气体，这就是泡腾片中所含物质体现的某些化学性质。可燃性、酸碱性等都是化学性质。
```

## Required Processing

### 1. Markdown Structure Extraction

**Must identify**:
- `#` headings → Section boundaries
- `# 实验探究` → Experiment section
- `# 学习聚焦` → Learning objectives
- `# 现象记录` → Observation records

**Must handle**:
- Images: `![](images/xxx.jpg)` → Extract to evidence with image reference
- LaTeX: `$\frac{1}{3}$` → Keep as-is or convert to readable text
- Fill-in blanks: `__________` → Identify as exercise/prompt

### 2. Content Chunking

**Required chunks**:
```json
{
  "definition_paragraphs": [
    "化学就是研究物质的组成、结构、性质、变化..."
  ],
  "experiment_steps": [
    {
      "step_number": 1,
      "description": "将盛有少量水的试管固定在铁架台上...",
      "images": ["images/xxx.jpg"],
      "notes": "注意不要将试管中的水蒸干"
    }
  ],
  "phenomena_records": [
    "将水加热至沸腾时，试管中__________"
  ],
  "examples": [
    "维生素C泡腾片在水中能释放出气体"
  ]
}
```

### 3. Evidence Creation from Markdown

**From markdown**:
```markdown
这种生成与原来不同的物质的变化叫做化学变化，也称为化学反应。
```

**Create evidence**:
```json
{
  "id": "evidence:chem:lesson-1-1-1:para-5",
  "excerpt": "这种生成与原来不同的物质的变化叫做化学变化，也称为化学反应。",
  "locator": "课题1 第5段",
  "modality": "text"
}
```

**From markdown with image**:
```markdown
![](images/xxx.jpg)
$\triangle$ 图1.1 水的沸腾
```

**Create evidence**:
```json
{
  "id": "evidence:chem:lesson-1-1-1:fig-1-1",
  "excerpt": "图1.1 水的沸腾",
  "locator": "课题1 图1.1",
  "modality": "image",
  "image_ref": "images/xxx.jpg"
}
```

### 4. Experiment Activity Nodes

**Must create from markdown**:
```markdown
# 实验探究
# 物质的变化
（1）如图1.1所示...
(2) 向盛有约...
```

**Generate**:
```json
{
  "id": "activity/experiment:water-boiling",
  "canonical_name": "水的沸腾实验",
  "node_kind": "activity",
  "node_subkind": "experiment",
  "node_layer": "support",
  "properties": {
    "steps": [
      "将盛有少量水的试管固定在铁架台上",
      "在试管底部小心加热至水沸腾",
      "取干燥玻璃片靠近试管口"
    ],
    "materials": ["水", "试管", "铁架台", "玻璃片", "酒精灯"],
    "safety_notes": "注意不要将试管中的水蒸干"
  }
}
```

### 5. Properties Extraction

**From markdown**:
```markdown
如颜色、气味、熔点、沸点、密度、硬度、导电性、导热性等，这类性质叫做物理性质。
```

**Should extract properties**:
```json
{
  "id": "concept:physical-property",
  "canonical_name": "物理性质",
  "properties": {
    "examples": ["颜色", "气味", "熔点", "沸点", "密度", "硬度", "导电性", "导热性"]
  }
}
```

## Implementation Steps

### Step 1: Markdown Parser Module

Create `scripts/markdown_parser.py`:

```python
def parse_markdown_lesson(md_content: str) -> dict:
    """Parse markdown into structured chunks."""
    return {
        "sections": [...],
        "experiments": [...],
        "definitions": [...],
        "examples": [...],
        "images": [...],
        "tables": [...],
    }
```

### Step 2: Update extract_lesson_sqlite.py

Replace TODO with:

```python
# Parse markdown
from markdown_parser import parse_markdown_lesson

lesson_structure = parse_markdown_lesson(lesson_text)

# Extract nodes from structure
for section in lesson_structure["sections"]:
    if section["type"] == "experiment":
        create_experiment_node(section)
    elif section["type"] == "definition":
        create_concept_node(section)
    ...
```

### Step 3: Generate Marked Markdown with Content

Instead of placeholder marked.md:

```markdown
<!-- LESSON_START id="..." title="开启化学之门" pages="3-13" -->

# 课题1 开启化学之门

# 学习聚焦
√ 知道化学科学的研究对象...

# 实验探究
(1) 如图1.1所示...
(2) 向盛有约...

<!-- LESSON_END id="..." -->
```

## Validation Checklist

- [ ] Markdown parser extracts sections correctly
- [ ] Images are linked to evidence
- [ ] LaTeX formulas are preserved
- [ ] Experiment steps are identified
- [ ] Properties are extracted from text
- [ ] Fill-in blanks are marked as exercises
- [ ] Tables are parsed into structured data
- [ ] Definition paragraphs are identified
