# 当前系统架构

更新日期：2026-07-13

本文说明 Open Knowledge Map 当前代码仓库的系统架构。它描述的是现在已经落到代码和数据库里的工程结构，不是远期设想。

一句话概括：

> 当前系统是一个 TypeScript 优先的教材知识抽取与浏览系统：用流水线把 PDF 教材经 MinerU 解析后抽取成证据支撑的统一世界知识图谱，存入 PostgreSQL，再通过 Hono API 提供给 React 查看器展示和调试；经过筛选的 `ApiUnit` 还可以导出成不依赖数据库的只读公开成果。

## 一、总体结构

当前系统可以分成六层：

1. 数据输入层：PDF、MinerU 解析结果、教材大纲。
2. 抽取流水线：按 lesson/chunk 调用模型抽取知识候选，并写入 staging 表。
3. 归并与质量层：把 staging 结果合并成 canonical 世界知识表，再做规范化和质量检查。
4. 存储层：PostgreSQL，保存正式知识图谱、证据、卡片、正文和运行记录。
5. 服务层：Hono API，负责读取 PostgreSQL、组装图谱包、知识单元、搜索结果和流水线状态。
6. 前端层：React/Vite viewer，负责图谱浏览、知识点详情、教材工作台和流水线调试。

运行系统之外还有一个只读成果发布面：从 PostgreSQL 导出图谱、逐对象 `ApiUnit`、结构约束、校验值和静态 React 查看器，当前线上预览由 Cloudflare Pages 托管。

```mermaid
flowchart TD
  A["PDF 教材"] --> B["MinerU 解析"]
  B --> C
  C["MinerU 解析文本"] --> D["大纲生成与切分"]
  D --> E["lesson/chunk 抽取 worker"]
  E --> F["模型文本抽取"]
  E --> G["视觉模型图片判断"]
  F --> R["lesson_disposition: extracted / no_knowledge"]
  R --> H["world_lesson_runs 与 world_staging_*"]
  G --> H
  H --> I["staging_quality"]
  I --> J["merge-staged-lessons"]
  J --> K["world_* 正式表"]
  K --> L["normalize"]
  L --> N["generate-node-bodies"]
  N --> O["world_node_bodies"]
  O --> S["generate-pedagogical-profiles"]
  S --> T["world_domain_profiles 教学画像"]
  T --> M["strict_qa 与 graph_integrity"]
  K --> P["Hono API"]
  O --> P
  P --> Q["React viewer"]
  K --> U["公开成果导出"]
  O --> U
  U --> V["静态 React 查看器"]
```

## 二、代码分层

仓库目前是 npm workspaces 结构：

| 模块 | 路径 | 职责 |
|---|---|---|
| 共享类型 | `packages/types` | 保存前后端共享的 API 类型、图谱模型、知识单元结构、流水线请求和响应结构 |
| 抽取流水线 | `packages/pipeline` | 负责教材解析、课时抽取、staging 写入、归并、规范化、正文与教学画像生成、向量生成和质量检查 |
| 服务端 | `packages/server` | Hono API 服务，读取 PostgreSQL，提供 viewer 所需接口，也可以启动 pipeline |
| 前端 | `packages/viewer` | React/Vite 图谱浏览器，展示图谱、知识单元、教材树、流水线状态和图片复核 |
| 标准与数据库 schema | `schemas` | 世界知识标准、JSON Schema、PostgreSQL 建表文件 |
| 文档 | `docs` | 运行记录、系统说明、知识点契约、提示词清单和架构说明 |
| 只读成果 | `artifacts` | 保存版本化图谱、逐对象 `ApiUnit`、来源清单、校验值、读取示例和静态查看器 |

顶层命令：

| 命令 | 作用 |
|---|---|
| `npm run dev` | 构建 viewer 并启动一个本地服务，统一从 `http://127.0.0.1:8765/viewer/` 访问 |
| `npm run build` | 构建 types、pipeline、server、viewer |
| `npm run check` | 对所有 workspace 做 TypeScript 检查 |
| `npm test -w packages/pipeline` | 构建并运行 pipeline 测试 |
| `npm run verify` | 运行全仓类型检查、pipeline/server/viewer 测试和正式构建 |
| `npm run artifact:verify` | 校验公开成果文件、数量、引用结构和 SHA-256 校验值 |

## 三、知识体系结构

当前项目顶层标准是 `ai-nks-v0.1`，当前代码执行的底层工程 schema 是 `world-v1.2`，不再使用旧的 `schemas/v2/*` 假设。

这里需要分清两件事：

1. `ai-nks-v0.1` 是当前顶层系统标准，定义 Knowledge Object、Knowledge Unit / ApiUnit、Knowledge Network 和 Knowledge Runtime。
2. `world-v1.2` 是当前数据库、JSON Schema、pipeline 和 QA 正在使用的工程基线。

所以，本节描述的是 `ai-nks-v0.1` 在当前代码中的落地状态，尤其是已经落地的底层图谱结构。完整文档优先级见 `docs/documentation-status.md`。

知识体系被拆成四层，加一个横向证据平面：

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

### 1. 顶层本体

顶层本体回答：“这个知识对象是什么类型？”

当前节点主类固定为九类：

```text
entity / concept / property / process / event / method / rule / representation / resource
```

落点：

- 工程类型：`packages/types/src/models.ts`
- pipeline 枚举：`packages/pipeline/src/shared/knowledge.ts`
- 数据库表：`world_nodes`
- 文档标准：`schemas/world-knowledge-standard.md`

### 2. 概念分类表

概念分类表回答：“这个对象属于哪个受控分类体系？”

它和 `tag` 不一样。分类表是正式结构，应该有稳定 ID、上下位关系和边界；`tag` 只是检索辅助。

落点：

- schema：`schemas/world-taxonomy-term.schema.json`
- 数据库表：`world_taxonomy_terms`、`world_taxonomy_edges`

### 3. 事实关系层

事实关系层回答：“知识对象之间有什么稳定关系？”

当前关系类型固定为十五类：

```text
is_a / instance_of / part_of / contains / has_property / uses / produces /
depends_on / prerequisite_for / causes / affects / represents / about /
same_as / related_to
```

落点：

- 工程类型：`ApiEdge`、`ApiUnitRelation`
- 数据库表：`world_edges`
- 质量检查：`strict-qa`、`graph-integrity`

### 4. 领域扩展层

领域扩展层回答：“同一个知识对象进入具体学科、学段和课程后，要补充什么教学信息？”

例如，“能量”作为一个知识对象，本体身份不应该被不同教材改写；但它在初中物理、高中物理、化学、生物里的教学重点可以不同。这些差异放在 `world_domain_profiles`。

落点：

- 数据库表：`world_domain_profiles`
- 教学画像扩展：数据库列 `properties_json` 映射为 `ApiUnit.domain_profiles[].properties`；旧数据使用单份 `pedagogical_profile`，自动数据按学段使用 `pedagogical_profiles_by_stage`
- 前端展示：知识单元详情里的“领域画像”

### 5. 证据与溯源平面

证据平面回答：“这个节点、关系、卡片和正文为什么可信？”

核心表：

- `world_mentions`：教材或资源中对知识对象的提及。
- `world_evidence`：证据原文、图片、表格、公式等证据单元。
- `world_node_cards`：结构化摘要卡片。
- `world_node_bodies`：持久化知识正文。

这里有一个重要边界：

1. `world_evidence` 和 `source_fragments` 才是课本原文或原始证据。
2. `world_node_cards` 是结构化摘要，不是课本原文。
3. `world_node_bodies` 是面向阅读和生成的知识正文，也不是课本原文。

## 四、抽取流水线

抽取流水线主要在 `packages/pipeline` 中。

最常用入口是：

```bash
npm run server-pipeline-run -w packages/pipeline -- \
  --book-id chem-grade8 \
  --pdf-path /abs/path/to/book.pdf \
  --db "$DATABASE_URL"
```

### 1. 输入准备

输入可以来自两种路径：

| 输入 | 处理方式 |
|---|---|
| 本地 PDF | 先交给 MinerU 解析，再得到 Markdown |
| PDF URL | MinerU 直接抓取 URL 并解析 |

相关代码：

- `packages/pipeline/src/outline/mineru-source.ts`
- `packages/pipeline/src/outline/pdf-outline.ts`
- `packages/pipeline/src/outline/source-preparation.ts`
- `packages/pipeline/src/outline/chunk-outline.ts`

### 2. 大纲与切分

系统会为每本书维护一个 outline。正式结构存入 PostgreSQL：

```text
world_textbook_outlines.outline_json
```

`data/outlines/<book-id>.outline.json` 只作为导入来源或运行时工作文件，不是服务端读取的主存储。

如果教材粒度太大，会按 lesson/chunk 切分。抽取 worker 的基本单位不是整本书，而是一个 lesson/chunk。

### 3. 模型抽取

每个 lesson/chunk 会进入 `extract-lesson-openai`。

核心代码：

- `packages/pipeline/src/extraction/model-lesson-extraction.ts`
- `packages/pipeline/src/cli/extract-lesson-openai.ts`
- `packages/pipeline/src/extraction/parallel-batch.ts`

抽取模型收到两类东西：

1. 提示词：告诉模型要抽取节点、关系、证据、领域画像和节点卡片。
2. JSON Schema：通过 API 请求体约束模型必须返回指定 JSON 结构。

输出不是直接写入正式表，而是先规范化成 staging 行。每个课时还必须给出显式抽取结论：

| 字段 | 含义 |
|---|---|
| `lesson_disposition=extracted` | 当前课时抽取出了可进入后续质量检查的候选知识对象 |
| `lesson_disposition=no_knowledge` | 当前课时没有符合节点准入规则的知识对象；这是合法结果，不是模型调用失败 |
| `no_knowledge_reason` | 当结果为 `no_knowledge` 时，记录为何没有可抽取知识，例如只有目录、页眉页脚、练习编号或上下文不足 |

`no_knowledge` 课时允许节点、关系和证据数组为空，仍会保留课时运行记录。模型调用失败、JSON 解析失败，以及没有显式声明 `no_knowledge` 的异常空结果，不能伪装成合法空课时。

### 4. 图片判断

如果配置了视觉模型，图片证据会先经过图片相关性判断。

核心代码：

- `packages/pipeline/src/extraction/image-relevance.ts`

判断结果会写入图片证据的 `properties.image_relevance`，大致分为：

| 结果 | 含义 |
|---|---|
| `core_content` | 图片直接表达知识内容 |
| `supporting` | 图片与上下文有关，但主要是辅助说明 |
| `decorative` | 装饰图、图标、二维码等 |
| `mismatch` | 图片有内容，但和当前课时不匹配 |
| `uncertain` | 无法判断，默认保留并进入复核 |

产品显示规则固定为：

1. `uncertain` 且未复核，或 `review_status=pending`：前端调试页显示，普通知识单元详情默认隐藏。
2. 人工标为核心图、辅助图或保留后，写入 `review_status=approved`：普通知识单元详情显示。
3. 人工标为删除后，写入 `review_status=rejected`：普通知识单元详情隐藏。

### 5. Staging 写入

lesson worker 只能写：

- `world_lesson_runs`
- `world_staging_nodes`
- `world_staging_edges`
- `world_staging_domain_profiles`
- `world_staging_mentions`
- `world_staging_evidence`
- `world_staging_node_cards`

这个边界很重要：lesson worker 不直接写正式 `world_*` 表。正式表只能由 reducer 或后续规范化步骤写入。

相关代码：

- `packages/pipeline/src/staging/staging.ts`
- `packages/pipeline/src/staging/staging-rows.ts`
- `packages/pipeline/src/staging/staging-sql.ts`
- `packages/pipeline/src/staging/staging-store.ts`

每个 lesson run 的 staging 写入是一个事务：先 upsert `world_lesson_runs`，再删除该 `lesson_run_id` 的旧 staging 行，最后插入新的 staging 行；任一步失败都会回滚，不能留下半写入状态。

### 6. 质量门和归并

staging 写入后，系统会执行：

1. `staging-quality`：检查单课时 staging 数据是否完整。
2. `merge-staged-lessons`：把多个 lesson 的候选节点归并为 canonical 节点。
3. `normalize`：修正卡片、领域画像、证据引用等后处理。
4. `generate-node-bodies`：根据正式节点、卡片和证据生成知识正文。
5. `generate-pedagogical-profiles`：按“节点＋领域＋学段”生成教学画像。
6. `strict-qa`：检查 schema 合法性及自动教学画像的字段、学段、生成信息和证据引用。
7. `graph-integrity`：检查图结构完整性，并可标记 QA 通过。

质量检查把错误和警告分开处理：

1. 显式声明 `lesson_disposition=no_knowledge` 且提供 `no_knowledge_reason` 的空课时属于合法空结果，不因节点数为零自动阻断。
2. 需要人工判断但不必立即阻断的事项写入 `world_lesson_runs.properties_json.quality_warnings`；同时写入 `quality_review_required=true` 和相关的 `review_node_ids`。
3. 上述警告不是一次性日志。质量仪表盘会把它们计入“人工待处理”，直到对应问题完成复核。
4. 为保留追溯链而由程序补出的合成证据必须带上 `properties.synthetic=true`、`properties.quality_excluded=true`、`properties.review_status=pending`。它可以进入待复核列表，但不计入正式证据覆盖率，不能借此把证据不足包装成质量通过。

正式数据写入也有明确事务边界：

1. `merge-staged-lessons` 和 `normalize` 使用同一个数据集级事务锁。同一数据集上的归并与规范化必须串行执行，不同数据集仍可并行处理。
2. 两条流程都在取得数据集锁后读取最新已提交数据，并把读取、计划生成和正式写入放在同一事务中。任一步失败时整体回滚，不能留下半次归并或半次规范化结果。
3. 事务使用 PostgreSQL 默认的 `READ COMMITTED` 隔离级别。数据集锁负责防止正式知识表上的同数据集并发写入，也避免任务等待锁后继续使用等待前的旧快照。
4. 事务与锁只保证处理一致性，不替代质量判断。合法空课时、待复核警告和合成证据仍按上述规则单独治理。

核心代码：

- `packages/pipeline/src/staging/staging-quality.ts`
- `packages/pipeline/src/merge/*`
- `packages/pipeline/src/normalize/*`
- `packages/pipeline/src/qa/*`

### 7. 知识正文生成

一键流水线会在归一化之后自动生成知识正文，然后再进入严格质检和图完整性检查。默认使用模型模式，根据节点、卡片、课本原文片段和证据引用写入 `world_node_bodies`。需要单独补跑或小批量检查时，可以直接调用：

```bash
npm run generate-node-bodies -w packages/pipeline -- \
  --dataset-id main \
  --db "$DATABASE_URL" \
  --pretty
```

正文生成只支持模型生成：调用 OpenAI 兼容模型，根据节点信息、高质量卡片、课本原文片段和证据引用生成正式正文，写入来源标记为 `model_generation`。默认不会覆盖人工维护的正文；需要重新生成旧正文时显式追加 `--overwrite-existing`。

核心代码：

- `packages/pipeline/src/unit-bodies/generate-node-bodies.ts`
- `packages/pipeline/src/cli/generate-node-bodies.ts`

### 8. 教学画像生成

一键流水线会在知识正文之后、向量和严格质检之前自动生成教学画像。生成任务以“领域画像记录＋学段”为单位，读取正式节点、结构化卡片、关系和课本证据，结果写入现有 `world_domain_profiles.properties_json.pedagogical_profiles_by_stage`，不增加数据库列。

```bash
npm run generate-pedagogical-profiles -w packages/pipeline -- \
  --dataset-id main \
  --book-id textbook-id \
  --school-stage junior-secondary \
  --grade-band grade-8 \
  --db "$DATABASE_URL" \
  --pretty
```

自动生成遵循以下边界：

1. 初中、高中等学段分别保存，不共用一份教学目标或评价任务。
2. 模型只能引用当前任务提供的证据编号；严格质检会再次检查引用。
3. 生成信息记录模型、提示词版本、生成时间、输入摘要、可信度和审核状态。
4. 旧的单份教学画像、人工画像和已确认画像不会被自动覆盖。
5. 输入摘要未变化时跳过重复生成；证据、节点、卡片或关系变化时自动更新尚未确认的模型画像。

核心代码：

- `packages/pipeline/src/pedagogical-profiles/generate-pedagogical-profiles.ts`
- `packages/pipeline/src/cli/generate-pedagogical-profiles.ts`

## 五、数据库结构

唯一主存储是 PostgreSQL。建表文件是：

```text
schemas/pg/knowledge_store.sql
```

### 1. 正式知识表

| 表 | 职责 |
|---|---|
| `world_datasets` | 数据集元信息 |
| `world_nodes` | 知识对象身份核心 |
| `world_edges` | 知识对象之间的关系 |
| `world_taxonomy_terms` | 受控分类词 |
| `world_taxonomy_edges` | 分类词之间的上下位或相关关系 |
| `world_domain_profiles` | 学科、学段、课程角色和教学画像 |
| `world_mentions` | 来源中对知识对象的提及 |
| `world_evidence` | 证据单元 |
| `world_evidence_links` | 证据和对象之间的补充链接 |
| `world_node_cards` | 节点结构化摘要卡片 |
| `world_node_bodies` | 节点持久化知识正文 |
| `world_node_terms` | 节点名称与别名的规范化检索词 |
| `world_unit_embeddings` | 完整 `ApiUnit` 的向量及模型信息 |

### 2. 来源与教材准备表

| 表 | 职责 |
|---|---|
| `world_source_artifacts` | 来源材料身份、书目和来源权利元数据 |
| `world_textbook_outlines` | 教材目录和课时结构 |
| `world_mineru_sources` | MinerU 解析状态和产物位置 |
| `world_enrich_library` | 富化资料库元信息 |
| `world_enrich_books` | 可用于命名和粒度判断的教材富化索引 |

### 3. 运行和中间表

| 表 | 职责 |
|---|---|
| `world_lesson_runs` | 每个 lesson/chunk 抽取任务的状态、`lesson_disposition`、统计、质量警告和人工复核信息 |
| `world_staging_nodes` | 单课时候选节点 |
| `world_staging_edges` | 单课时候选关系 |
| `world_staging_domain_profiles` | 单课时候选领域画像 |
| `world_staging_mentions` | 单课时候选提及 |
| `world_staging_evidence` | 单课时候选证据 |
| `world_staging_node_cards` | 单课时候选卡片 |
| `world_merge_runs` | 归并运行记录 |
| `world_canonical_node_map` | raw node 到 canonical node 的映射和待复核项 |
| `retrieval_candidates` | 检索候选，用于抽取上下文补充 |
| `world_pipeline_jobs` | 一次服务端流水线任务的总状态 |
| `world_pipeline_job_stages` | 流水线各阶段状态和顺序 |
| `world_pipeline_job_events` | 流水线事件记录 |
| `world_pipeline_worker_states` | 并行课时工作器状态 |

### 4. 数据边界

当前系统有几个明确边界：

1. `data`、`runs`、`storage`、`tmp` 是生成物或本地运行产物，不是权威源。
2. PostgreSQL 是唯一主存储。
3. lesson worker 只写 staging 表。
4. reducer 和 normalize 才能写正式知识表，并且读取、计划生成与正式写入必须在同一个受数据集锁保护的事务中完成。
5. 前端不要直接拼数据库表，应该通过 API 消费服务端组装好的结构。

## 六、服务端 API

服务端在 `packages/server`，基于 Hono。

入口：

- `packages/server/src/index.ts`
- `packages/server/src/app.ts`

主要 API：

| 接口 | 职责 |
|---|---|
| `GET /api/health` | 检查服务和数据库连接 |
| `GET /api/meta` | 返回可用数据源、当前活跃数据源和教材列表 |
| `GET /api/source/:key/bundle` | 返回图谱总包，供 viewer 初始化图谱 |
| `GET /api/source/:key/unit/:node_id` | 返回完整知识单元 `ApiUnit` |
| `GET /api/source/:key/node-card/:node_id` | 返回节点结构化卡片 |
| `GET /api/source/:key/search` | 节点搜索，文本搜索和向量搜索融合 |
| `GET /api/source/:key/units/search` | 检索完整 `ApiUnit`，支持文本、向量和混合模式 |
| `POST /api/source/:key/grounded-generate` | 基于检索到的 `ApiUnit` 生成带证据编号的回答 |
| `POST /api/source/:key/grounded-generate/stream` | 以服务器事件流返回检索结果和增量回答 |
| `GET /api/source/:key/pipeline` | 返回流水线运行状态 |
| `GET /api/source/:key/pipeline/quality` | 返回质量仪表盘数据 |
| `GET /api/source/:key/pipeline/jobs` | 返回最近的流水线作业列表 |
| `GET /api/source/:key/pipeline/jobs/:job_id` | 返回单次任务详情 |
| `POST /api/source/:key/pipeline/start` | 从前端启动 pipeline |
| `POST /api/source/:key/pipeline/infer-textbook` | 根据 book id 和 PDF 名称推断教材元信息 |
| `GET /api/source/:key/image-reviews` | 返回待复核图片证据 |
| `POST /api/source/:key/image-reviews/:evidence_id` | 写入人工图片复核结果 |
| `GET /api/source/:key/assets/:asset_path` | 提供本地教材图片等资源 |
| `GET /api/enrich/books`、`GET /api/enrich/book` | 教材工作台相关数据 |
| `GET /api/annotation/textbooks` | 返回标注工作台可用教材 |
| `GET /api/annotation/textbooks/:bookId/lessons/:lessonId` | 返回指定课时的原文和标注上下文 |

核心查询逻辑在：

```text
packages/server/src/db/queries.ts
```

## 七、知识单元 API

当前消费侧最重要的公开结构是 `ApiUnit`。

它不是单张数据库表，而是服务端按 `node_id` 聚合出来的完整知识点视图。

```ts
interface ApiUnit {
  node: ApiUnitNode;
  relations: {
    outgoing: ApiUnitRelation[];
    incoming: ApiUnitRelation[];
  };
  domain_profiles: ApiUnitDomainProfile[];
  mentions: ApiMention[];
  evidence: ApiEvidence[];
  media: ApiUnitMedia[];
  source_fragments: ApiUnitSourceFragment[];
  card: ApiNodeCard | null;
  body: ApiUnitBody | null;
  completeness: ApiUnitCompleteness;
}
```

来源关系：

| 字段 | 来源 |
|---|---|
| `node` | `world_nodes` |
| `relations` | `world_edges` |
| `domain_profiles` | `world_domain_profiles` |
| `mentions` | `world_mentions` |
| `evidence` | `world_evidence` |
| `media` | 从图片证据解析 |
| `source_fragments` | 从证据和原文 Markdown 解析 |
| `card` | `world_node_cards` |
| `body` | 只读取 `world_node_bodies`；没有持久化正文时返回空 |
| `completeness` | 服务端按 `ApiUnit` 聚合结果计算 |

这就是当前项目里“知识点”的消费侧定义：不是一个孤立节点，而是以节点为身份核心聚合出来的完整知识单元。

`completeness` 当前检查定义、语义核心、关系、证据、原文片段、领域画像、正文引用、结构化卡片和来源提及。它用于让前端、导出和未来 Runtime 判断知识单元是否足够可用，不改变底层表结构。

## 八、前端 viewer

前端在 `packages/viewer`，基于 React、Vite、G6。

入口：

- `packages/viewer/src/App.tsx`
- `packages/viewer/src/main.tsx`

当前有四个主要工作区：

| 工作区 | 主要组件 | 职责 |
|---|---|---|
| 图谱浏览 | `GraphCanvas`、`FilterPanel`、`DetailPanel`、`GraphSearchPanel` | 浏览知识图谱、筛选节点、查看详情，并在展示页内完成对象检索和带引用回答 |
| 流水线调试 | `PipelineDebugPage` | 查看 pipeline 状态、启动抽取、复核图片 |
| 教材工作台 | `TextbookTreePage` | 查看教材树和教材相关内容 |
| 标注工作台 | `AnnotationWorkbench` | 查看教材原文并手工补充节点、边和证据 |

前端启动时会先请求：

1. `GET /api/meta`：获取可用数据源。
2. `GET /api/source/:key/bundle`：加载图谱总包。

点击图上节点后，前端会请求：

```text
GET /api/source/:key/unit/:node_id
```

展示页内的检索浮窗会调用：

```text
GET /api/source/:key/units/search
POST /api/source/:key/grounded-generate
```

命中对象会同步到图谱样式层，用于高亮检索结果；点击命中对象或引用会选中并定位到对应节点。

然后在右侧“知识单元详情”面板中按下面的层级展示：

- 对象概览：知识对象的定义和别名
- 知识属性：领域、知识形式、修订版布鲁姆知识维度、适用范围和主题标签；主题标签只用于检索与归类，不冒充图谱关系
- 完整知识单元：聚合 `ApiUnit` 的知识正文、知识骨架、课本原文、结构化卡片、关系和领域画像
- 教材位置：来自当前数据源中的对象提及
- 补充属性：未进入正式展示分区的扩展字段，默认折叠

其中知识正文来自 `ApiUnit.body`，课本原文来自 `ApiUnit.source_fragments`，结构化卡片来自 `ApiUnit.card`，关系来自 `ApiUnit.relations`，领域画像来自 `ApiUnit.domain_profiles`，证据和媒体来自 `ApiUnit.evidence`、`ApiUnit.media`。

## 九、提示词与结构化输出

当前项目有五类主要模型调用提示词，以及一类在质量失败后追加到 P1 的定向重抽提示：

1. P1：两阶段课时知识对象、证据与关系抽取。
2. P2：教材图片相关性和可见内容判断。
3. P3：知识正文生成。
4. P4：按学段生成教学画像。
5. P5：基于 `ApiUnit` 的带依据生成。
6. P6：暂存质量失败后的定向重抽补充提示。

但模型输出 JSON 不是只靠提示词。

实际机制是：

```text
输入数据 + 提示词 + JSON Schema 输出约束 -> 模型返回 JSON -> 代码解析 JSON -> pipeline 继续处理
```

也就是说：

1. 提示词负责说明任务。
2. JSON Schema 负责约束输出结构。
3. pipeline 负责解析、清洗、写 staging、归并和质量检查。

完整提示词清单见：

```text
docs/prompt-inventory.md
```

## 十、本地运行架构

本地开发时只要求 Docker 启动 PostgreSQL，不需要应用容器。

```bash
docker compose up -d postgres
export DATABASE_URL=postgresql://okm:okm@localhost:5432/knowledge
docker compose exec -T postgres psql -U okm -d knowledge < schemas/pg/knowledge_store.sql
npm run dev
```

本地应用只保留一个访问端口：后端服务监听 `8765`，并从 `/viewer/` 提供前端页面；viewer 在开发时只监听文件变化并更新构建产物，不再单独启动前端端口。

常用环境变量：

| 变量 | 作用 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接地址 |
| `OPENAI_API_KEY` | 文本模型抽取 |
| `OPENAI_BASE_URL` | OpenAI 兼容文本模型服务根地址 |
| `OPENAI_MODEL` | 文本模型名称 |
| `MINERU_API_KEY` | PDF 解析 |
| `VLM_API_URL` | 视觉模型接口 |
| `VLM_API_KEY` | 视觉模型密钥 |
| `VLM_MODEL` | 视觉模型名称 |
| `VLM_CACHE_DIR` | 图片判断缓存目录 |
| `VLM_CONCURRENCY` | 图片判断并发数 |
| `EMBEDDING_URL` | 明确配置的向量服务地址；未配置时不调用向量服务 |
| `EMBEDDING_API_KEY` | 向量服务密钥 |
| `EMBEDDING_MODEL` | 向量模型名称 |

## 十一、只读公开成果层

公开成果目录当前为 `artifacts/okm-public-v0.1.0`，由 PostgreSQL 的 `knowledge/main` 导出。它包含：

1. `manifest.json`：版本、数量、筛选条件、来源状态和文件入口。
2. `data/graph.json`：静态图谱。
3. `data/units/unit-*.json`：每个正式知识对象对应的完整 `ApiUnit`。
4. `schemas/api-unit.schema.json`：机器可读的公共契约。
5. `SOURCES.md`、`RIGHTS.md` 和 `SHA256SUMS`：来源边界、权利边界和文件校验值。
6. JavaScript、Python 读取示例以及复用正式 React 前端构建的只读查看器。

当前 v0.1.0 公开查看口径是 182 个知识对象、144 条关系、537 条导出证据、182 张卡片和 182 篇正文。线上入口是 <https://open-knowledge-map.pages.dev/>。公开模式不连接 PostgreSQL，不提供抽取、标注、教材管理、回答生成和任何写操作。

当前来源编号可以从知识单元中恢复，书名、出版社、ISBN、版次和印次可以从本地 PDF 版权页核对，但准确的上游网址和许可证标识仍未写入 `world_source_artifacts`。PDF 本身保留版权，当前没有适用的开放许可证或明确再分发授权。因此它是公开查看成果，不应被描述为已经完成授权的数据集。

## 十二、当前关键边界

### 1. 抽取中间产物和正式知识库分开

模型输出不是最终知识库。它先进入 `world_staging_*`，再经过质量门和 reducer，才进入正式 `world_*` 表。

### 2. 节点不是完整知识点

`world_nodes` 只是知识对象骨架。完整知识点应该通过 `ApiUnit` 获取。

### 3. 正文不是原文

`world_node_bodies` 是知识正文，`world_node_cards` 是结构化摘要，`source_fragments` 才是课本原文片段。

### 4. schema 和 tag 分工不同

`schema` 决定对象类型、关系和结构约束；`tag` 只做检索辅助，不承担主分类。

### 5. server 是前端的唯一数据组装层

viewer 不应该自己理解数据库表结构。它应该消费 `BundleResponse`、`ApiUnit`、`PipelineResponse` 等公开 API 结构。

### 6. 合法空课时和质量警告必须显式保存

`lesson_disposition=no_knowledge` 表示“当前课时确实没有符合准入规则的知识”，不是抽取失败的兜底值。需要人工判断的质量警告和合成证据必须持久化进入复核流程；它们不能只出现在运行日志中，也不能计入正式证据覆盖率。

## 十三、当前还可以继续加强的点

这部分不是当前架构已经完成的事实，而是从现状自然推出来的改进方向：

1. 把 `ApiUnit` 当成正式公开契约继续稳定下来，避免前端和未来生成系统各自拼表。
2. 继续收紧 `semantic_core`、`pedagogical_profiles_by_stage` 等扩展字段的 schema，并仅把单份 `pedagogical_profile` 作为历史兼容结构。
3. 让 pipeline manifest 更好支持断点续跑和最终状态回写。
4. 补充对象级检索和生成评测，让知识单元不只可看，还能被稳定调用。
