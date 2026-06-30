# 文档状态判断

更新日期：2026-06-27

本文判断当前仓库中哪些文档代表 `ai-nks-v0.1` 顶层标准，哪些文档只是工程基线、历史记录或运行记录。

## 一、结论

当前项目不能再简单说成“V1.2 就是最新知识体系”。当前顶层标准已经收束为 `ai-nks-v0.1`。

更准确的判断是：

> `ai-nks-v0.1` 是当前顶层系统标准；`world-v1.2` 是当前代码和 PostgreSQL 正在执行的底层工程 schema。

也就是说，`world-v1.2` 仍然有效，但它只解决底层图谱结构问题：

- 节点主类。
- 关系类型。
- 领域画像。
- 证据与溯源。
- 卡片与正文的基础存储。

它不是完整的 AI-NKS 架构，也不是最终的知识对象模型。完整顶层口径以 `docs/ai-nks-v0.1.md` 为准。

## 二、当前文档优先级

如果不同文档之间出现口径不一致，建议按下面顺序判断。

### 1. 最新思想来源

这些文档代表项目最新的研究和产品方向：

| 文档 | 状态 | 用法 |
|---|---|---|
| `docs/ai-nks-v0.1.md` | 当前顶层标准 | 用来判断当前 OKM 的系统边界、Knowledge Object / Knowledge Unit / Runtime 分层和版本关系 |
| `docs/ai_nks_technical_report_v0_2.md` | 当前最新概念架构 | 用来理解 AI-NKS、Knowledge Object、Knowledge Network、Knowledge Runtime 和持续演化 |
| `docs/discussion.md` | 当前思想讨论材料 | 用来理解 K-Units、问题驱动学习、人机协同和新知识体系的教育逻辑 |
| `docs/next-step-plan-2026-06-26.md` | 当前路线图，部分内容已完成 | 用来判断下一阶段工程优先级 |

这些文档可以更新方向判断，但不等于每个字段都已经落进代码。

### 2. 当前工程契约

这些文档代表当前代码已经或正在实现的契约：

| 文档 | 状态 | 用法 |
|---|---|---|
| `docs/current-system-architecture.md` | 当前系统架构快照 | 用来理解当前代码、数据库、API、viewer 和 pipeline 如何协作 |
| `docs/knowledge-unit-contract.md` | 当前知识点与知识单元契约 | 用来定义“知识点”在消费侧到底是什么 |
| `docs/prompt-inventory.md` | 当前提示词和结构化输出说明 | 用来理解模型输入、提示词、JSON Schema 和输出结构 |

这些文档应该优先保持和代码同步。

### 3. 当前工程 schema 基线

这些文档和 schema 代表当前代码可执行的底层结构：

| 文档或文件 | 状态 | 用法 |
|---|---|---|
| `schemas/world-knowledge-standard.md` | 工程 schema 基线说明 | 用来约束当前节点、关系、领域画像和证据结构 |
| `schemas/world-knowledge-architecture.md` | 工程 schema 架构说明 | 用来解释四层结构和证据平面 |
| `schemas/*.schema.json` | 可执行结构约束 | 用于节点、关系、正文、领域画像、分类词等结构检查 |
| `schemas/pg/knowledge_store.sql` | 当前正式数据库 schema | 用于初始化 PostgreSQL |

这些文件里的 `V1.2` 不应该被理解为“最新思想版本”，而应该理解为“当前工程 schema 版本”。

### 4. 历史运行记录

这些文档只记录某次运行或某批问题，不应该被当成当前标准：

| 文档 | 状态 | 用法 |
|---|---|---|
| `docs/physics-hukj-compulsory-3-extraction-run-2026-06-26.md` | 历史运行记录 | 用来追溯那次教材抽取的结果、问题和修复建议 |

## 三、应该降级的表述

下面这些说法容易误导，后续文档中应避免：

1. “当前标准就是 V1.2。”
   - 应改为：“当前工程 schema 基线是 `world-v1.2`。”

2. “知识体系就是知识图谱。”
   - 应改为：“底层是知识图谱，中层是知识单元视图，上层是知识运行能力。”

3. “知识点就是 `world_nodes` 中的一个节点。”
   - 应改为：“节点只是身份核心；完整知识点应通过 `ApiUnit` 聚合节点、关系、证据、卡片、正文、媒体和原文片段。”

4. “`world_node_bodies` 是课本原文。”
   - 应改为：“`world_node_bodies` 是知识正文；课本原文来自 `source_fragments` 和证据。”

5. “`docs/discussion.md` 里的 K-Unit JSON 示例就是当前 API。”
   - 应改为：“它是思想草稿；当前 API 契约以 `ApiUnit` 和 `docs/knowledge-unit-contract.md` 为准。”

## 四、当前主线应该怎么表述

推荐以后统一使用下面这段表述：

> 当前 OKM 的顶层标准是 `ai-nks-v0.1`。它把系统定义为面向 AI 使用的知识基础设施：底层用 `world_nodes`、`world_edges`、`world_domain_profiles`、`world_evidence`、`world_node_cards`、`world_node_bodies` 等表保存可追溯知识图谱；中层以 Knowledge Object / Knowledge Unit 为基本消费单元，通过 `ApiUnit` 聚合节点、关系、证据、正文、卡片、媒体和原文片段；上层进一步支撑对象级检索、语义规划、AI Tutor 和知识持续演化。`world-v1.2` 是当前可执行工程 schema，不是顶层标准版本。

## 五、当前需要同步更新的地方

建议把仓库文档调整为下面的层级：

1. README 只做入口，明确顶层标准是 `ai-nks-v0.1`。
2. `docs/ai-nks-v0.1.md` 固定当前顶层系统标准。
3. `docs/documentation-status.md` 说明文档优先级和过期边界。
4. `docs/current-system-architecture.md` 说明当前代码架构，并明确 `world-v1.2` 只是工程 schema 基线。
5. `docs/knowledge-unit-contract.md` 固定当前“知识点 / 知识单元”的公开契约。
6. `docs/prompt-inventory.md` 固定当前模型调用契约。
7. `schemas/*` 保持可执行 schema 职责，不承担完整 AI-NKS 思想说明。

## 六、下一步文档治理规则

后续新增或修改文档时，建议遵守：

1. 顶层标准优先写进 `docs/ai-nks-v0.1.md` 或后续 `docs/ai-nks-*` 文档。
2. 工程路线图写进 `docs/next-step-*`。
3. 已经落地的系统结构写进 `docs/current-system-architecture.md`。
4. 对外或上层系统调用的结构写进 `docs/knowledge-unit-contract.md`。
5. 可执行字段约束才写进 `schemas`。
6. 某次运行、某本书、某次实验的结果只放运行记录，不反向改写当前标准。
