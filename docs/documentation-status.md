# 文档状态判断

更新日期：2026-07-13

本文说明当前仓库各类文档的职责与优先级，避免概念标准、工程实现、接口契约和历史材料相互覆盖。

## 一、当前口径

> `docs/theory-decision-record.md` 冻结理论边界；`ai-nks-v0.1` 是当前顶层系统标准；`world-v1.2` 是当前代码和 PostgreSQL 执行的工程 schema；`ApiUnit` 是消费侧公开契约。

`world-v1.2` 负责节点主类、关系类型、领域画像、证据、卡片、正文和治理表约束，但它不是完整 AI-NKS 的版本号。

## 二、文档优先级

如果文档表述冲突，先按问题类型判断，再使用对应的当前文档：

| 问题 | 当前权威文档 |
|---|---|
| 为什么建设 AI 时代的新知识体系 | `docs/theoretical-foundation.md` |
| OKM 是什么、核心术语与研究边界 | `docs/theory-decision-record.md` |
| 顶层系统结构与演化原则 | `docs/ai-nks-v0.1.md` |
| 当前代码、数据库、流水线与前端 | `docs/current-system-architecture.md` |
| 跨学科候选、复核、证据和归并规则 | `docs/interdisciplinary-knowledge-network.md` |
| 知识节点准入 | `docs/node-extraction-policy.md` |
| `ApiUnit` 字段与消费边界 | `docs/knowledge-unit-contract.md` |
| 模型调用和结构化输出 | `docs/prompt-inventory.md` |
| 可执行字段与数据库约束 | `schemas/*` |
| 当前实现、验证与研究限制 | `docs/open_knowledge_map_technical_report.tex` |

同一问题同时涉及概念和实现时，概念边界以上层标准为准，实际已实现行为以当前架构、代码和 schema 为准；两者不一致就是需要修复的问题，不能用未来设想冒充现状。

## 三、历史材料

以下文件保留研究或运行历史，但不代表当前接口和执行路线：

| 文档 | 状态 | 用法 |
|---|---|---|
| `docs/ai_nks_technical_report_v0_2.md` | 2026 年 6 月概念架构草稿 | 追溯完整研究愿景；文件中的历史路线图不代表当前完成状态 |
| `docs/physics-hukj-compulsory-3-extraction-run-2026-06-26.md` | 单次历史运行记录 | 追溯指定教材抽取过程，不反向定义当前标准 |
| `docs/history/pipeline-typescript-migration.md` | 已完成迁移记录 | 追溯从旧实现迁移到 TypeScript 流水线的范围 |
| `artifacts/okm-public-v0.1.0/*` | 版本化只读成果 | 描述 v0.1.0 快照，不应随未发布管理功能重写 |

失效的讨论稿和已完成的旧阶段计划不再保留。有效理论内容已经收束进理论基础、理论决策记录、AI-NKS 标准和当前专项设计文档。当前工作计划应使用问题跟踪或明确标注日期和状态的新计划，不在仓库中长期维护一个已经完成但仍像操作说明的旧路线图。

## 四、必须避免的表述

1. 不写“当前标准就是 V1.2”，应写“当前工程 schema 基线是 `world-v1.2`”。
2. 不把知识体系等同于知识图谱；底层是知识网络，中层是知识单元视图，上层是知识运行能力。
3. 不把 `world_nodes` 单行记录称为完整知识点；完整消费视图是 `ApiUnit`。
4. 不把 `world_node_bodies` 称为课本原文；课本原文来自证据和 `source_fragments`。
5. 不把跨学科扫描候选称为正式关系；只有经过证据复核并应用后写入 `world_edges` 的记录才是正式关系。
6. 不把共享标签称为关系证据；标签只用于候选召回和检索。
7. 不把引用编号归属校验写成语义蕴含证明。

## 五、维护规则

1. 理论基础变化写入 `docs/theoretical-foundation.md`。
2. 术语和研究边界变化写入 `docs/theory-decision-record.md`。
3. 顶层标准变化写入 `docs/ai-nks-v0.1.md` 或后续明确版本的标准文件。
4. 已落地系统变化必须同步 `docs/current-system-architecture.md`。
5. 跨学科治理变化必须同步 `docs/interdisciplinary-knowledge-network.md`。
6. 公开消费结构变化必须同步共享类型、服务端、`docs/knowledge-unit-contract.md` 和机器可读 schema。
7. 模型调用变化必须同步 `docs/prompt-inventory.md`。
8. 可执行约束变化必须同步 `schemas`、测试和迁移说明。
9. 报告中的实现数字、能力和限制必须与代码和当前验证证据一致。
10. 单次运行和实验只写历史记录，不反向改写当前标准。
