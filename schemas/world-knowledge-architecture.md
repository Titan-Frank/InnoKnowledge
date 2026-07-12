# World Knowledge Architecture V1.2

状态说明：本文是当前代码和数据库正在执行的 `world-v1.2` 工程架构说明，主要描述底层图谱 schema。当前顶层标准是 `ai-nks-v0.1`；完整标准见 `docs/ai-nks-v0.1.md`，文档优先级和过期边界见 `docs/documentation-status.md`。

这份文档把底层统一知识图谱结构明确拆成四层，并补上证据约束。

## 一、总结构

```text
顶层本体
  ↓
概念分类表
  ↓
事实关系层
  ↓
领域扩展层

证据与溯源平面横跨全部四层
```

它们的分工必须严格分开。

## 二、四层结构

### 1. 顶层本体

回答：

- 这个知识对象到底是什么类型？

当前主类：

- `entity`
- `concept`
- `property`
- `process`
- `event`
- `method`
- `rule`
- `representation`
- `resource`

对应文件：

- `world-knowledge-standard.md`
- `world-knowledge.schema.json`

### 2. 概念分类表

回答：

- 这个对象属于哪个受控分类体系？
- 这些分类词之间是什么上下位关系？

它不是节点本体本身，而是受控词表。

当前文件：

- `world-taxonomy-term.schema.json`
- `pg/world_taxonomy.sql`

当前结构原则：

- 词条必须有唯一 ID
- 词条之间允许 `broader / narrower / related`
- 词条不等于节点

### 3. 事实关系层

回答：

- 这些对象之间有什么稳定关系？

例如：

- `is_a`
- `part_of`
- `causes`
- `prerequisite_for`

当前文件：

- `world-knowledge-edge.schema.json`
- `pg/world_knowledge.sql`

结构原则：

- 层级边应无环
- 事实边必须指向存在的节点
- 事实边不承担教学画像功能

### 4. 领域扩展层

回答：

- 同一个知识对象进入某个领域后，需要附加哪些特定信息？

例如：

- 一个概念在 K12 数学和 K12 物理里的课程角色不同
- 一个对象在小学和高中里的教学重点不同

当前文件：

- `world-domain-profile.schema.json`
- `pg/world_taxonomy.sql`

结构原则：

- 扩展信息附着在 `node_id` 上
- 领域扩展不改写节点本体
- 学科、学段、课程角色应放在这一层
- 课时抽取只提供基础领域归属，不直接生成教学画像
- 正式数据完成归一化后，由 P4 后处理按“领域画像记录＋学段”自动生成教学画像
- 自动结果在数据库中写入 `world_domain_profiles.properties_json.pedagogical_profiles_by_stage`，接口通过 `ApiUnit.domain_profiles[].properties.pedagogical_profiles_by_stage` 返回
- 旧的单份 `properties_json.pedagogical_profile` / `properties.pedagogical_profile` 只用于兼容历史数据

## 三、证据与溯源平面

证据不是附属模块，而是全局约束。

它回答：

- 这个节点为什么存在？
- 这条关系为什么成立？
- 这个领域画像来自哪里？

当前运行表：

- `world_mentions`
- `world_evidence`
- `world_node_cards`
- `world_node_bodies`

其中 `world_node_cards` 是结构化摘要，`world_node_bodies` 是持久化知识正文，二者都不等于课本原文。课本原文应通过证据和原文片段读取。

理论上它更接近一个横跨四层的 provenance 平面，而不是第五个分类层。

这部分的设计更接近 W3C PROV 的思想：

- 每个结论都要能回到来源
- 来源和结论之间要保持可追溯关系

## 四、`schema` 和 `tag` 的区别

### `schema`

`schema` 是正式结构规则。

它规定：

- 对象类型
- 必填字段
- 合法关系
- 分类表结构
- 领域扩展结构
- 证据约束位置

也就是说，四层结构本身都属于 `schema` 的范围。

### `tag`

`tag` 是检索词，不是结构规则。

它只负责：

- 帮人找东西
- 帮内容聚合
- 做粗粒度主题索引

例如：

- `algebra`
- `k12`
- `classical-mechanics`
- `ethics`

### 最关键的区别

`schema` 回答：

- “它是什么？”
- “它能和什么发生什么关系？”

`tag` 回答：

- “它和什么主题有关？”

## 五、为什么不能用 tag 代替分类表

因为 `tag` 没有稳定结构。

它通常没有：

- 唯一 ID
- 上下位关系
- 受控枚举
- 明确边界

所以：

- 分类表是正式结构
- tag 是检索辅助

## 六、适合研究的最小工作方式

如果目标是同时兼顾工程可落地和学术可论证，建议按下面这个最小闭环运行：

1. 顶层本体决定节点主类
2. 概念分类表管理受控词
3. 事实关系层管理跨对象关系
4. 领域扩展层承载课程化投影
5. 证据平面为每一层提供可追溯来源
6. tag 永远不承担主分类职责

这套结构的最大优点是：

- 简洁
- 可扩展
- 可验证
- 可做跨学科对齐
