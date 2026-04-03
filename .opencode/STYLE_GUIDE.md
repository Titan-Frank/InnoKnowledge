# 文档风格指南

本文档提供具体的写作风格指导，确保所有技术文档风格一致、易于维护。

## 1. 标题层级

### 1.1 层级深度限制

最大深度：**3级**（`###`）

如果内容需要更深层级，拆分文件或使用列表。

```markdown
✅ 好：
## Workflow

### Pre-flight
- Check SQLite
- Validate schema

### Main Processing
1. Step one
2. Step two

❌ 避免：
#### Sub-sub-section (太深)
##### Too deep (不要这样)
```

### 1.2 标题格式

- **一级标题**：`# Title` - 文件主标题，仅一个
- **二级标题**：`## Section` - 大章节，首字母大写
- **三级标题**：`### Subsection` - 小节，首字母大写

标题不使用结尾标点（问号除外）。

```markdown
✅ 好：
## Workflow
## How Does It Work?

❌ 避免：
## Workflow.
## how does it work
```

## 2. 列表格式

### 2.1 无序列表

使用 `-`（连字符），缩进 2 个空格：

```markdown
- Item 1
- Item 2
  - Nested 1
  - Nested 2
- Item 3
```

### 2.2 有序列表

用于步骤说明，数字后加句点：

```markdown
1. First step
2. Second step
3. Third step
```

如果步骤有子说明：

```markdown
1. Run the script
   - Use `--mode hybrid`
   - Check output
2. Verify results
```

### 2.3 描述列表

用于术语定义：

```markdown
**Term**
: Definition goes here.
: Can have multiple paragraphs.

**Another Term**
: Its definition.
```

## 3. 代码格式

### 3.1 代码块

始终标明语言：

```markdown
    ```bash
    scripts/run.sh --help
    ```

    ```json
    {"key": "value"}
    ```

    ```python
    def example():
        pass
    ```
```

### 3.2 行内代码

用于文件路径、命令、变量名：

```markdown
Run `scripts/extract.py` with `--output-root` flag.
Set the `batch_anchor` variable.
```

### 3.3 占位符

使用尖括号表示需要替换的内容：

```markdown
scripts/extract.py --batch-anchor <struct:book:lesson:x-y-z>
```

## 4. 表格格式

### 4.1 标准表格

```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| More     | Info     | Here     |
```

### 4.2 对齐方式

数字右对齐，文本左对齐：

```markdown
| Name    | Count | Percentage |
|:--------|------:|-----------:|
| Nodes   |   150 |       75%  |
| Edges   |   200 |       25%  |
```

### 4.3 复杂表格

内容过宽时使用列表：

```markdown
| Field | Description | Rules |
|-------|-------------|-------|
| `name` | Canonical name | - Must be unique<br>- Use Chinese if source is Chinese |
| `kind` | Node type | - From schema enum<br>- Never invent new types |
```

## 5. 强调和警示

### 5.1 强调

- **粗体**：用于重要术语或关键概念
- *斜体*：用于文件名称或引入术语
- `代码`：用于代码、路径、命令

### 5.2 警示框

使用引用块表示提示或警告：

```markdown
> 💡 **Tip**: Use `--mode hybrid` for best results.

> ⚠️ **Warning**: Never delete canonical nodes without evidence.

> 🚫 **Blocker**: If QA fails, halt immediately.
```

### 5.3 分隔

章节间使用空行分隔。长文档可在二级标题前加：

```markdown
---
```

## 6. 交叉引用

### 6.1 链接格式

| 类型 | 格式 | 示例 |
|------|------|------|
| 同一文件内 | `[Section Name](#section-name)` | `[Workflow](#workflow)` |
| 其他文档 | `[Display](../path/file.md)` | `[SKILL](../skill/SKILL.md)` |
| 外部链接 | `[Text](URL)` | `[Schema](http://...)` |

### 6.2 引用约定

引用标准文档时使用特定格式：

```markdown
See [AGENTS.md](../../AGENTS.md) for workflow rules.

Refer to [Node Schema](../../schemas/v2/node.schema.json).

Details in [Extraction Rules](../references/extraction-rules.md).
```

## 7. 示例规范

### 7.1 最小示例

示例应是最小可运行的：

```markdown
✅ 好：
```bash
scripts/retrieve_candidates.py \
  --output-root data/v4/ \
  --mode hybrid
```

❌ 避免：
```bash
# 不完整，缺乏必要参数
scripts/retrieve_candidates.py
```
```

### 7.2 多示例组织

相关示例放在一起：

```markdown
**Basic usage:**
```bash
script.py --input input.txt
```

**With all options:**
```bash
script.py \
  --input input.txt \
  --output output.json \
  --verbose
```
```

## 8. 检查清单模板

文档评审使用此模板：

```markdown
## 文档评审检查清单

- [ ] 标题层级不超过3级
- [ ] 所有代码块标明语言
- [ ] 术语符合 GLOSSARY.md
- [ ] 示例可运行
- [ ] 链接有效
- [ ] 无拼写错误
- [ ] 风格一致
```

## 9. 快速参考卡

### 9.1 文档模板

**Skill 模板：**
```markdown
---
name: skill-name
description: One-line description
---

# Skill Name

Brief introduction (2-3 sentences).

## Workflow

1. Step one
2. Step two
3. Step three

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ...   | ...  | ...      | ...         |

## Output

Describe output format and location.

## Rules

- Rule one
- Rule two

## References

- [Detail](../references/detail.md)
- [Schema](../../schemas/v2/xxx.schema.json)
```

**Agent 模板：**
```markdown
---
description: Brief description
mode: subagent
---

You orchestrate X.

## Workflow

1. Pre-flight checks
2. Delegate to skill
3. Handle results

## Handoff

- Return: what to return
- Errors: how to handle
```

## 10. 常见错误

| 错误 | 正确 |
|------|------|
| `##Workflow` | `## Workflow` |
| `-item` | `- item` |
| `\`\`\` (no lang)` | `\`\`\`bash` |
| `[link]` | `[text](link)` |
| `Dont` | `Don't` |
| `path/to/file` | `path/to/file` |
| `...` | `...`（同前）|
