# AI-NKS v0.1

更新日期：2026-07-13

状态：当前项目顶层标准草案。

本文把 OKM 当前最新想法收束为 `ai-nks-v0.1`。它不是一次数据库迁移，也不是要立刻替换所有 `world-v1.2` 文件名。它定义的是当前项目的顶层知识系统口径：OKM 不只是教材知识图谱抽取工具，而是面向 AI 使用的知识基础设施原型。

理论边界以 `docs/theory-decision-record.md` 为准。本文承接该理论决策记录，继续说明 AI-NKS 的系统结构、工程映射和升级规则。

## 一、版本定位

`ai-nks-v0.1` 和 `world-v1.2` 的关系如下：

| 名称 | 层级 | 当前状态 | 作用 |
|---|---|---|---|
| `ai-nks-v0.1` | 顶层系统标准 | 当前最新方向 | 定义 Knowledge Object、Knowledge Unit、Knowledge Network、Knowledge Runtime 和治理演化 |
| `world-v1.2` | 底层工程 schema | 当前代码正在执行 | 定义 PostgreSQL 表、节点主类、关系类型、证据、卡片、正文和质量检查 |

所以：

1. `ai-nks-v0.1` 是当前项目的最新标准口径。
2. `world-v1.2` 是 `ai-nks-v0.1` 在当前代码中的可执行图谱基线。
3. 现阶段不直接改数据库里的 `schema_version = world-v1.2`，避免把文档定版和工程迁移混在一起。

## 二、核心定义

AI-NKS 是 AI-Native Knowledge System，即面向 AI 时代的人机协同知识基础设施。

在 OKM 当前阶段，它可以定义为：

> AI-NKS v0.1 是一个以 Knowledge Object 为底层身份、以 Knowledge Unit 为消费单元、以 Knowledge Network 组织关系、以证据和版本治理保证可信、并面向 AI Tutor、对象级检索、语义规划和教材生成运行的知识系统标准。

它要解决的问题不是“如何把教材切成更多文本块”，而是：

1. 知识对象如何被唯一识别和维护。
2. 知识如何从教材章节中解耦出来。
3. 知识对象之间的关系如何可计算。
4. 知识如何保留证据和来源。
5. AI 系统如何稳定调用知识对象，而不是只检索文本片段。
6. 教育系统如何围绕知识对象生成解释、路径、任务和评价。

## 三、总体架构

`ai-nks-v0.1` 分为五层：

```text
源资源层
  ↓
Knowledge Object 层
  ↓
Knowledge Unit 层
  ↓
Knowledge Network 层
  ↓
Knowledge Runtime 层

证据、版本、质量治理横跨全部层
```

### 1. 源资源层

源资源层保存或引用原始材料。

当前来源包括：

- PDF 教材。
- MinerU 解析后的 Markdown。
- 教材图片、表格、公式。
- Obsidian 笔记或外部知识单元，后续实现。
- 人工维护正文，后续扩展。

当前工程落点：

- `data/mineru/*`
- `world_textbook_outlines`
- `world_mineru_sources`
- `world_enrich_library` / `world_enrich_books`
- `world_evidence`
- `source_fragments`

### 2. Knowledge Object 层

Knowledge Object 是可识别、可维护、可对齐、可追溯的知识对象。

一个 Knowledge Object 至少包含：

| 维度 | 含义 | 当前工程落点 |
|---|---|---|
| 身份 | ID、名称、别名、状态 | `world_nodes` |
| 顶层类型 | 它是什么类型 | `world_nodes.kind` |
| 短定义 | 它是什么 | `world_nodes.definition` |
| 语义核心 | 核心命题、公式、条件、边界、反例、常见误解 | `world_nodes.properties.semantic_core` |
| 领域投影 | 学科、学段、课程角色 | `world_domain_profiles` |
| 教学画像 | 按学段组织的学习目标、难度、诊断题、常见错误和评价任务 | 数据库：`world_domain_profiles.properties_json.pedagogical_profiles_by_stage`；接口：`ApiUnit.domain_profiles[].properties.pedagogical_profiles_by_stage` |
| 证据 | 支撑对象存在和解释的来源 | `world_mentions`、`world_evidence` |
| 正文 | 面向阅读和生成的连续表达 | `world_node_bodies` |

当前工程里，Knowledge Object 的身份核心是 `world_nodes`，但它不能只等于 `world_nodes`。

### 3. Knowledge Unit 层

Knowledge Unit 是面向前端、检索、生成和智能辅导系统的消费单元。

当前 OKM 中，Knowledge Unit 的公开结构是 `ApiUnit`：

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

数据库中的 `world_domain_profiles.properties_json` 在服务端聚合为
`ApiUnit.domain_profiles[].properties`。因此，自动教学画像在数据库中读取
`properties_json.pedagogical_profiles_by_stage`，在接口响应中读取
`properties.pedagogical_profiles_by_stage`。旧的单份
`properties_json.pedagogical_profile` / `properties.pedagogical_profile` 仅用于兼容历史数据，新数据不再写入该字段。

也就是说，当前项目里的“知识点”应该理解为：

> 以 `world_nodes` 中的知识对象骨架为身份核心，聚合关系网络、教学投影、证据、结构化卡片、知识正文、媒体和原文片段后形成的可追溯知识单元视图。

这个定义有三个边界：

1. `world_nodes` 只是身份核心，不是完整知识点。
2. `world_node_bodies` 是知识正文，不是课本原文。
3. `source_fragments` 和 `world_evidence` 才是课本原文与证据来源。

### 4. Knowledge Network 层

Knowledge Network 负责表达知识对象之间的结构关系、学习关系和应用关系。

当前 `world-v1.2` 已经支持十五类基础关系：

```text
is_a / instance_of / part_of / contains / has_property / uses / produces /
depends_on / prerequisite_for / causes / affects / represents / about /
same_as / related_to
```

在 `ai-nks-v0.1` 中，这些关系属于最小可执行关系集。后续可以扩展更高层的运行关系，例如：

- `supports`：支持某个结论。
- `contradicts`：与某个结论冲突。
- `applies_to`：可应用于某类问题。
- `analogous_to`：跨领域类比。
- `updates`：版本更新。
- `replaces`：替代旧对象。

这些扩展不应直接塞进 `tag`。如果要进入正式系统，应先进入 schema 或关系扩展表。

当前工程还实现了受治理的跨学科发现流程。它在领域集合互不重叠的节点之间扫描两类候选：可能指向同一 Knowledge Object 的对象对齐候选，以及可能存在稳定关系的跨学科关系候选。扫描结果存入 `world_interdisciplinary_runs` 和 `world_interdisciplinary_candidates`，不直接进入 `world_edges`。共享桥接标签只是召回信号；关系候选必须由人工选择教材证据、关系类型和方向后批准，再由受事务保护的归并步骤写入正式图谱。对象对齐批准后执行身份合并，不用 `same_as` 边掩盖重复身份。

### 5. Knowledge Runtime 层

Knowledge Runtime 是 AI-NKS 和普通知识图谱最大的区别。

它回答：

> AI 系统如何在运行时调用、组合、验证和更新知识对象？

当前已经形成早期可执行子集，但尚未实现完整 Knowledge Runtime：

| 能力 | 当前状态 | 说明 |
|---|---|---|
| 对象级检索 | 已具备早期闭环 | `GET /api/source/:key/units/search` 返回完整 `ApiUnit`，支持文本、向量和混合模式；未配置向量服务时明确回退到文本模式 |
| 知识单元读取 | 已具备 | `GET /api/source/:key/unit/:node_id` 返回 `ApiUnit`，并包含完整度评分 |
| 语义规划 | 未实现 | 应输出知识单元和关系路径，而不是长篇自由推理 |
| 带依据生成 | 已具备早期闭环 | 同步与流式接口基于检索到的 `ApiUnit` 生成回答，并校验引用编号属于检索证据；该校验不证明语义蕴含 |
| AI Tutor | 未实现 | 应围绕学习目标、诊断题、常见错误和评价任务运行 |
| 治理写回 | 部分具备 | 图片、合并和跨学科候选可人工复核；学习反馈和正式对象版本治理尚未实现 |

## 四、当前工程映射

当前代码中的主要映射如下：

| AI-NKS 概念 | 当前工程实现 |
|---|---|
| Knowledge Object 身份 | `world_nodes` |
| Knowledge Object 关系 | `world_edges` |
| Knowledge Object 教学投影 | `world_domain_profiles` |
| Evidence / Provenance | `world_mentions`、`world_evidence` |
| Structured Summary | `world_node_cards` |
| Knowledge Body | `world_node_bodies` |
| Knowledge Unit API | `ApiUnit`、`GET /api/source/:key/unit/:node_id` |
| Knowledge Network 展示 | React viewer + G6 graph |
| 跨学科候选治理 | `world_interdisciplinary_runs`、`world_interdisciplinary_candidates`、跨学科工作台和受事务保护的应用步骤 |
| Pipeline | `packages/pipeline` |
| Runtime API | `packages/server` 的完整知识单元读取、对象级检索和带依据生成接口 |

## 五、生产流程原则

`ai-nks-v0.1` 不要求 PDF 先被转成 Knowledge Unit 再进入图谱。

当前正确流程仍然是：

```text
PDF / Markdown
  -> lesson/chunk 抽取
  -> world_staging_*
  -> merge / normalize
  -> world_*
  -> body / pedagogy / optional embeddings
  -> interdisciplinary candidate scan
  -> QA
  -> ApiUnit 消费视图
```

原则：

1. PDF 和 Markdown 仍走现有教材抽取管线。
2. lesson worker 只能写 `world_lesson_runs` 和 `world_staging_*`。
3. canonical `world_*` 写入、去重、重映射和最终 QA 由 reducer 和后续阶段负责。
4. Knowledge Unit 是消费侧聚合视图，不是生产侧中间状态。
5. 外部知识单元或 Obsidian 导入可以有新的导入路径，但不能绕过归并和质检。
6. 跨学科扫描只能写治理表；候选不是正式关系，必须经人工复核后由 reducer 类应用步骤修改 canonical 表。

## 六、最小字段模型

`ai-nks-v0.1` 的最小 Knowledge Object 可以抽象为：

```json
{
  "id": "node:example",
  "name": "知识对象名称",
  "kind": "concept",
  "definition": "短定义",
  "semantic_core": {
    "core_claims": [],
    "formal_expressions": [],
    "conditions": [],
    "boundaries": [],
    "counterexamples": [],
    "misconceptions": []
  },
  "relations": [],
  "domain_profiles": [
    {
      "domain": "chemistry",
      "school_stages": ["junior-secondary"],
      "curriculum_roles": ["core"],
      "properties": {
        "pedagogical_profiles_by_stage": {
          "junior-secondary": {
            "school_stage": "junior-secondary",
            "grade_band": "grade-8",
            "learning_objectives": ["能够依据证据说明该知识对象的关键特征。"],
            "difficulty_level": "basic",
            "diagnostic_questions": ["学习这一内容前需要掌握哪些概念？"],
            "common_errors": ["忽略该结论的适用条件。"],
            "assessment_tasks": ["根据给定证据完成判断并说明理由。"],
            "remediation_suggestions": ["回到定义、条件和证据逐项核对。"],
            "extension_suggestions": ["比较该知识在相邻情境中的作用。"]
          }
        }
      }
    }
  ],
  "body": {
    "format": "markdown",
    "content": "",
    "source_refs": []
  },
  "evidence": []
}
```

当前工程不会直接以这个 JSON 落库。它会被拆到多张表中，再由 `ApiUnit` 聚合回来。
其中示例里的 `domain_profiles[].properties` 对应数据库
`world_domain_profiles.properties_json`。旧的单份 `pedagogical_profile` 仍可被读取，但只作为历史兼容结构。

## 七、与普通 RAG 的区别

普通 RAG 常以文档片段为检索单位。

AI-NKS v0.1 要推进到对象级检索：

| 对比项 | 普通文本块 RAG | AI-NKS v0.1 |
|---|---|---|
| 基本单位 | 文档 chunk | Knowledge Unit |
| 边界 | 由切块策略决定 | 由知识对象身份和证据决定 |
| 关系 | 弱 | 明确关系网络 |
| 教学信息 | 通常缺失 | 有领域画像和教学画像 |
| 来源 | 片段来源 | 证据、原文片段、正文、卡片分层 |
| 生成 | 拼上下文生成 | 按知识单元和关系路径生成 |
| 治理 | 依赖文档更新 | 对象级版本、状态、证据和审核 |

## 八、当前已实现与未实现

### 已实现或已有雏形

1. TypeScript 抽取流水线。
2. `world-v1.2` PostgreSQL schema。
3. 证据约束的节点、关系、画像、卡片。
4. `world_node_bodies` 正文层。
5. `ApiUnit` 知识单元视图。
6. Viewer 知识单元详情展示。
7. 图片证据 VLM 判断和人工复核入口。
8. 完整 `ApiUnit` 的文本、向量和混合检索。
9. 基于检索知识单元的同步与流式带依据生成，以及引用编号归属校验。
10. 同一对象和跨学科关系候选扫描、证据复核、节点归一与正式关系应用闭环。
11. 跨学科领域覆盖、领域对、桥接节点和待复核项工作台。

### 仍未实现

1. 外部 Knowledge Unit / Obsidian 导入。
2. 基于关系路径的语义规划器。
3. 在带依据生成之上的完整 AI Tutor 行为与教学策略。
4. 独立于模型自报结果的语义蕴含校验。
5. 学习反馈写回。
6. Knowledge Object 版本演化关系。
7. 多学科、多人裁决的跨学科金标准和完整 AI-NKS 评测基准。

## 九、文档优先级

当前文档优先级如下：

1. `docs/theory-decision-record.md`：理论边界和术语边界。
2. `docs/ai-nks-v0.1.md`：顶层系统标准。
3. `docs/current-system-architecture.md`：当前工程架构。
4. `docs/knowledge-unit-contract.md`：当前知识单元公开契约。
5. `docs/interdisciplinary-knowledge-network.md`：跨学科候选、证据复核和归并契约。
6. `docs/prompt-inventory.md`：当前模型调用契约。
7. `schemas/*`：当前可执行工程 schema。
8. `docs/ai_nks_technical_report_v0_2.md`：有明确日期的研究背景和思想来源。

## 十、升级规则

后续如果要从 `ai-nks-v0.1` 升级，应按下面顺序做：

1. 先改文档标准，明确新增概念和边界。
2. 再改 `packages/types` 中的公开 API 类型。
3. 再改 server 查询和 viewer 展示。
4. 最后才改 PostgreSQL schema 和 pipeline 写入。
5. 每次 schema 迁移都要保留旧数据的解释路径。

不建议直接把 `world-v1.2` 改名为 `ai-nks-v0.1`，因为一个是数据库工程版本，一个是系统标准版本。两者应该关联，但不应混用。
