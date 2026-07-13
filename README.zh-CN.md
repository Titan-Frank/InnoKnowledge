# Open Knowledge Map

**把教材转换成有证据、有关系、可检索、可供人工智能调用的知识对象。**

[English](README.md) · [在线体验](https://open-knowledge-map.pages.dev/) · [公开成果快照](artifacts/okm-public-v0.1.0/README.md) · [完整演示数据](examples/demo-data/README.md) · [系统架构](docs/current-system-architecture.md) · [知识单元契约](docs/knowledge-unit-contract.md) · [贡献指南](CONTRIBUTING.zh-CN.md)

![展示仓库原创太阳能界面样例的 Open Knowledge Map 图谱界面](docs/assets/report/graph-overview.png)

[线上只读查看器](https://open-knowledge-map.pages.dev/)当前使用版本化的 `knowledge/main` 成果快照：**182 个知识对象、144 条类型化关系、537 条导出证据、182 张知识卡片和 182 篇知识正文**。上面的截图特意使用较小的仓库原创太阳能样例，避免在项目首页展示第三方教材内容；其中的 9 个对象和 12 条关系既不代表公开成果规模，也不是准确率基准。

## 三层体验方式

1. **直接打开线上查看器：** 不需要 PostgreSQL 和模型密钥，立即检查当前 `main` 成果。
2. **运行本地安全样例：** 执行 `npm install && npm run demo`，在 <http://127.0.0.1:8765/viewer/> 打开独立的仓库原创图谱。
3. **处理你有权使用的材料：** 配置 PostgreSQL、MinerU 和模型服务后，运行下文的课时级 TypeScript 流水线。

## 项目解决什么问题

PDF 页面和文档切块适合短期检索，但很难直接成为教学、规划、评测和知识维护的长期接口。它们不会自动提供稳定身份、受控类型、明确关系、来源证据、人工复核状态，也不能直接形成下游软件可安全调用的知识契约。

Open Knowledge Map 把教材视为**来源证据**，而不是知识的最终计算形态。系统按课时抽取知识对象与关系，经暂存、正式归并、规范化和质量检查后写入统一知识网络，再通过完整的 `ApiUnit` 提供给搜索、带依据生成和人工检查界面。

这个仓库是一套完整的抽取与知识运行系统，不只是静态分类表或 JSON 数据集。

## 已实现能力

- TypeScript 优先的 PDF 与 MinerU 处理链路。
- 教材目录对齐和课时/切块规划。
- 基于模型的知识对象与关系抽取。
- 课时隔离暂存表和事务化正式归并器。
- 节点、关系、领域画像、提及、证据、卡片与知识正文。
- 正式数据归一化后，按学段生成带证据编号、等待审核的教学画像。
- 始终可用的文本知识对象检索，以及在查询向量和库内向量齐备时运行的向量与混合检索。
- 带证据编号归属校验的依据生成，以及证据不足时的明确结果。
- 图片相关性复核、合并复核、严格质量检查和图完整性检查。
- PostgreSQL 服务接口和 React 图谱/调试工作台。

```mermaid
flowchart LR
    A["PDF 或 MinerU Markdown"] --> B["目录与课时规划"]
    B --> C["课时工作器"]
    C --> D["world_staging_* 暂存表"]
    D --> E["归并与规范化"]
    E --> F["正式 world_* 知识库"]
    F --> G["严格质检与图完整性"]
    F --> H["ApiUnit 组装"]
    H --> I["检索与带依据生成"]
    H --> J["图谱与复核工作台"]
```

课时工作器只能写入 `world_lesson_runs` 和 `world_staging_*`。正式 `world_*` 写入、重复项处理、标识重映射和最终质量状态只能由归并与规范化步骤负责。

## 产品界面

| 来源到知识对象的可追溯链路 | 检索与带依据生成界面 |
| --- | --- |
| ![合成来源树、完整知识对象和证据关联](docs/assets/report/unit-detail.png) | ![合成知识图谱上的带依据生成查询面板](docs/assets/report/grounded-answer.png) |

### 带依据知识运行时

运行时检索完整的 `ApiUnit`，并校验生成结果中的证据编号是否属于本次检索上下文；这种编号归属检查不等于语义蕴含证明。向量路径不可用时，混合检索会保留文本结果并返回 `mode=text_only`。带依据生成需要由使用者配置模型服务；仓库自带的演示数据本身不会调用模型接口。

## 标准与契约

项目明确区分三个层次：

| 层次 | 当前名称 | 作用 |
| --- | --- | --- |
| 顶层概念标准 | `ai-nks-v0.1` | 知识对象、知识单元、知识网络、运行时和治理边界 |
| 可执行工程结构 | `world-v1.2` | 当前 PostgreSQL 表、JSON Schema、节点类型、关系类型和证据规则 |
| 公共消费契约 | `ApiUnit` | Viewer、检索和带依据生成共同使用的完整知识对象视图 |

详细说明见[理论决策记录](docs/theory-decision-record.md)、[AI-NKS v0.1](docs/ai-nks-v0.1.md)和[知识单元契约](docs/knowledge-unit-contract.md)。

## 本地一键安全样例

需要 Node.js 22+、npm、Docker 和 Docker Compose。

```bash
npm install
npm run demo
```

打开 <http://127.0.0.1:8765/viewer/>。该命令会启动 PostgreSQL、创建独立的 `okm_demo` 数据库、导入原创图谱、构建应用并启动服务。它不会修改默认的 `knowledge` 数据库，也不需要模型密钥。演示数据的准确范围和解释边界见[完整说明](examples/demo-data/README.md)。

如果只想初始化或刷新演示数据库：

```bash
npm run demo:seed
```

## 处理你有权使用的材料

先初始化正式应用数据库：

```bash
docker compose up -d postgres
export DATABASE_URL=postgresql://okm:okm@127.0.0.1:5432/knowledge
docker compose exec -T postgres psql -U okm -d knowledge < schemas/pg/knowledge_store.sql
```

配置抽取流程需要的服务：

```bash
export MINERU_API_KEY=你的_MinerU_令牌
export OPENAI_API_KEY=你的_模型_API_密钥

# 可选：教材图片相关性判断
export VLM_API_URL=http://localhost:8000/v1/chat/completions
export VLM_API_KEY=你的_视觉模型_API_密钥
export VLM_MODEL=gpt-4.1-mini

# 可选：只有明确配置后才会调用向量服务
export EMBEDDING_URL=https://你的服务地址/v1/embeddings
export EMBEDDING_API_KEY=你的_向量服务密钥
export EMBEDDING_MODEL=你的_向量模型名称
```

运行完整 TypeScript 流水线：

```bash
npm run server-pipeline-run -w packages/pipeline -- \
  --book-id physics-example \
  --pdf-path /绝对路径/book.pdf \
  --subject physics \
  --school-stage junior-secondary \
  --grade-band grade-8 \
  --skip-embeddings \
  --db "$DATABASE_URL"
```

如果 PDF 已有公网地址，可用 `--mineru-file-url` 代替 `--pdf-path`。只有在你已经配置并信任向量服务后，才应删除 `--skip-embeddings`。

正式数据归一化后，默认流程会依次生成知识正文和按学段教学画像，再进入可选的向量阶段与最终质量检查。教学画像写入 `world_domain_profiles.properties_json.pedagogical_profiles_by_stage`；自动生成内容会保留证据引用、模型与提示词版本、输入指纹、置信度和审核状态。代码会校验返回的证据编号是否属于输入上下文，但编号合法不等于内容在语义上已被证据充分证明，因此自动生成结果仍保持待审核状态。若要单独重跑教学画像阶段，可使用：

```bash
npm run generate-pedagogical-profiles -w packages/pipeline -- \
  --dataset-id main \
  --book-id physics-example \
  --school-stage junior-secondary \
  --grade-band grade-8 \
  --db "$DATABASE_URL" \
  --pretty
```

完整流程可能向外部服务传输内容：MinerU 会收到 PDF 或公开文件地址；语言模型服务会收到课时文本，并在后续正文和教学画像阶段收到规范化后的节点、卡片、关系与证据上下文；可选视觉服务会收到选定的图片上下文；明确配置的向量服务会收到知识对象文本。处理私有、受许可限制、含个人信息或机构内部材料前，必须先确认各服务的数据处理条款。上面的演示命令不会发生这些传输。

## 图片证据处理

配置视觉模型后，流程会判断教材图片是否真正承载知识内容：

- 核心图和辅助图会保留，并写入图片相关性状态。
- 装饰图或与内容不匹配的图片会从当次抽取结果中删除。
- 无法判断的图片会保留为待确认状态，只在调试页出现。
- 人工标为核心、辅助或保留后才进入普通知识单元详情；标为删除后继续隐藏。

富化内容只帮助判断术语边界、命名和节点粒度，不能作为知识对象或关系成立的正式证据。正式结果仍必须由当前课时的 Markdown、图片、表格或公式支撑。

## 验证

运行仓库完整验证：

```bash
npm run verify
```

该命令依次执行类型检查、流水线测试、服务端测试、前端测试和正式构建。数据库质量检查单独运行：

```bash
npm run strict-qa -w packages/pipeline -- \
  --dataset-id main \
  --db "$DATABASE_URL"

npm run graph-integrity -w packages/pipeline -- \
  --dataset-id main \
  --db "$DATABASE_URL"
```

## 代码结构

```text
packages/types      共享模型与接口契约
packages/pipeline   抽取、暂存、归并、规范化和质量检查
packages/server     Hono 服务、PostgreSQL 查询与知识运行时
packages/viewer     React/Vite 图谱和人工复核工作台
schemas             JSON Schema、PostgreSQL DDL 与知识标准
examples/demo-data  仓库原创的完整演示数据
examples/sample-data 旧导入夹具；公开发布前必须单独核查权利
experiments         可复现实验源码、结构约束及已审核的输入与报告
docs                理论、架构、契约、报告与运行记录
artifacts           版本化的只读公开成果层
```

PostgreSQL 是唯一正式应用存储。`data`、`runs`、`storage`、`tmp` 和本地模型产物不属于正式源代码。

## 主要命令

- `npm run server-pipeline-run -w packages/pipeline`
- `npm run extract-lesson-openai -w packages/pipeline`
- `npm run generate-node-bodies -w packages/pipeline`
- `npm run store-staging -w packages/pipeline`
- `npm run staging-quality -w packages/pipeline`
- `npm run strict-qa -w packages/pipeline`
- `npm run graph-integrity -w packages/pipeline`
- `npm run parallel-lesson-pipeline -w packages/pipeline`
- `npm run retrieve-candidates -w packages/pipeline`
- `npm run merge-staged-lessons -w packages/pipeline`
- `npm run normalize -w packages/pipeline`

## 研究状态

当前实现已经证明了受治理的知识对象抽取、证据保留、结构化知识单元、检索和引用编号归属校验可以形成完整工程闭环，但尚不能证明每条生成结论都被引用内容语义蕴含，也不能证明图谱在教学上最优或知识对象检索能够改善真实学习效果。

线上成果和本地安全样例只用于结构与界面检查，不是论文级基准。仓库已经提供试验与消融脚手架以及经过整理的结果摘要，但多学科多人裁决标签、完整独立人工复核、可重复的外部基线和学习效果评估仍未完成。

## 数据权利、许可与引用

- 加入或分发来源材料和衍生数据前，请先阅读 [PROVENANCE.md](PROVENANCE.md)。
- 当前尚未选择公开代码与数据许可。在仓库根目录加入 `LICENSE` 之前，不应默认拥有再分发或制作衍生版本的权利。
- 线上 `knowledge/main` 成果已经开放查看，但源 PDF 保留版权，当前也没有记录适用的开放许可证或明确的再分发授权；详见成果目录中的[来源清单](artifacts/okm-public-v0.1.0/SOURCES.md)与[权利边界](artifacts/okm-public-v0.1.0/RIGHTS.md)。
- 引用信息见 [CITATION.cff](CITATION.cff)。
- 安全问题报告方式见 [SECURITY.md](SECURITY.md)。

贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，但只有在项目选定根目录许可并明确外部贡献条款后，才应正式开放公开贡献。

## 当前发布边界

仓库当前提供知识对象检索、带证据编号归属校验生成的早期知识运行时，以及版本化的只读 `ApiUnit` 成果层。当前线上页面属于预览成果，还不是带 GitHub 版本标签的正式 Release。语义规划、自适应教学、学习者状态回写、成熟版本治理和大规模专家评测仍属于后续工作。
