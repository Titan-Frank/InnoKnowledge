# 文档状态判断

更新日期：2026-07-13

本文判断当前仓库中哪些文档代表 `ai-nks-v0.1` 顶层标准，哪些文档只是工程基线、历史记录或运行记录。

## 一、结论

当前项目不能再简单说成“V1.2 就是最新知识体系”。当前理论边界已经由 `docs/theory-decision-record.md` 冻结，当前顶层标准已经收束为 `ai-nks-v0.1`。

更准确的判断是：

> `docs/theory-decision-record.md` 用来判断理论边界；`ai-nks-v0.1` 是当前顶层系统标准；`world-v1.2` 是当前代码和 PostgreSQL 正在执行的底层工程 schema。

也就是说，`world-v1.2` 仍然有效，但它只解决底层图谱结构问题：

- 节点主类。
- 关系类型。
- 领域画像。
- 证据与溯源。
- 卡片与正文的基础存储。

它不是完整的 AI-NKS 架构，也不是最终的知识对象模型。理论边界以 `docs/theory-decision-record.md` 为准，完整顶层口径以 `docs/ai-nks-v0.1.md` 为准。

## 二、当前文档优先级

如果不同文档之间出现口径不一致，建议按下面顺序判断。

### 1. 理论边界与顶层标准

这些文档代表项目当前理论边界、系统标准和研究方向：

| 文档 | 状态 | 用法 |
|---|---|---|
| `docs/theoretical-foundation.md` | 当前理论基础 | 用来理解为什么需要构建 AI 时代的新知识体系，不涉及具体工程实现 |
| `docs/theory-decision-record.md` | 当前理论决策记录 | 用来判断 OKM 是什么、核心术语边界、学科/课标/教材/考点角色，以及当前实现和未来 Runtime 的边界 |
| `docs/node-extraction-policy.md` | 当前节点准入政策 | 用来判断什么内容有资格成为知识节点，避免把课标、目录、考点或文本切块直接当节点 |
| `docs/ai-nks-v0.1.md` | 当前顶层标准 | 用来判断当前 OKM 的系统边界、Knowledge Object / Knowledge Unit / Runtime 分层和版本关系 |

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

### 4. 当前成果与发布契约

| 文档或文件 | 状态 | 用法 |
|---|---|---|
| `artifacts/okm-public-v0.1.0/README.md` | 当前只读成果说明 | 用来运行、读取和校验当前 `knowledge/main` 公开查看快照 |
| `artifacts/okm-public-v0.1.0/manifest.json` | 当前成果机器清单 | 用来读取成果版本、数量、来源状态、筛选边界和文件入口 |
| `artifacts/okm-public-v0.1.0/SOURCES.md` | 当前来源信息清单 | 用来区分已经记录的来源身份与尚未补齐的网址、许可证和版本字段 |
| `artifacts/okm-public-v0.1.0/RIGHTS.md` | 当前公开查看边界 | 用来说明公开可访问不等于获得独立再分发许可 |
| `docs/open-source-release-checklist.md` | 当前发布门槛清单 | 用来跟踪许可证、来源审查、GitHub Release 和发布配置 |

### 5. 报告、讨论和历史计划

| 文档 | 状态 | 用法 |
|---|---|---|
| `docs/open_knowledge_map_technical_report.tex` | 当前实现技术报告草稿 | 用来描述当前仓库已经实现的系统、验证和限制；正式发布时应绑定版本标签 |
| `docs/ai_nks_technical_report_v0_2.md` | 2026 年 6 月概念架构草稿 | 用来追溯 AI-NKS 的完整研究愿景，不代表当前代码状态或当前工程路线图 |
| `docs/discussion.md` | 历史思想讨论材料 | 用来追溯 K-Units、问题驱动学习和人机协同讨论，不作为接口或结构约束 |
| `docs/next-step-plan-2026-06-26.md` | 历史路线图 | 原有阶段已部分或全部完成；以文件顶部的完成情况说明为准，不再作为当前执行计划 |

### 6. 历史运行记录

这些文档只记录某次运行或某批问题，不应该被当成当前标准：

| 文档 | 状态 | 用法 |
|---|---|---|
| `docs/physics-hukj-compulsory-3-extraction-run-2026-06-26.md` | 历史运行记录 | 用来追溯那次教材抽取的结果、问题和修复建议 |

### 7. 已删除讨论稿

下面两份讨论稿的有效内容已经被 `docs/theory-decision-record.md` 吸收，因此不再保留：

| 文档 | 处理方式 | 原因 |
|---|---|---|
| `docs/theory.md` | 已删除 | 理论论证已收束到正式理论决策记录 |
| `docs/思考一下，对于新的知识体系，一个知识点点进去后应该需要展示哪些内容？.md` | 已删除 | 详情页、节点准入和节点边界讨论已收束到正式理论决策记录和现有契约文档 |

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

> OKM 是 AI-Native Knowledge System 的工程原型。它不是普通教材图谱，不是 RAG chunk 库，也不是单纯 K-Units 教学包，也不是只给前端看的节点网络。它以 Knowledge Object 为可治理知识身份，以 Knowledge Network 组织对象关系，以 ApiUnit 提供消费侧知识单元视图，以 Evidence / Governance 保证可信，并为后续对象级检索、语义规划、Grounded AI Tutor 和学习反馈演化提供 Runtime 基础。`world-v1.2` 是当前可执行工程 schema，不是顶层标准版本。

## 五、当前需要同步更新的地方

建议把仓库文档调整为下面的层级：

1. README 只做入口，明确理论基础见 `docs/theoretical-foundation.md`，理论边界见 `docs/theory-decision-record.md`，顶层标准见 `docs/ai-nks-v0.1.md`。
2. `docs/theoretical-foundation.md` 说明为什么需要构建新知识体系。
3. `docs/theory-decision-record.md` 固定 OKM 的理论边界和术语分工。
4. `docs/node-extraction-policy.md` 固定知识节点准入政策。
5. `docs/ai-nks-v0.1.md` 固定当前顶层系统标准。
6. `docs/documentation-status.md` 说明文档优先级和过期边界。
7. `docs/current-system-architecture.md` 说明当前代码架构，并明确 `world-v1.2` 只是工程 schema 基线。
8. `docs/knowledge-unit-contract.md` 固定当前“知识点 / 知识单元”的公开契约。
9. `docs/prompt-inventory.md` 固定当前模型调用契约。
10. `schemas/*` 保持可执行 schema 职责，不承担完整 AI-NKS 思想说明。

## 六、下一步文档治理规则

后续新增或修改文档时，建议遵守：

1. 理论基础变化优先写进 `docs/theoretical-foundation.md`。
2. 理论边界变化优先写进 `docs/theory-decision-record.md`。
3. 节点准入规则变化优先写进 `docs/node-extraction-policy.md`。
4. 顶层标准变化优先写进 `docs/ai-nks-v0.1.md` 或后续 `docs/ai-nks-*` 文档。
5. 工程路线图写进 `docs/next-step-*`。
6. 已经落地的系统结构写进 `docs/current-system-architecture.md`。
7. 对外或上层系统调用的结构写进 `docs/knowledge-unit-contract.md`。
8. 可执行字段约束才写进 `schemas`。
9. 某次运行、某本书、某次实验的结果只放运行记录，不反向改写当前标准。
