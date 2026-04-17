---
name: chapter-extract
description: 从单个课题或小页码范围提取课题级 staging 产物。用于教材内容知识抽取。
user-invocable: true
---

# 课题抽取

## ⚠️ 关键约束：只处理一个课题

只处理**一个课题**，处理完即停。

本 skill 只返回**课题内的结构化产物**，不直接写入 canonical 图表。抽取标准与之前的 canonical 流程同样严格，只是写入目标从 canonical 表改为了 staging 表。

## 工作流程

### 阶段一：预处理

处理前确认：

1. 读取 `../../AGENTS.md` 了解项目原则
2. 读取 `../../GLOSSARY.md` 了解术语
3. 确定 `--output-root`
4. 验证 `--batch-anchor` 是有效的 outline ID
5. 确认 PostgreSQL 可访问
6. 读取必要 schema：
   - `schemas/v2/node.schema.json`
   - `schemas/v2/edge.schema.json`
   - `schemas/v2/curriculum-profile.schema.json`
   - `schemas/v2/mention.schema.json`
   - `schemas/v2/evidence.schema.json`
   - `schemas/v2/node-card.schema.json`

### 阶段二：加载与分块

1. 从 `data/outlines/{book-id}.outline.json` 定位课题范围
2. 读取目标课题的 OCR markdown
3. 拆分为**证据单元**：
   - 定义段落
   - 示例段落
   - 实验步骤块
   - 图表说明
   - 表格行组
4. 先创建课题内的 evidence 记录

### 阶段三：检索优先

对每个证据单元：

1. 提取候选概念、实体和关系
2. 用 `scripts/retrieve_candidates.py` 检索已有的 canonical 候选
3. 应用硬过滤：`node_kind`、`subject`、`school_stage`、`grade_band`
4. 必要时在局部子图上推理
5. 已有 canonical 候选仅作为检索参考，不直接复用
6. 产出**课题内的原始节点和边**
7. 不在这里做 canonical 合并决策

### 阶段四：为每个节点构建完整产物

#### 步骤 4.1：节点筛选 — 三层规则

**第一层：准入门槛 — backbone 节点必须同时满足四条**

1. 可独立定义（有清晰、有边界的定义）
2. 可通过稳定关系连接其他节点
3. 可能在跨课、跨教材、跨学段中复现
4. 可作为**学习目标或考核焦点**

任一条不满足，就不应成为 backbone 节点。

**反面示例 — 以下内容不应创建 backbone 节点：**

- 学科/科目名："化学""物理""数学" — 粒度过粗，无法考核
- 章节/单元标题："化学的魅力""空气与氧" — 只是结构容器，不是知识点
- 元分类标签："微观结构""定量关系" — 应放入 `bridge_tags`，不单独建节点
- 模糊描述："实验探究""科学方法" — 太泛，无法给出明确定义或考核
- 课题名称："课题1 开启化学之门" — 仅作来源标记，不是知识点

**第二层：卡片级内容 — 不做 backbone，归入属性或卡片**

- 局部属性 → 放入 `properties`
- 关键判断点、易错点 → 放入 node cards
- 操作子步骤 → 放入 node cards 或 `method` 支撑节点
- 解释性示例 → 放入 evidence

**第三层：证据级内容 — 只记录出处**

- 教材原句、图片描述、习题提示 → 只建 evidence 记录

---

经过三层筛选后，确定：

1. **Backbone 节点** — 通过第一层四条准入门槛的项目
   - 核心概念和原理（如：化学变化, 质量守恒定律）
   - 关键物质和实体（如：氧气, 二氧化碳）
   - 稳定的跨课知识锚点

2. **支撑节点** — 视课题内容而定
   - `activity/experiment`
   - `method`
   - `entity/equipment`
   - `representation`

如果没有支撑节点：
- 确认该课题确实是纯概念/理论型
- 不要凭空捏造支撑节点

#### 步骤 4.2：谨慎提取属性

**物质节点：有证据支持时应填写属性**

```json
{
  "node_kind": "entity",
  "node_subkind": "substance",
  "properties": {
    "color": "无色",
    "odor": "无味",
    "state": "气体"
  }
}
```

**实验节点：有证据支持时应填写属性**

```json
{
  "node_kind": "activity",
  "node_subkind": "experiment",
  "properties": {
    "method": "观察法",
    "steps": ["点燃镁条", "观察现象"],
    "materials": ["镁条", "酒精灯"]
  }
}
```

**器材节点：有证据支持时应填写结构化属性**

```json
{
  "node_kind": "entity",
  "node_subkind": "equipment",
  "properties": {
    "instrument_type": "玻璃仪器",
    "usage": "用于过滤操作"
  }
}
```

如果证据不支持这些字段：
- `properties` 留空即可
- 仅在需要时添加 `notes`
- 不要编造细节

#### 步骤 4.3：确保五类完整性

每个新 backbone 节点必须有全部五类支撑：

1. 节点本身（Node）
2. 课程画像（Profile）
3. 证据（Evidence）
4. 提及（Mention）
5. 节点卡片 — 通过 `new_backbone_nodes` 列表返回，由调用方生成

本 skill 直接返回前四类，通过 `new_backbone_nodes` 告知调用方需要生成哪些节点卡片。

#### 步骤 4.4：节点格式要求

课题内的节点候选格式与 canonical 节点一致，但 status 保持 candidate/staged：

```json
{
  "id": "entity/substance:oxygen",
  "canonical_name": "氧气",
  "node_kind": "entity",
  "node_subkind": "substance",
  "node_layer": "backbone",
  "aliases": ["O₂", "氧", "oxygen"],
  "definition": "由氧元素组成的单质，是空气的主要成分之一",
  "learning_modes": ["factual", "conceptual"],
  "bridge_tags": ["matter", "structure", "properties"],
  "framework_refs": ["framework:chem:topic:2-1"],
  "properties": {
    "state": "气体",
    "color": "无色"
  },
  "status": "candidate"
}
```

#### 步骤 4.5：画像格式要求

每个 backbone 节点应有对应的课程画像：

```json
{
  "id": "profile:chem:entity/substance:oxygen",
  "node_id": "entity/substance:oxygen",
  "subject": "chemistry",
  "school_stage": "senior_secondary",
  "grade_band": "10-12",
  "curriculum_role": "introduced",
  "mastery_level": "understand",
  "framework_refs": ["framework:chem:expectation:2-1-3"],
  "learning_objectives": ["描述氧气的物理性质", "掌握氧气的化学性质"],
  "textbook_refs": ["struct:chem:lesson:2-1"],
  "properties": {},
  "status": "draft"
}
```

#### 步骤 4.6：证据格式要求

每条提及必须有课题内的证据支撑：

```json
{
  "id": "evidence:chem:p42-para-3",
  "source_type": "textbook",
  "source_id": "chem-highschool-compulsory-1",
  "anchor_ref": "struct:chem:lesson:2-1",
  "excerpt": "氧气是一种无色无味的气体，密度略大于空气...",
  "locator": "第42页第三段",
  "page_start": 42,
  "page_end": 42,
  "modality": "text",
  "extraction_method": "ocr",
  "properties": {}
}
```

#### 步骤 4.7：提及格式要求

每个 backbone 节点必须至少有一条课题内的提及：

```json
{
  "id": "mention:chem:oxygen-in-lesson-2-1",
  "source_type": "textbook",
  "source_id": "chem-highschool-compulsory-1",
  "anchor_ref": "struct:chem:lesson:2-1",
  "target_type": "node",
  "target_id": "entity/substance:oxygen",
  "role": "focuses_on",
  "source_refs": ["evidence:chem:p42-para-3"],
  "confidence": 0.95,
  "properties": {}
}
```

### 阶段五：返回结构化课题包

返回：

```json
{
  "nodes": [...],
  "edges": [...],
  "profiles": [...],
  "mentions": [...],
  "evidence": [...],
  "new_backbone_nodes": ["concept:...", "entity/..."],
  "counts": {
    "nodes": 5,
    "edges": 3,
    "profiles": 5,
    "mentions": 12,
    "evidence": 15
  }
}
```

调用方负责：
1. 为每个 backbone 节点生成临时节点卡片
2. 调用 `scripts/store_lesson_staging.py` 写入 staging 表
3. 验证 staging 完整性

### 阶段六：验证产物包

返回前验证：

1. 每个 backbone 节点都有：节点候选、画像、提及、证据支撑
2. 边的端点都指向课题内的节点 ID
3. 所有 `source_refs` 都指向课题内的 evidence ID
4. 没有缺失必要的 schema 字段

## 约束

- 不写入 canonical 的 `nodes`、`edges`、`profiles`、`mentions`、`evidence`、`node_cards`
- 不继续处理下一个课题
- 不直接操作整个图

## 关键规则

### 范围
- 只处理一个课题
- 处理完指定的 `batch-anchor` 即停

### 存储
- canonical PostgreSQL 表不是本 skill 的输出目标
- 本 skill 输出的是课题内产物包

### 证据优先
- 先拆分证据单元，再做节点决策
- 每个节点和边必须有证据支撑

### 检索优先
- 推理前先检索已有候选
- 检索仅用于收窄范围，不作为证据

### 支撑节点
- 课题内容需要时才抽取支撑节点
- 纯概念/理论型课题确实没有支撑节点时不要捏造

### 属性
- 证据支持时填写有意义的结构化属性
- 否则留空，不要编造

### 节点层级
- `backbone`：稳定的跨课知识锚点
- `support`：辅助内容

### 节点粒度（准入四条门槛）
- 每个 backbone 节点必须同时满足：可独立定义、有稳定关系、跨课复现、可考核
- 学科名、章节标题、元分类、模糊描述 → 不建节点（元分类用 `bridge_tags`）
- 拿不准时，选更窄、可考核的概念，而不是宽泛的大词
