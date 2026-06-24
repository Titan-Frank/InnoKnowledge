# Knowledge Map Extraction Project

从教材内容构建结构化、证据支撑、跨学科的统一知识图谱。

## 当前标准

项目已经正式切到新的统一世界知识标准，不再使用 `v2`。

- 顶层本体：`entity / concept / property / process / event / method / rule / representation / resource`
- 分类结构：`taxonomy term`
- 事实关系：`world_edges`
- 领域扩展：`world_domain_profiles`
- 证据约束：`world_mentions / world_evidence / world_node_cards`
- `schema` 负责结构规则，`tag` 只负责检索辅助

当前标准版本：`V1.2`

核心依据：

- 本体与形式化表示：BFO / OWL
- 分类组织：SKOS
- 溯源：W3C PROV
- 教育投影：UNESCO / ISCED
- 知识形式：Ryle / Polanyi
- 学习维度：Anderson & Krathwohl

## 运行方式

```bash
docker compose up -d
export DATABASE_URL=postgresql://okm:okm@localhost:5432/knowledge
export MINERU_API_KEY=你的_MinerU_API_令牌
export OPENAI_API_KEY=你的_OpenAI_API_令牌

npm run server-pipeline-run -w packages/pipeline -- \
  --book-id chem-grade8 \
  --pdf-path /abs/path/to/book.pdf \
  --db "$DATABASE_URL"
```

传入 `--pdf-path` 时，流程会先调用 MinerU，把 PDF 转成
`data/mineru/<book-id>/full.md`，再生成或对齐大纲，最后按课时进入
`world_staging_*` 抽取。也可以跳过 MinerU，直接传已经存在的 Markdown：

```bash
npm run server-pipeline-run -w packages/pipeline -- \
  --book-id chem-grade8 \
  --source-markdown-path /abs/path/to/full.md \
  --db "$DATABASE_URL"
```

如果 PDF 已经有公网 URL，也可以让 MinerU 直接抓取：

```bash
npm run server-pipeline-run -w packages/pipeline -- \
  --book-id chem-grade8 \
  --mineru-file-url https://example.com/textbook.pdf \
  --db "$DATABASE_URL"
```

课时知识抽取默认走模型抽取。可以显式指定模型：

```bash
npm run server-pipeline-run -w packages/pipeline -- \
  --book-id chem-grade8 \
  --pdf-path /abs/path/to/book.pdf \
  --model gpt-4.1 \
  --db "$DATABASE_URL"
```

## 主链路

```bash
npm run store-staging -w packages/pipeline -- \
  --db "$DATABASE_URL" \
  --root data/main \
  --book-id chem-grade8 \
  --batch-anchor struct:chem-grade8:lesson:1-1-1 \
  --nodes-json '<json>' \
  --edges-json '<json>' \
  --domain-profiles-json '<json>' \
  --mentions-json '<json>' \
  --evidence-json '<json>' \
  --node-cards-json '<json>'

npm run parallel-lesson-pipeline -w packages/pipeline -- \
  --root data/main \
  --dataset-id main \
  --book-id chem-grade8 \
  --db "$DATABASE_URL"
```

## 存储

唯一主存储是 PostgreSQL。

核心表：

- `world_datasets`
- `world_nodes`
- `world_edges`
- `world_taxonomy_terms`
- `world_taxonomy_edges`
- `world_domain_profiles`
- `world_mentions`
- `world_evidence`
- `world_node_cards`

运行表：

- `world_lesson_runs`
- `world_staging_nodes`
- `world_staging_edges`
- `world_staging_domain_profiles`
- `world_staging_mentions`
- `world_staging_evidence`
- `world_staging_node_cards`
- `world_merge_runs`
- `world_canonical_node_map`
- `retrieval_candidates`

数据库 schema：`schemas/pg/knowledge_store.sql`

## 主要 TypeScript 命令行入口

- `npm run server-pipeline-run -w packages/pipeline`
- `npm run extract-lesson-openai -w packages/pipeline`
- `npm run store-staging -w packages/pipeline`
- `npm run staging-quality -w packages/pipeline`
- `npm run parallel-lesson-pipeline -w packages/pipeline`
- `npm run retrieve-candidates -w packages/pipeline`

## 相关文档

- `schemas/world-knowledge-standard.md`
- `schemas/world-knowledge-architecture.md`
- `schemas/world-knowledge.schema.json`
- `schemas/world-knowledge-edge.schema.json`
- `schemas/world-taxonomy-term.schema.json`
- `schemas/world-domain-profile.schema.json`
