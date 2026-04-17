# 知识图谱项目术语表

本文件定义项目中使用的标准化术语。所有文档、代码和注释应使用这些术语的精确定义。

## 核心概念

### A

**Agent** - 编排组件，负责流程协调和任务分发，不直接实现业务能力。

**Anchor** - 锚点，用于在教材中定位内容的引用标识，格式：`struct:{book-id}:{type}:{path}`。

### B

**Backbone** - 主干层，包含稳定、跨教材的核心知识节点和关系。

**Batch** - 批次，指一次处理单元，通常对应一个课程或一个小范围页面。

**Blocker** - 阻塞项，阻止流程继续进行的错误或问题，必须解决后才能继续。

**Book-id** - 教材标识符，如 `chem-grade8-all-in-one`。

### C

**Canonical** - 规范的，指经过审核、去重、标准化的正式记录。

**Curriculum Profile** - 课程档案，描述节点在特定学段、年级的教学上下文。

### E

**Edge** - 边/关系，连接两个节点的有向关系。

**Evidence** - 证据，指向教材具体位置的文本片段，证明知识点的来源。

### M

**Manifest** - 清单，记录管道执行状态和进度的文件，如 `{book-id}.pipeline.json`。

**Mention** - 提及，记录节点在特定教材位置出现的引用关系。

### N

**Node** - 节点，知识图谱中的基本单元，代表概念、实体、活动等。

**Node Card** - 节点卡片，包含节点的详细解释、示例、注意事项等扩展信息。

**Node Kind** - 节点类型，如 `concept`, `entity`, `activity`, `principle`。见 schema。

**Node Layer** - 节点层级，`backbone`（主干）或 `support`（支撑）。

### O

**Outline** - 大纲，教材的结构骨架，包含章节、课程、活动的层次关系。

**Output Root** - 输出根目录，如 `data/main/`，所有产物在此目录下组织。

### P

**Provenance** - 来源/溯源，指知识点的证据链，从节点追溯到原始教材位置。

### R

**Retrieval-first** - 检索优先，先检索候选集再在局部推理，不直接操作全图。

**Runtime** - 运行时，指批次处理过程中的临时状态和记录。

### S

**School Stage** - 学段，如 `primary`, `junior_secondary`, `senior_secondary`。

**Schema** - 模式，定义数据结构的标准，位于 `schemas/v2/`。

**Skill** - 技能/能力组件，实现具体业务逻辑，可被 Agent 调用。

**PostgreSQL-First** - PostgreSQL 优先规则，PostgreSQL 是主要存储层（via `DATABASE_URL`），JSON 是派生快照。

**Support** - 支撑层，包含辅助性的实验、方法、设备等节点。

## 类型枚举

### Node Kind（节点类型）

| 值 | 含义 | 示例 |
|---|---|---|
| `concept` | 概念 | 化学键、惯性 |
| `entity` | 实体 | 氧气、烧杯 |
| `activity` | 活动 | 过滤实验、探究活动 |
| `method` | 方法 | 控制变量法、观察法 |
| `principle` | 原理/定律 | 牛顿第一定律 |
| `representation` | 表示/表征 | 化学方程式、电路图 |
| `skill` | 技能 | 读数、计算 |
| `issue` | 议题 | 环保问题、科学伦理 |

### Edge Type（关系类型）

分层/依赖关系（禁止循环）：
- `is_a`, `instance_of`, `contains`, `part_of`
- `prerequisite_for`, `depends_on`, `extends`

关联关系（允许循环）：  
- `explains`, `causes`, `affects`, `related_to`
- `uses`, `measures`, `produces`, `consumes`
- `has_property`, `applies_to`, `represented_by`
- `symbolizes`, `analogous_to`, `same_as`

### Node/Edge Layer（层级）

- `backbone` - 主干，默认显示的核心知识
- `support` - 支撑，默认折叠的辅助内容

## 命名约定

### 文件命名

- Agent: `{name}.md` 小写，连字符分隔
- Skill: `{name}/SKILL.md` 目录使用小写下划线
- Schema: `{artifact}.schema.json`

### ID 格式

- 节点: `{node_kind}[/node_subkind]:{stable-token}`，如 `concept:chemical-change`
- 边: `edge:auto-{stable-hash}`
- 批次锚点: `struct:{book-id}:lesson:{x-y-z}`

### 变量命名（代码中）

- `book_id` - 教材标识
- `batch_anchor` - 批次锚点
- `node_kind` - 节点类型
- `edge_type` - 关系类型
