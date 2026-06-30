# 当前系统架构

更新日期：2026-06-27

本文说明 Open Knowledge Map 当前代码仓库的系统架构。它描述的是现在已经落到代码和数据库里的工程结构，不是远期设想。

一句话概括：

> 当前系统是一个 TypeScript 优先的教材知识抽取与浏览系统：用 pipeline 把 PDF 教材经 MinerU 解析后抽取成证据支撑的统一世界知识图谱，存入 PostgreSQL，再通过 Hono API 提供给 React viewer 展示和调试。

## 一、总体结构

当前系统可以分成六层：

1. 数据输入层：PDF、MinerU 解析结果、教材大纲。
2. 抽取流水线：按 lesson/chunk 调用模型抽取知识候选，并写入 staging 表。
3. 归并与质量层：把 staging 结果合并成 canonical 世界知识表，再做规范化和质量检查。
4. 存储层：PostgreSQL，保存正式知识图谱、证据、卡片、正文和运行记录。
5. 服务层：Hono API，负责读取 PostgreSQL、组装图谱包、知识单元、搜索结果和流水线状态。
6. 前端层：React/Vite viewer，负责图谱浏览、知识点详情、教材工作台和流水线调试。

```mermaid
flowchart TD
  A["PDF 教材"] --> B["MinerU 解析"]
  B --> C
  C["MinerU 解析文本"] --> D["大纲生成与切分"]
  D --> E["lesson/chunk 抽取 worker"]
  E --> F["模型文本抽取"]
  E --> G["视觉模型图片判断"]
  F --> H["world_lesson_runs 与 world_staging_*"]
  G --> H
  H --> I["staging_quality"]
  I --> J["merge-staged-lessons"]
  J --> K["world_* 正式表"]
  K --> L["normalize"]
  L --> N["generate-node-bodies"]
  N --> O["world_node_bodies"]
  O --> M["strict_qa 与 graph_integrity"]
  K --> P["Hono API"]
  O --> P
  P --> Q["React viewer"]
```

## 二、代码分层

仓库目前是 npm workspaces 结构：

| 模块 | 路径 | 职责 |
|---|---|---|
| 共享类型 | `packages/types` | 保存前后端共享的 API 类型、图谱模型、知识单元结构、流水线请求和响应结构 |
| 抽取流水线 | `packages/pipeline` | 负责教材解析、课时抽取、staging 写入、归并、规范化、质量检查、正文生成 |
| 服务端 | `packages/server` | Hono API 服务，读取 PostgreSQL，提供 viewer 所需接口，也可以启动 pipeline |
| 前端 | `packages/viewer` | React/Vite 图谱浏览器，展示图谱、知识单元、教材树、流水线状态和图片复核 |
| 标准与数据库 schema | `schemas` | 世界知识标准、JSON Schema、PostgreSQL 建表文件 |
| 文档 | `docs` | 运行记录、系统说明、知识点契约、提示词清单和架构说明 |

顶层命令：

| 命令 | 作用 |
|---|---|
| `npm run dev` | 构建 viewer 并启动一个本地服务，统一从 `http://127.0.0.1:8765/viewer/` 访问 |
| `npm run build` | 构建 pipeline、server、viewer |
| `npm run check` | 对所有 workspace 做 TypeScript 检查 |
| `npm test -w packages/pipeline` | 构建并运行 pipeline 测试 |

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
- 教学画像扩展：`properties.pedagogical_profile`
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

输出不是直接写入正式表，而是先规范化成 staging 行。

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
4. `strict-qa`：检查 schema 合法性。
5. `graph-integrity`：检查图结构完整性，并可标记 QA 通过。

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

### 2. 运行和中间表

| 表 | 职责 |
|---|---|
| `world_lesson_runs` | 每个 lesson/chunk 抽取任务的状态、统计和质量问题 |
| `world_staging_nodes` | 单课时候选节点 |
| `world_staging_edges` | 单课时候选关系 |
| `world_staging_domain_profiles` | 单课时候选领域画像 |
| `world_staging_mentions` | 单课时候选提及 |
| `world_staging_evidence` | 单课时候选证据 |
| `world_staging_node_cards` | 单课时候选卡片 |
| `world_merge_runs` | 归并运行记录 |
| `world_canonical_node_map` | raw node 到 canonical node 的映射和待复核项 |
| `retrieval_candidates` | 检索候选，用于抽取上下文补充 |

### 3. 数据边界

当前系统有几个明确边界：

1. `data`、`runs`、`storage`、`tmp` 是生成物或本地运行产物，不是权威源。
2. PostgreSQL 是唯一主存储。
3. lesson worker 只写 staging 表。
4. reducer 和 normalize 才能写正式知识表。
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
| `GET /api/source/:key/pipeline` | 返回流水线运行状态 |
| `POST /api/source/:key/pipeline/start` | 从前端启动 pipeline |
| `POST /api/source/:key/pipeline/infer-textbook` | 根据 book id 和 PDF 名称推断教材元信息 |
| `GET /api/source/:key/image-reviews` | 返回待复核图片证据 |
| `POST /api/source/:key/image-reviews/:evidence_id` | 写入人工图片复核结果 |
| `GET /api/source/:key/assets/:asset_path` | 提供本地教材图片等资源 |
| `GET /api/enrich/books`、`GET /api/enrich/book` | 教材工作台相关数据 |

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

然后在右侧详情面板中展示：

- 知识正文：来自 `ApiUnit.body`
- 课本原文：来自 `ApiUnit.source_fragments`
- 结构化卡片：来自 `ApiUnit.card`
- 关系：来自 `ApiUnit.relations`
- 领域画像：来自 `ApiUnit.domain_profiles`
- 证据和媒体：来自 `ApiUnit.evidence`、`ApiUnit.media`

## 九、提示词与结构化输出

当前项目有两条固定运行时提示词：

1. P1：课时知识抽取提示词。
2. P2：教材图片相关性判断提示词。

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
| `MINERU_API_KEY` | PDF 解析 |
| `VLM_API_URL` | 视觉模型接口 |
| `VLM_API_KEY` | 视觉模型密钥 |
| `VLM_MODEL` | 视觉模型名称 |

## 十一、当前关键边界

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

## 十二、当前还可以继续加强的点

这部分不是当前架构已经完成的事实，而是从现状自然推出来的改进方向：

1. 把 `ApiUnit` 当成正式公开契约继续稳定下来，避免前端和未来生成系统各自拼表。
2. 继续收紧 `semantic_core`、`pedagogical_profile` 等扩展字段的 schema。
3. 让 pipeline manifest 更好支持断点续跑和最终状态回写。
4. 补充对象级检索和生成评测，让知识单元不只可看，还能被稳定调用。
