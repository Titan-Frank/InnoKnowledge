# 课题抽取规则

## 范围

- 每次只抽取一个课题、一个活动块、或一小段页码范围
- 不要一次性全书抽取
- 教材结构是来源标记，不是知识图谱本身
- 课题内部优先拆成小块分别抽取，而非对整课全文一次性推理

## Outline 类型选择

不是所有 outline 条目都应该变成 canonical 节点：

| Outline 类型 | 是否抽取 | 说明 |
|-------------|---------|------|
| `lesson` | ✅ 是 | 核心内容，总是抽取 |
| `activity` | ✅ 是 | 实验和活动，抽取为 `activity/experiment` 节点 |
| `topic` | ✅ 是 | 独立专题，如引言/前言 |
| `theme` | ❌ 否 | 只是章节/单元标题，作为课题的父容器 |
| `review` | ❌ 否 | 章节复习，不创建节点或画像 |

- `theme` 和 `review` 仅在 outline 中作为来源标记
- 不要为 `theme` 或 `review` 创建 canonical 节点、画像、提及或节点卡片
- backbone 抽取时跳过 `theme` 和 `review`

## 证据优先

- 在决定节点之前，先把当前课题拆成小的证据单元
- 好的拆分单元：
  - 定义段落
  - 示例段落
  - 实验步骤块
  - 图表说明
  - 表格行组
- 先创建 evidence 记录，再创建节点和边
- `excerpt` 保持简洁，只摘录与声明直接相关的原文
- 图表说明和表格仅在补充正文未包含的信息时使用
- 把当前课题或活动的 ID 写入 `anchor_ref`

## 三层筛选规则

### 第一层：准入门槛（Backbone 节点）

只有同时满足以下全部条件，才创建 canonical 节点：

1. 可独立定义
2. 可通过稳定关系连接其他节点
3. 可能在跨课、跨教材、跨学段中复现
4. 可作为学习目标或考核焦点

**反面示例 — 以下内容不应创建 backbone 节点：**

- 学科/科目名："化学""物理""数学" — 粒度过粗，无法考核
- 章节/单元标题："化学的魅力""空气与氧" — 只是结构容器，不是知识点
- 元分类标签："微观结构""定量关系" — 应放入 `bridge_tags`，不单独建节点
- 模糊描述："实验探究""科学方法" — 太泛，无法给出明确定义或考核
- 课题名称："课题1 开启化学之门" — 仅作来源标记，不是知识点

### 第二层：卡片级内容

以下内容不做 backbone，默认归入属性或卡片：

- 局部属性
- 关键判断点
- 操作子步骤
- 易错点
- 解释性示例

这些后续放入 node cards。

### 第二层补充：`properties` 与 Node Card 的边界

`properties` 只放简短的结构化事实。

适合放入 `properties`：

1. 足够短，一个字段一个值就能看懂
2. 对该 canonical 节点是稳定的
3. 有助于快速浏览、筛选或检索
4. 不需要长篇解释

适合放入 node cards：

1. 需要展开解释的
2. 以示例说明的
3. 需要提醒/警示的
4. 需要对比分析的
5. 操作性内容且需要关键上下文的

默认规则：

- 拿不准时，`properties` 留空，细节推迟到 node card
- 不要为了凑字段而编造属性

### 第三层：证据级内容

以下内容只记录出处，不建节点：

- 教材原句
- 示例
- 图片描述
- 习题提示
- 课堂观察记录

## 节点类型选择

- 抽象观念、类别、定义 → `concept` 节点
- 具体物质、生物、地点、人物或机构 → `entity` 节点
- 值得保留的实验、探究、任务块 → `activity` 节点
- 可复用的操作（收集、加热、过滤、检验、比较等） → `method` 节点
- 定律、机制、规则等稳定的原理性陈述 → `principle` 节点
- 作为教学内容专门教授的公式、方程式、图示、符号系统 → `representation` 节点
- 可复用、可考核的能力 → `skill` 节点
- 仅当来源明确将其框定为可讨论的问题时 → `issue` 节点

需要更细标签时使用 `node_subkind`：

- `entity/substance`
- `activity/experiment`
- `representation/symbol`

## 属性选择

适合放入 `properties` 的：

- `entity/substance`
  - `appearance`（外观）
  - `color`（颜色）
  - `odor`（气味）
  - `state`（状态）
  - `solubility`（溶解性）
- 器材类 `entity`
  - `instrument_type`（仪器类型）
- `activity/experiment`
  - `method`（方法）
  - 短 `steps`（步骤）
  - 短 `materials`（材料）
- `issue`
  - `issue_type`
  - `application_domain`
- `representation`
  - `notation_type`

不应放入 `properties` 的：

- 教材原句逐字复制
- 长示例列表
- 应属于 `definition` 的定义
- 应属于 profiles 的年级/学段要求
- 应属于 edges 的关系事实
- 应属于 node cards 的长篇解释或推理

示例：

1. `entity/substance:nitrogen`
   - 适合的 `properties`：
     - `{"color":"无色","odor":"无气味","solubility":"难溶于水"}`
   - 不适合 `properties`：
     - "氮气为什么能作保护气" → node card

2. `entity/equipment:funnel`
   - 适合的 `properties`：
     - `{"instrument_type":"玻璃仪器"}`
   - 不适合 `properties`：
     - "过滤时如何配合玻璃棒使用" → node card

3. `activity/experiment:salt-purification`
   - 适合的 `properties`：
     - `{"steps":["溶解","过滤","蒸发"]}`
   - 不适合 `properties`：
     - "为什么先过滤再蒸发" → node card

4. `concept:chemical-change`
   - 适合的 `properties`：
     - 通常没有
   - 不适合 `properties`：
     - "与物理变化的区别、例子、易错点" → node card

## 节点层级选择

- 节点是稳定的跨课知识锚点，应在主干视图中显示 → `node_layer = backbone`
- 节点主要用来解释、操作、佐证、表示 backbone 节点 → `node_layer = support`
- 典型 backbone 节点：
  - 核心概念
  - 原理
  - 过程
  - 关键物质或其他稳定实体
  - 本身作为学习锚点的微观实体（如原子、分子）
- 典型 support 节点：
  - 实验
  - 可复用方法
  - 器材
  - 公式、方程式、图示等表示
  - 问题或应用场景
- 如果节点可复用但默认显示会撑乱主干图，仍保留为 canonical 节点，但标记为 `support`

## 规范化

- 优先复用已有 canonical 节点
- 在当前 SQLite 数据集中创建或完善课程画像
- 同一 canonical 节点在新学段/年级出现时，添加新的课程画像，不要替换旧的
- 新一轮抽取时不要删除之前学段的画像。初中和高中画像可以共存于同一 canonical 节点
- `framework_refs` 主要写在 profiles 上
- 不要在 canonical 图中创建课题级节点
- 课题的出现通过 mentions 记录，不通过章节父级边
- 只记录值得进入 backbone 的概念和关系，详细解释推迟到 node cards
- 决定复用或创建关系前，先用精确名称、别名、规范术语和过滤搜索检索一小批种子候选节点
- 种子检索后，只在最相关的候选周围检查局部子图，不要扩展到整书或整图
- 将批量检索的输入持久化到 SQLite runtime staging
- 不要让抽取器一次性推理整个 canonical 图

## 关系选择

- 只使用 schema 合法的 edge_type：
  - `is_a`
  - `instance_of`
  - `part_of`
  - `contains`
  - `prerequisite_for`
  - `depends_on`
  - `extends`
  - `explains`
  - `causes`
  - `affects`
  - `has_property`
  - `uses`
  - `measures`
  - `produces`
  - `consumes`
  - `applies_to`
  - `represented_by`
  - `symbolizes`
  - `analogous_to`
  - `same_as`
  - `related_to`
- 不要自造近义词，如 `relates_to`、`represents`、`contrasts_with`、`improves`
- `contains` 和 `part_of` 只用于稳定的结构关系（如"纯净物"包含"化合物"）
- `is_a` 用于明确的类型归属（如"氧气" is_a "单质"）
- `has_property` 用于稳定且可复用的属性
- `uses` 用于活动或方法直接使用物质、工具或表示
- `measures` 只在测量关系明确时使用
- `produces` 和 `consumes` 只在来源明确指出过程关系时使用
- `prerequisite_for` 和 `depends_on` 谨慎使用，仅在学习先后或语义依赖明确时
- 宁可用 `related_to`，不要自造新的关系类型
- 关系抽取分两步：
  - 先作为课题内的提议
  - 再在小范围内规范化为 canonical 边
- 批次级的临时图可以比 canonical 图更密。临时支撑节点和未决的替代方案可以局部存在，只要有证据支撑
- 将课题内的关系提议持久化到 SQLite runtime staging
- 只有满足以下条件才将提议提升为 canonical 边：
  - 两个端点在当前候选上下文中有依据
  - 关系有明确的证据支撑
  - 关系不与已有 canonical 边冲突（除非经过审查）
- 如果与已有 canonical 边冲突，不要自动覆盖旧边
- 证据薄弱或缺失时，不要将该关系纳入 canonical 图

## 边层级选择

- 关系应在默认主干视图中显示 → `edge_layer = backbone`
- 关系主要用来把实验、方法、表示、器材或上下文问题挂到 backbone 节点上 → `edge_layer = support`
- 关系应作为从 backbone 节点到支撑节点的默认展开入口 → `backbone_expand = true`
- 典型默认值：
  - backbone → backbone：`edge_layer = backbone`，`backbone_expand = false`
  - backbone ↔ support：`edge_layer = support`，`backbone_expand = true`
  - support ↔ support：`edge_layer = support`，`backbone_expand = false`

## 提及选择

- **每个 canonical 节点必须至少有一条提及指向教材位置**
- 没有提及的节点说明在来源材料中找不到出处，不应存在于 canonical 图中
- 为当前课题中有实质性支撑的每个 canonical 节点、边或画像创建提及
- 用提及的 `role` 记录课题对该目标的处理方式，如 `introduces`（首次引入）、`defines`（给出定义）、`focuses_on`（重点讨论）、`demonstrates`（举例说明）、`reviews`（复习回顾）
- 手动添加节点时（如规范化或补充边时），务必：
  1. 验证节点确实出现在来源教材中
  2. 创建对应的证据和提及记录
  3. 将提及链接到对应的锚点（课题或活动）
- 不要创建在任何教材或课程来源中都找不到出处的节点

## 必填最小字段

- 每个 canonical 节点必须包含至少一个 `learning_modes` 值
- 来源未明确时，按以下规则默认：
  - `concept`、`principle`、`process`、backbone `entity`、`representation` → `conceptual`
  - support `entity` → `factual`
  - `method`、`skill`、`activity` → `procedural`
  - `issue` → `conceptual`

## 展开边界

- 除非用户明确要求，否则 backbone 抽取阶段不写 node cards
- backbone 保持足够稀疏，让人可以快速审查

## 小组汇总

- 处理完一小批课题后，准备一份简短的主题汇总，供规范化或 QA 使用
- 汇总可以包含：
  - 反复出现的概念
  - 命名不一致的情况
  - 可能缺失的跨课链接
  - 术语不稳定的地方
- 默认不把汇总回写成 canonical 节点或 canonical 边

## 命名

- 教材用词稳定且可复用时，`canonical_name` 保持教材原词
- 公式、缩写和替代表述放入 `aliases`
- 抽取时不要合并两个名称；去重留给规范化阶段
