---
name: knowledge-schema
description: canonical 节点、边、画像、提及、证据和节点卡片的 schema 权威。用于创建或校验知识产物。
user-invocable: true
---

# 知识 Schema

对所有知识产物强制 schema 合规。本 skill 提供 schema 校验、ID 生成和校验工具。

## 快速开始

Schema 校验由流水线中的 `scripts/strict_qa_sqlite.py` 执行。
不需要单独的校验脚本。本 skill 被其他 skill 隐式引用，
提供 schema 定义和 ID 生成规则。

## Schema 概览

### 核心产物

| 产物 | Schema | 用途 |
|------|--------|------|
| 节点（Node） | `schemas/v2/node.schema.json` | canonical 知识节点 |
| 边（Edge） | `schemas/v2/edge.schema.json` | 节点间关系 |
| 画像（Profile） | `schemas/v2/curriculum-profile.schema.json` | 节点的课程上下文 |
| 提及（Mention） | `schemas/v2/mention.schema.json` | 教材位置引用 |
| 证据（Evidence） | `schemas/v2/evidence.schema.json` | 来源文本摘录 |
| 节点卡片（Node Card） | `schemas/v2/node-card.schema.json` | 详细节点解释 |
| 大纲（Outline） | `schemas/outline.schema.json` | 教材结构 |
| 课标框架（Framework） | `schemas/framework.schema.json` | 课程标准映射 |
| 模式库（Patterns） | `schemas/v2/pattern-library.schema.json` | 解释模板 |

### 阅读顺序

使用任何产物前，按以下顺序阅读：

1. `references/schema-guide.md` — 语义指引
2. `references/framework-usage.md` — 课程对齐
3. `references/node-card-usage.md` — 节点卡片模式
4. 具体 schema 文件（`*.schema.json`）

## 节点 Schema

### 必填字段

| 字段 | 类型 | 取值 | 说明 |
|------|------|------|------|
| `id` | 字符串 | `^[a-z0-9/_:-]+$` | 稳定节点标识符，如 `concept:chemical-change` |
| `canonical_name` | 字符串 | 文本 | 主显示名 |
| `aliases` | 数组 | [字符串] | 别名 |
| `node_kind` | 枚举 | 见下文 | 本体类型 |
| `node_layer` | 枚举 | `backbone`、`support` | 可见层级 |
| `definition` | 字符串 | 文本 | 稳定定义 |
| `learning_modes` | 数组 | [枚举] | 必填，非空 |
| `properties` | 对象 | JSON 对象 | 紧凑结构化事实 |
| `status` | 枚举 | `candidate`、`active`、`merged`、`deprecated` | 节点生命周期 |

### 节点类型

| 类型 | 子类型 | 典型层级 | 示例 |
|------|--------|---------|------|
| `concept` | - | backbone | 化学键, 惯性 |
| `entity` | `substance`、`equipment` | backbone/support | 氧气, 烧杯 |
| `activity` | `experiment`、`investigation` | support | 过滤实验 |
| `method` | - | support | 控制变量法 |
| `principle` | `law`、`mechanism` | backbone | 牛顿第一定律 |
| `representation` | `symbol`、`formula`、`diagram` | support | H₂O, 电路图 |
| `skill` | `procedure`、`technique` | support | 读数, 计算 |
| `issue` | - | support | 空气污染议题 |

### 学习模式

所有节点必须至少有一个：

| 模式 | 典型适用 |
|------|---------|
| `conceptual` | 概念、原理、backbone 实体 |
| `procedural` | 方法、技能、活动 |
| `factual` | 支撑实体、属性 |
| `metacognitive` | 反思、自我调节 |

来源未明确时的默认值：
- `concept`、`principle` → `conceptual`
- `method`、`skill`、`activity` → `procedural`
- `entity`（support）→ `factual`

### 属性

用于稀疏、结构化、稳定的事实：

```json
{
  "properties": {
    "color": "无色",
    "state": "气态",
    "solubility": "难溶于水"
  }
}
```

避免放入：
- 教材原句
- 长篇解释
- 操作细节

这些应放入节点卡片。

## 边 Schema

### 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | 字符串 | `edge:{stable-suffix}` |
| `from` | 字符串 | 起始节点 ID |
| `to` | 字符串 | 目标节点 ID |
| `edge_type` | 枚举 | 边类型 |
| `edge_layer` | 枚举 | `backbone`、`support` |
| `backbone_expand` | 布尔 | 是否在默认展开中显示？ |
| `directionality` | 枚举 | `directed`、`undirected` |
| `confidence` | 数值 | `0.0` 到 `1.0` |
| `properties` | 对象 | JSON 对象 |
| `status` | 枚举 | `candidate`、`active`、`deprecated` |

### 边类型

**层级/依赖**（禁止环路）：
```
is_a          - 类型归属
instance_of   - 实例关系
contains      - 包含（整体→部分）
part_of       - 部分归属（部分→整体）
extends       - 扩展/继承
depends_on    - 依赖
prerequisite_for - 学习/前置顺序
```

**过程/因果**：
```
causes        - 因果关系
explains      - 解释（非层级）
affects       - 影响但非严格因果
produces      - 生成/创造
consumes      - 消耗/使用
applies_to    - 应用范围
```

**操作**：
```
uses          - 工具/方法使用
measures      - 测量关系
represented_by - 外部表示
symbolizes    - 符号表示
has_property  - 属性归属
```

**关联**：
```
analogous_to  - 类比/相似
same_as       - 等价
related_to    - 一般关联
```

### 边层级默认值

| 从 | 到 | edge_layer | backbone_expand |
|----|-----|------------|-----------------|
| backbone | backbone | `backbone` | `false` |
| backbone | support | `support` | `true` |
| support | support | `support` | `false` |

## 画像 Schema

### 核心原则

- 每个 `(node_id, subject, school_stage, grade_band)` 一个画像
- 同一节点在不同上下文中可有多个画像
- 初中和高中画像共存

### 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | URN | 画像标识符 |
| `node_id` | URN | 关联的 canonical 节点 |
| `subject` | 字符串 | 学科 |
| `school_stage` | 枚举 | `primary`、`junior_secondary`、`senior_secondary`、`higher`、`cross_stage` |
| `grade_band` | 字符串 | 如 `7-9`、`10-12` |
| `curriculum_role` | 枚举 | introduced/reinforced/developed/integrated/transferred/assessed |
| `mastery_level` | 枚举 | aware/identify/understand/apply/analyze/model/transfer/evaluate/create |
| `framework_refs` | 数组 | 必填，非空 |
| `learning_objectives` | 数组 | 必填，非空 |
| `properties` | 对象 | JSON 对象 |
| `status` | 枚举 | `draft`、`reviewed`、`validated` |

### 可选字段

| 字段 | 用途 |
|------|------|
| `textbook_refs` | 教材位置 |
| `textbook_ids` | 教材来源 ID |
| `source_refs` | 证据引用 |

## 提及 Schema

### 关键规则

> **每个 canonical 节点必须至少有一条带证据的提及。**

### 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | URN | 提及标识符 |
| `source_type` | 枚举 | textbook/curriculum/exercise/assessment/note/media/other |
| `source_id` | 字符串 | 来源产物 ID |
| `target_id` | URN | Canonical 节点 ID |
| `anchor_ref` | 字符串 | 大纲锚点 |
| `target_type` | 枚举 | node/edge/profile/card |
| `role` | 枚举 | 课题如何处理该目标 |
| `source_refs` | 数组 | 证据 ID，必填非空 |
| `confidence` | 数值 | `0.0` 到 `1.0` |
| `properties` | 对象 | JSON 对象 |

### 角色

| 角色 | 含义 |
|------|------|
| `introduces` | 首次出现 |
| `defines` | 正式定义 |
| `focuses_on` | 主要话题 |
| `demonstrates` | 示例/演示 |
| `applies` | 应用或使用目标 |
| `reviews` | 复习/练习 |
| `mentions` | 顺带提及 |
| `supports` | 为目标提供支撑 |
| `assesses` | 评估引用 |
| `extends` | 扩展之前的处理 |

## 证据 Schema

### 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | URN | 证据标识符 |
| `source_type` | 枚举 | textbook/curriculum/exercise/assessment/note/media/other |
| `source_id` | 字符串 | 教材标识符 |
| `anchor_ref` | 字符串 | 位置锚点 |
| `excerpt` | 字符串 | 文本片段 |
| `locator` | 字符串 | 页码/段落/表格/图片定位 |
| `extraction_method` | 枚举 | manual/pdftotext/ocr/speech_to_text/mixed |
| `properties` | 对象 | JSON 对象 |

### 锚点

- 教材级：`{book-id}`
- 课题级：`struct:{book-id}:lesson:{x-y-z}`
- 页码级：`{book-id}:page:{number}`
- 段落级：`{book-id}:page:{number}:para:{number}`

### 提取方法

- `ocr` — OCR 完成的 markdown
- `manual` — 手动录入
- `pdftotext` — PDF 文本工具提取
- `speech_to_text` — 音视频转写
- `mixed` — 多种方法混合

## 节点卡片 Schema

### 结构

每个节点卡片包含详细解释：

```json
{
  "id": "node-card:{node-id}",
  "node_id": "concept:chemical-change",
  "card_layer": "backbone|support",
  "title": "化学变化",
  "summary": "简短的有证据支撑的摘要。",
  "sections": [
    {
      "id": "definition",
      "title": "定义",
      "section_type": "definition",
      "content": ["有证据支撑的定义。"],
      "source_refs": ["evidence:auto-example"]
    }
  ],
  "properties": {},
  "status": "draft"
}
```

### 卡片章节

常见章节：
- `conceptual-overview` — 核心解释
- `key-properties` — 重要特征
- `common-misconceptions` — 典型误区
- `examples` — 说明性案例
- `applications` — 实际应用
- `related-concepts` — 相关知识
- `procedural-notes` — 操作指引

章节保持**紧凑、结构化、有证据支撑**。

## ID 生成

### 节点 ID

```
{node_kind}[/node_subkind]:{stable-token}
```

- 只使用 ASCII ID
- 允许遗留 ID 如 `concept:chemical-change`
- 新自动 ID 通常使用 `concept:auto-{hash}` 或 `entity/substance:auto-{hash}`

示例：
- `concept:chemical-change`
- `entity/substance:oxygen`
- `activity/experiment:auto-abc123`

### 边 ID

```
edge:auto-{stable-hash}
```

示例：
- `edge:auto-abc123def456`

### 安全节点 ID（用于文件名）

```python
safe_id = node_id.replace(":", "__").replace("/", "__")
# 如 "entity/substance:oxygen"
#    → "entity__substance__oxygen"
```

## 验证

### 写入前检查

写入任何产物前：

1. **Schema 验证**：所有必填字段存在
2. **类型验证**：值匹配 schema 类型
3. **枚举验证**：值在允许集合内
4. **引用验证**：所有 ID 引用已有记录
5. **来源验证**：证据链完整

### 验证工具

```bash
# QA 验证（schema + 完整性 + 一致性）
python scripts/strict_qa_sqlite.py --dataset-id main

# 图完整性检查（环路、孤立节点、连通性）
python scripts/check_graph_integrity.py --dataset-id main
```

## 参考

- `references/schema-guide.md` — schema 字段语义指引
- `references/framework-usage.md` — 课程框架对齐
- `references/node-card-usage.md` — 节点卡片模式和模板
- `../../GLOSSARY.md` — 术语定义
- `../../CONVENTIONS.md` — 文档标准
