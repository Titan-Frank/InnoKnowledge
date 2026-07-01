# 理论决策记录

更新日期：2026-06-30

状态：当前理论边界。

本文冻结 OKM 当前阶段最重要的理论边界。它不替代 `docs/ai-nks-v0.1.md` 的顶层系统标准，也不替代 `docs/current-system-architecture.md` 的工程说明；它只回答四个容易混淆的问题：OKM 到底是什么，几个核心术语分别是什么，学科、课标、教材、考点各自扮演什么角色，以及哪些能力已经实现、哪些还只是未来运行层设想。

## 一、OKM 到底是什么

OKM 是 AI-Native Knowledge System 的工程原型。

它的目标不是把教材切成更多文本块，也不是只构建一个可视化知识图谱，而是构建一套面向人类学习与 AI 调用共同使用的知识基础设施。

OKM 以 Knowledge Object 为可治理知识身份，以 Knowledge Network 组织对象关系，以 ApiUnit 提供消费侧知识单元视图，以 Evidence / Governance 保证可信，并为后续对象级检索、语义规划、Grounded AI Tutor 和学习反馈演化提供 Runtime 基础。

因此，OKM 不是：

1. 普通教材图谱。
2. RAG chunk 库。
3. 单纯 K-Units 教学包。
4. 只给前端看的节点网络。

OKM 要建设的是一种可计算、可追溯、可教学、可运行、可演化的知识基础设施。

这一判断来自当前项目的核心理论前提：当 AI 参与知识检索、解释、推理、生成和执行之后，知识体系需要从传统“学科、课程、教材、知识点”的组织方式，重构为面向人机协同认知的 Knowledge Object Network。

## 二、核心术语分别是什么

| 名称 | 定位 | 当前工程状态 |
|---|---|---|
| Knowledge Object | 可唯一识别、可证据追踪、可关系连接、可教学适配、可治理演化的知识对象。 | 顶层理论核心。 |
| `world_nodes` | Knowledge Object 的身份骨架，保存 ID、名称、kind、定义、状态和最小语义信息。 | 当前 PostgreSQL 正式表。 |
| Knowledge Unit | 面向前端、检索、生成、AI Tutor 的消费侧知识单元。 | 当前通过 `ApiUnit` 表达。 |
| `ApiUnit` | 按 `node_id` 聚合 node、relations、domain_profiles、mentions、evidence、media、source_fragments、card、body 的公开视图。 | 当前最重要的消费契约。 |
| K-Unit | 早期讨论中的学习活动或人机协作单元设想。 | 只作为思想来源，不作为当前 schema 或 API。 |
| Knowledge Realization | 同一 Knowledge Object 面向教材、AI Tutor、练习、视频、仿真等生成的表达实例。 | 后续扩展。 |
| Knowledge Runtime | AI 系统运行时检索、组合、验证、生成、反馈知识对象的机制。 | 后续实现。 |

这些术语之间必须保持下面的边界：

1. `world_nodes` 不等于完整知识点。
2. `ApiUnit` 是当前完整知识点 / 知识单元的消费视图。
3. K-Unit JSON 示例不等于当前 API。
4. Knowledge Object 不等于文本 chunk。
5. Knowledge Unit 不等于抽取中间状态。

当前 `docs/knowledge-unit-contract.md` 已经明确：知识点不是教材目录条目，也不是图谱单个节点，而是以 `world_nodes` 为身份核心，聚合关系、教学投影、证据、卡片、正文、媒体和原文片段后形成的可追溯知识单元视图。

## 三、学科、课标、教材、考点分别扮演什么角色

新知识体系不把学科、课标、教材、考点中的任何一个直接当成知识对象清单。它们分别提供不同约束。

| 来源 | 主要作用 | 不应该承担的作用 |
|---|---|---|
| 学科 | 领域归属、解释视角、学习路径条件。 | 不作为唯一知识组织方式。 |
| 课标 | 范围、目标、能力要求、学段边界。 | 不直接等于节点列表。 |
| 教材 | 证据、表达、例子、顺序、图片、表格、公式。 | 不直接决定知识对象边界。 |
| 教材目录 | 切分、导航、学习顺序线索。 | 不直接当知识节点。 |
| 考点 / 题库 | 任务、评价、权重、常见错误。 | 不决定知识是否存在。 |
| 学科本体 | 类型、上下位、归一化、关系约束。 | 不能脱离教育场景。 |
| 教师专家 | 审核、边界判断、误解确认。 | 不应手工维护全部低价值节点。 |
| 学习者数据 | 发现误解、缺口、补救路径。 | 不直接改写知识事实。 |
| AI Runtime | 检索、组合、生成、诊断、反馈。 | 不反向破坏底层 schema。 |

因此，当前节点准入原则是：

> 知识节点不应直接等于课标条目、考点、教材目录或文本块，而应该是在多种来源约束下形成的 Knowledge Object。

进一步说，知识节点不是课标条目，不是教材目录，不是考点名称，也不是文本 chunk；它应当具备稳定知识身份、证据锚点、关系潜力、教学用途和未来 Runtime 可复用性。

## 四、当前已实现什么，哪些只是未来设想

| 层级 | 当前已实现 / 有雏形 | 未来设想 |
|---|---|---|
| Source Layer | PDF、MinerU Markdown、图片、表格、公式、教材 outline。 | Obsidian、外部知识库、人工正文导入。 |
| Evidence Layer | `world_evidence`、`world_mentions`、`source_fragments`。 | 更细粒度证据链、证据冲突管理。 |
| Knowledge Object Layer | `world_nodes`、九类 kind、`semantic_core` properties。 | 版本演化、对象级影响分析。 |
| Knowledge Network Layer | `world_edges`、十五类关系。 | `supports`、`contradicts`、`applies_to`、`analogous_to`、`updates`、`replaces`。 |
| Domain / Pedagogy Layer | `world_domain_profiles`、`pedagogical_profile`。 | 课标映射、考点权重、学习者适配。 |
| Knowledge Unit Layer | `ApiUnit`、Unit API、Viewer 展示、完整度评分。 | JSON 导出、Runtime 上下文包。 |
| Runtime Layer | 搜索有雏形。 | 对象级检索、语义规划、Grounded Generation、AI Tutor。 |
| Governance Layer | staging、merge、normalize、strict-qa、graph-integrity。 | 专家审核队列、版本治理、学习反馈写回。 |

这张表的含义是：OKM 已经具备知识对象、证据、网络、知识单元视图和质量检查的工程基础；但完整 Runtime、AI Tutor、学习反馈和版本演化还没有完成，不能写成已实现能力。

## 五、当前工程约束

当前阶段不新增七类对象类型，不修改数据库结构，也不把早期 K-Unit JSON 讨论变成当前 API。

更稳的工程约束是：

1. `world_nodes.kind` 是唯一正式顶层类型。
2. `semantic_core` 表达稳定语义核心。
3. 七类教育对象只作为节点准入与评测检查清单。
4. 未来如确有需要，只增加可选 `pedagogical_role`，例如 skill、task、misconception。

当前工程继续使用 `world-v1.2` 的九类顶层主类：

```text
entity / concept / property / process / event / method / rule / representation / resource
```

这条约束的目的，是避免在理论尚未完全验证前把工程 schema 做复杂。当前优先级是先稳定理论边界、`ApiUnit` 契约、证据治理和小范围闭环，再继续推进 Runtime。

## 六、文档优先级

如果仓库文档之间出现口径不一致，按下面顺序判断：

1. `docs/theory-decision-record.md`：判断理论边界和术语边界。
2. `docs/ai-nks-v0.1.md`：判断顶层系统标准和架构方向。
3. `docs/current-system-architecture.md`：判断当前工程已经实现的结构。
4. `docs/knowledge-unit-contract.md`：判断当前知识单元公开契约。
5. `docs/prompt-inventory.md`：判断当前模型调用和结构化输出契约。
6. `schemas/*`：判断当前可执行工程 schema。
7. `docs/discussion.md`、`docs/ai_nks_technical_report_v0_2.md`：只作为研究背景和思想来源。
