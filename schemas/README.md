# Knowledge Map Schemas

## 当前工程 schema 基线

仓库当前只保留一套可执行工程 schema：统一世界知识 `world-v1.2`。

注意：这里的 `world-v1.2` 是当前代码、数据库和质量检查正在使用的底层结构约束，不代表项目顶层标准版本。当前理论边界和顶层标准以 `docs/` 下的文档为准，尤其是：

- `docs/theory-decision-record.md`
- `docs/ai-nks-v0.1.md`
- `docs/documentation-status.md`
- `docs/ai_nks_technical_report_v0_2.md`
- `docs/knowledge-unit-contract.md`

```
schemas/
├── framework.schema.json
├── outline.schema.json
├── world-knowledge.schema.json
├── world-knowledge-edge.schema.json
├── world-node-body.schema.json
├── world-taxonomy-term.schema.json
├── world-domain-profile.schema.json
├── world-knowledge-standard.md
├── world-knowledge-architecture.md
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
  领域扩展 schema，用于 K12 等领域上下文。
- `world-knowledge-standard.md`
  分类标准说明。
- `world-knowledge-architecture.md`
  四层结构与 `schema/tag` 分工说明。
- `pg/knowledge_store.sql`
  当前正式运行的 PostgreSQL schema。

## 设计原则

1. 顶层本体决定知识对象是什么。
2. taxonomy 负责受控分类，不靠 tag 充当主分类。
3. edge 负责稳定事实关系。
4. domain profile 只承载领域扩展，不污染节点本体。
5. 证据与溯源约束横跨全部结构层。
6. `schema` 是结构规则，`tag` 只是检索辅助。

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
