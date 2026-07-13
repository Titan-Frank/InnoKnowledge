# Knowledge Map Schemas

## 当前工程 schema 基线

仓库当前只保留一套可执行工程结构：多学科统一知识网络 `world-v1.3`。

注意：这里的 `world-v1.3` 是当前代码、数据库和质量检查正在使用的底层结构约束，不代表项目顶层标准版本。当前理论边界和顶层标准以 `docs/` 下的文档为准，尤其是：

- `docs/theory-decision-record.md`
- `docs/ai-nks-v0.2.md`
- `docs/documentation-status.md`
- `docs/knowledge-unit-contract.md`
- `docs/interdisciplinary-knowledge-network.md`

```
schemas/
├── framework.schema.json
├── outline.schema.json
├── world-knowledge.schema.json
├── world-knowledge-edge.schema.json
├── world-node-body.schema.json
├── world-taxonomy-term.schema.json
├── world-domain-profile.schema.json
├── world-domain-schema.schema.json
├── world-curriculum-projection.schema.json
├── world-knowledge-standard.md
├── world-knowledge-architecture.md
├── extraction-templates/
│   └── textbook/
└── pg/
    └── knowledge_store.sql
```

## 文件说明

- `world-knowledge.schema.json`
  统一节点 schema，定义 9 类主类与最小字段。
- `world-knowledge-edge.schema.json`
  统一关系 schema，定义稳定关系类型。
- `world-node-body.schema.json`
  知识单元正文 schema，定义 Markdown 正文、媒体引用和证据引用。
- `world-taxonomy-term.schema.json`
  受控分类词表 schema。
- `world-domain-profile.schema.json`
  学科语义画像结构，只保存学科模式、学科角色和学科特有属性。
- `world-domain-schema.schema.json`
  领域模式结构，定义每个学科允许的角色集合。
- `world-curriculum-projection.schema.json`
  课程与教学投影结构，保存课程、学段、年级、课程角色和教学画像。
- `world-knowledge-standard.md`
  分类标准说明。
- `world-knowledge-architecture.md`
  四层结构与 `schema/tag` 分工说明。
- `pg/knowledge_store.sql`
  当前正式运行的 PostgreSQL 结构，包括正式表、暂存表、领域模式、来源策略、课程投影、运行记录和跨学科治理表。
- `extraction-templates/textbook/*.yaml`
  在统一 `world-v1.3` 结构上按学科收窄抽取关注点和优先关系；用户与模型看到中文关系名称，稳定代码只用于内部输出归一化。

## 设计原则

1. 顶层本体决定知识对象是什么。
2. taxonomy 负责受控分类，不靠 tag 充当主分类。
3. edge 负责稳定事实关系。
4. domain profile 只承载学科语义；课程、学段和教学画像进入 curriculum projection。
5. 证据与溯源约束横跨全部结构层。
6. `schema` 是结构规则，`tag` 只是检索辅助。
7. 跨学科扫描只生成治理候选；桥接路径逐段审核，标签不是证据，只有人工批准并应用后的关系才能进入正式网络。
8. `world_edges` 是唯一正式关系表；跨学科关系使用派生视图查询，不复制存储。
9. 同一知识身份通过节点归一解决，不创建已停用的 `same_as` 关系。

## 理论依据

这套标准的主要依据：

1. BFO / OWL
   用来支撑顶层本体与形式化结构约束。
2. SKOS
   用来支撑受控分类表，而不是把 tag 当正式分类。
3. W3C PROV
   用来支撑证据与溯源约束。
4. UNESCO / ISCED
   用来支撑学科、学段等教育投影应进入扩展层而不是污染本体层。
5. Ryle / Polanyi
   用来支撑 `knowledge_form` 至少区分命题知识与实践知识。
6. Anderson & Krathwohl
   用来支撑 `learning_mode = factual / conceptual / procedural / metacognitive`。
