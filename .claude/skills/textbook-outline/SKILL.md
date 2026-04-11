---
name: textbook-outline
description: 从 OCR 完成的教材 markdown 中提取结构大纲。用于处理新教材时生成结构骨架。
user-invocable: true
---

# 教材大纲

在抽取课题知识之前先创建教材骨架。解析 markdown 标题、页码标记和结构标签，生成 outline JSON。

## 快速开始

```bash
# 由 @outline-reader 调用
# 需要：
#   --book-md-path（OCR 完成的 markdown）
#   --book-id（如 chem-grade8-all-in-one）
```

## 工作流程

### 阶段一：预处理

1. 读取 `../../AGENTS.md`
2. 读取 `../../GLOSSARY.md`
3. 读取 `schemas/outline.schema.json`
4. 验证 markdown 源文件存在且已完成 OCR

### 阶段二：解析 markdown 结构

1. **提取标题**
   ```bash
   rg -n "^(#{1,6})\s+|^第[一二三四五六七八九十0-9]+[章单元课节专题主题]" "<book.md>"
   ```

2. **提取页码标记**
   ```bash
   rg -n "^\[?Page[[:space:]]+[0-9]+\]?|^<!--\s*page:" "<book.md>"
   ```

3. **识别结构类型**
   - `theme` — 主题/大单元
   - `topic` — 专题
   - `lesson` — 课题/课程
   - `activity` — 活动/实验
   - `review` — 复习

### 阶段三：构建大纲

1. **映射层级**
   - H1 → Theme
   - H2 → Topic
   - H3 → Lesson
   - H4 → Activity/Subsection

2. **分配页码锚点**
   - 找到每个项目之前最近的页码标记
   - 从可靠标记推导 `page_start`
   - 如果没有可靠标记，报告阻塞

3. **生成 ID**
   - 格式：`struct:{book-id}:{type}:{path}`
   - 路径：课题用 `lesson:X-Y-Z`，活动用 `activity:X-Y-Z-A`

### 阶段四：生成标记 markdown

**这是实现准确课题抽取的关键改进。**

1. **读取原始 markdown**
   ```bash
   读取完整 markdown 文件
   ```

2. **使用 LLM 识别课题边界**
   
   对 outline 中的每个课题：
   - 在 markdown 中找到精确的起始位置
   - 找到精确的结束位置（下一课题的开始或文件末尾）
   - 使用语义理解（不仅是标题匹配）
   
   可用信号：
   - 标题/标题文本
   - 页码标记（如有）
   - 内容结构（学习目标、示例、练习）
   - 章节之间的自然分隔

3. **插入边界标记**
   
   生成带有 HTML 样式标记的新文件：
   
   ```markdown
   <!-- LESSON_START id="struct:book:lesson:1-1-1" title="课题1：开启化学之门" pages="3-14" -->
   
   ... 该课题的原始 markdown 内容 ...
   
   <!-- LESSON_END id="struct:book:lesson:1-1-1" -->
   ```

4. **写入标记 markdown**
   ```
   data/outlines/{book-id}.marked.md
   ```

5. **验证覆盖率**
   - 检查所有课题都有标记
   - 验证没有重叠范围
   - 确保对源文件的完整覆盖

### 阶段五：验证与写入

1. **验证层级**
   - 确保逻辑上的父子关系
   - 没有孤立课题
   - 没有重复 ID

2. **写入输出**
   ```
   data/outlines/{book-id}.outline.json
   data/outlines/{book-id}.marked.md
   ```

3. **更新清单**（如存在）
   ```
   {output-root}/runs/{book-id}.pipeline.json
   ```

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `--book-md-path` | 路径 | 是 | OCR 完成的 markdown 文件 |
| `--book-id` | 字符串 | 是 | 教材标识符（`{学科}{学段}{...}`） |

## 输出

**文件**：
1. `data/outlines/{book-id}.outline.json` — 大纲结构
2. `data/outlines/{book-id}.marked.md` — 带课题边界标记的 markdown

**结构**：

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

## 结构类型

| 类型 | 是否抽取 | 说明 |
|------|---------|------|
| `theme` | 否 | 仅作容器，不创建节点/画像 |
| `topic` | 是 | 独立引言 |
| `lesson` | 是 | 核心内容，总是抽取 |
| `activity` | 是 | 实验作为 activity 节点 |
| `review` | 否 | 仅作来源锚点 |

## 关键规则

### markdown 解析

- 使用标题块（`#`、`##` 等）作为主要结构
- 使用显式页码标记作为页码锚点
- 解析有歧义时保留原始行
- `label` 尽量贴近教材用词
- `title` 使用人类可读的中文名称

### 页码锚点

- 从 `<!-- page: X -->` 或 `[Page X]` 标记中提取
- 从最近的可靠标记推导 `page_start`
- 标记不可靠时停止并报告阻塞
- 不要编造页码

### ID 生成

基于结构的 ID：
```
struct:{book-id}:theme:{n}
struct:{book-id}:topic:{n-m}
struct:{book-id}:lesson:{n-m-p}
struct:{book-id}:activity:{n-m-p-q}
struct:{book-id}:review:{n-m}
```

### 稳定性

- 保持大纲稳定，供下游批处理使用
- 稳定 ID 确保流水线可复现
- 源 markdown 变更时保守修补

## 错误处理

### 阻塞场景

| 场景 | 操作 |
|------|------|
| 没有可靠的页码标记 | 停止，报告阻塞 |
| 结构有歧义 | 保留原始行，记录不确定 |
| 检测到重复 ID | 停止，报告阻塞 |
| 循环层级 | 停止，报告阻塞 |

### 警告场景

| 场景 | 操作 |
|------|------|
| 缺少标题层级 | 记录，尝试推断 |
| 空章节 | 记录，跳过空项 |

## 参考

- `references/output-contract.md` — 字段级契约
- `../../GLOSSARY.md` — 术语
- `../../CONVENTIONS.md` — 标准
