# Knowledge Map Extraction Project

从教材内容构建结构化、证据支撑、跨学科的统一知识图谱。

## 当前标准

当前项目的理论边界见 `docs/theory-decision-record.md`，顶层标准是 `ai-nks-v0.1`，详见 `docs/ai-nks-v0.1.md`。知识节点准入规则见 `docs/node-extraction-policy.md`。

`ai-nks-v0.1` 把 OKM 定义为面向 AI 使用的知识基础设施：底层是可追溯知识图谱，中层是通过 `ApiUnit` 聚合出来的知识单元视图，上层是对象级检索、语义规划、AI Tutor 和知识持续演化能力。

当前代码和 PostgreSQL 正在执行的底层工程 schema 仍是 `world-v1.2`。它是 `ai-nks-v0.1` 在当前代码中的可执行图谱基线，不是最新标准的完整边界。

- 顶层本体：`entity / concept / property / process / event / method / rule / representation / resource`
- 分类结构：`taxonomy term`
- 事实关系：`world_edges`
- 领域扩展：`world_domain_profiles`
- 证据与表达：`world_mentions / world_evidence / world_node_cards / world_node_bodies`
- `schema` 负责结构规则，`tag` 只负责检索辅助

核心依据：

- 本体与形式化表示：BFO / OWL
- 分类组织：SKOS
- 溯源：W3C PROV
- 教育投影：UNESCO / ISCED
- 知识形式：Ryle / Polanyi
- 学习维度：Anderson & Krathwohl

## 运行方式

```bash
# 只用 Docker 启动本地 PostgreSQL
docker compose up -d postgres
export DATABASE_URL=postgresql://okm:okm@localhost:5432/knowledge
docker compose exec -T postgres psql -U okm -d knowledge < schemas/pg/knowledge_store.sql
npm run import-file-assets -w packages/pipeline -- --dataset-id main --db "$DATABASE_URL"
export MINERU_API_KEY=你的_MinerU_API_令牌
export OPENAI_API_KEY=你的_OpenAI_API_令牌
# 可选：用于判断教材图片是否真正承载知识内容
export VLM_API_URL=http://localhost:8000/v1/chat/completions
export VLM_API_KEY=你的_视觉模型_API_令牌
export VLM_MODEL=gpt-4.1-mini

npm run server-pipeline-run -w packages/pipeline -- \
  --book-id chem-grade8 \
  --pdf-path /abs/path/to/book.pdf \
  --db "$DATABASE_URL"
```

如果只是启动前端和接口服务，不走抽取流程，也建议先完成上面的 schema 初始化。
`import-file-assets` 会把已有本地结构化索引导入 PostgreSQL，包括教材大纲、`data/enrich` 教材树和 MinerU 来源状态。PDF、Markdown、图片这类大文件仍保留在文件系统，PG 保存可查询的结构和索引。

传入 `--pdf-path` 时，流程会先调用 MinerU，把 PDF 转成
`data/mineru/<book-id>/full.md`，再生成或对齐大纲，最后按课时进入
`world_staging_*` 抽取。

抽取单个课时时，`server-pipeline-run` 默认会从 PostgreSQL 的
`world_enrich_books` 读取对应教材位置的少量 enrich 内容，作为
`lesson_context.enrich_hints` 传给模型。它只用于辅助判断术语边界、命名
和节点粒度，不能作为节点或关系证据；正式节点仍必须由当前课时的
Markdown、图片、表格或公式证据支撑。单独运行 `extract-lesson-openai`
时可以用 `--enrich-context` 开启这一辅助上下文。

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

如果教材里有大量图片，建议配置视觉模型。流程会把图片证据交给视觉模型判断：

- 核心图、辅助图会保留，并写入 `world_evidence.properties_json.image_relevance`
- 装饰图或不匹配图片会从当次抽取结果中删除
- 无法判断的图片会默认保留为 `uncertain`，进入前端调试页待复核；普通知识单元详情默认不显示，人工标为核心图、辅助图或保留后才显示

也可以在命令行里直接指定视觉模型参数：

```bash
npm run server-pipeline-run -w packages/pipeline -- \
  --book-id chem-grade8 \
  --pdf-path /abs/path/to/book.pdf \
  --vlm-api-url http://localhost:8000/v1/chat/completions \
  --vlm-model gpt-4.1-mini \
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

`server-pipeline-run` 会在归一化之后自动生成知识正文和按学段教学画像，再进入向量、严格质检和图完整性检查。知识正文写入 `world_node_bodies`；教学画像写入 `world_domain_profiles.properties_json.pedagogical_profiles_by_stage`。如果只想单独补跑，可以使用下面的命令：

```bash
npm run generate-node-bodies -w packages/pipeline -- \
  --dataset-id main \
  --db "$DATABASE_URL" \
  --pretty

npm run generate-pedagogical-profiles -w packages/pipeline -- \
  --dataset-id main \
  --book-id chem-grade8 \
  --school-stage junior-secondary \
  --grade-band grade-8 \
  --db "$DATABASE_URL" \
  --pretty
```

正文生成只支持模型生成，会根据节点、卡片上下文、课本原文片段和证据引用写入 `model_generation` 正文。默认不会覆盖人工维护的节点正文。需要重新生成旧正文时，可以追加 `--overwrite-existing`。

小批量检查质量时，可以加 `--node-id <id>` 或 `--limit`：

```bash
npm run generate-node-bodies -w packages/pipeline -- \
  --dataset-id main \
  --db "$DATABASE_URL" \
  --api-key-env OPENAI_API_KEY \
  --model "$OPENAI_MODEL" \
  --limit 5 \
  --pretty
```

前端调试页会读取流水线运行结果、质量检查结果和待复核图片。通过 `npm run dev` 启动后，从 `http://127.0.0.1:8765/viewer/` 进入 viewer 的调试入口，可以查看待复核图片，并把图片标为核心图、辅助图、保留或删除。待复核图片只在调试页出现；标为核心图、辅助图或保留后写入 `review_status=approved`，才会进入普通知识单元详情；标为删除后写入 `review_status=rejected`，继续隐藏。

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
- `world_node_bodies`

运行表：

- `world_textbook_outlines`
- `world_enrich_library`
- `world_enrich_books`
- `world_mineru_sources`
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
- `npm run generate-node-bodies -w packages/pipeline`
- `npm run generate-pedagogical-profiles -w packages/pipeline`
- `npm run store-staging -w packages/pipeline`
- `npm run staging-quality -w packages/pipeline`
- `npm run strict-qa -w packages/pipeline`
- `npm run graph-integrity -w packages/pipeline`
- `npm run parallel-lesson-pipeline -w packages/pipeline`
- `npm run retrieve-candidates -w packages/pipeline`
- `npm run merge-staged-lessons -w packages/pipeline`
- `npm run normalize -w packages/pipeline`

## 相关文档

- `schemas/world-knowledge-standard.md`
- `schemas/world-knowledge-architecture.md`
- `docs/theoretical-foundation.md`
- `docs/theory-decision-record.md`
- `docs/ai-nks-v0.1.md`
- `docs/documentation-status.md`
- `docs/current-system-architecture.md`
- `docs/knowledge-unit-contract.md`
- `docs/prompt-inventory.md`
- `schemas/world-knowledge.schema.json`
- `schemas/world-knowledge-edge.schema.json`
- `schemas/world-taxonomy-term.schema.json`
- `schemas/world-domain-profile.schema.json`
- `schemas/world-node-body.schema.json`
