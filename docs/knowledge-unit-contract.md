# 知识点与知识单元契约

更新日期：2026-07-13

本文是 `ai-nks-v0.1` 在当前工程中的知识单元公开契约。

本文固定 OKM 当前阶段对“知识点”的工程定义。这里的“知识点”不等于教材目录里的一个条目，也不等于图谱中的单个节点。它是面向前端、检索、生成和教学系统使用的完整知识单元视图。

知识节点能否进入正式图谱，应先按 `docs/node-extraction-policy.md` 判断。本文只说明通过准入后的知识对象如何被组织成消费侧知识单元。

## 一、核心定义

OKM 中的知识点定义为：

> 以 `world_nodes` 中的知识对象骨架为身份核心，聚合关系网络、教学投影、证据、结构化卡片、知识正文、媒体和原文片段后形成的可追溯知识单元视图。

这个定义把生产侧和消费侧分开：

1. 生产侧继续按教材课时抽取、暂存、合并和质检。
2. 消费侧通过 `ApiUnit` 读取完整知识点。
3. PDF 或 Markdown 教材不需要先被改造成知识单元再进入抽取流程。

## 二、术语分工

| 名称 | 定位 | 主要职责 | 不承担的职责 |
|---|---|---|---|
| `world_nodes` | 知识对象骨架 | 保存知识对象的身份、顶层类型、定义、领域、状态和最小语义信息 | 不保存完整正文、全部证据、全部教学内容 |
| `world_edges` | 关系网络 | 保存知识对象之间的事实关系、结构关系、机制关系、学习关系和表征关系 | 不保存教学画像正文，不替代证据 |
| `world_domain_profiles` | 教学投影 | 保存同一知识对象在具体领域、学段、课程角色中的教学化信息 | 不改写知识对象本体类型 |
| `world_node_cards` | 结构化可读表达 | 保存摘要和分节卡片，便于查看、生成正文和快速理解 | 不等于教材原文 |
| `world_node_bodies` | 持久化知识正文 | 保存面向阅读和生成的 Markdown 正文，并绑定来源证据 | 不冒充课本原文，不绕过证据 |
| `world_interdisciplinary_candidates` | 跨学科治理候选 | 保存可能的对象对齐或关系，以及发现理由、待选证据和复核状态 | 不是正式关系，不直接进入 `ApiUnit` |
| `ApiUnit` | 完整知识点视图 | 按 `node_id` 聚合节点、关系、教学投影、证据、正文、卡片、媒体和原文片段 | 不作为抽取中间状态直接写入 canonical 表 |

## 三、ApiUnit 公开结构

`ApiUnit` 是 `GET /api/source/:key/unit/:node_id` 的返回结构，也是当前项目对“完整知识点”的公开契约。

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

字段含义如下：

| 字段 | 含义 | 来源 |
|---|---|---|
| `node` | 知识对象骨架，包括 `id`、`name`、`kind`、`definition`、`domains`、`status` 等 | `world_nodes` |
| `relations.outgoing` | 当前节点指向其他节点的关系 | `world_edges.from_id = node_id` |
| `relations.incoming` | 其他节点指向当前节点的关系 | `world_edges.to_id = node_id` |
| `domain_profiles` | 当前知识对象的学科、学段、课程角色和教学画像；数据库列 `properties_json` 在接口中映射为每条画像的 `properties` 字段 | `world_domain_profiles` |
| `mentions` | 教材或资源中对该知识对象的提及 | `world_mentions` |
| `evidence` | 支撑该知识对象存在和解释的证据 | `world_evidence` |
| `media` | 从证据中解析出的图片等媒体资源 | `world_evidence` |
| `source_fragments` | 课本原文片段，只作为证据和上下文 | `world_evidence` |
| `card` | 结构化摘要和分节说明 | `world_node_cards` |
| `body` | 持久化知识正文；没有正文时为空，不临时展开卡片 | `world_node_bodies` |
| `completeness` | 当前知识单元完整度评分和检查项 | 服务端按 `ApiUnit` 聚合结果计算 |

`body`、`card`、`source_fragments` 的边界必须保持清楚：

1. `source_fragments` 是课本原文和图片证据。
2. `card` 是结构化摘要。
3. `body` 是知识正文，可以由人工维护、卡片展开、模型写作或外部知识单元导入生成，但必须保留 `source_refs`。

`completeness` 用来判断知识单元是否已经适合前端展示、对象级检索和后续生成系统使用。当前检查项包括定义、语义核心、关系、证据、原文片段、领域画像、正文引用、结构化卡片和来源提及。它是质量信号，不替代人工审核。

## 四、当前工程 schema 类型口径

节点顶层类型当前仍使用 `world-v1.2` 工程 schema 中的九类：

```text
entity / concept / property / process / event / method / rule / representation / resource
```

关系类型当前仍使用 `world-v1.2` 工程 schema 中的十五类：

```text
is_a / instance_of / part_of / contains / has_property / uses / produces /
depends_on / prerequisite_for / causes / affects / represents / about /
same_as / related_to
```

旧口径中的 `activity`、`principle`、`skill`、`issue` 等不再作为正式顶层类型。确实需要保留时，只能作为历史数据的显示兼容、领域子类、标签或 `properties` 中的扩展信息。

## 五、语义核心

`world_nodes` 仍保持最小主表，不把所有语义字段都摊成数据库列。更完整的语义核心先放在 `world_nodes.properties.semantic_core` 中。

建议结构：

```json
{
  "semantic_core": {
    "core_claims": ["核心命题或关键结论"],
    "formal_expressions": ["公式、符号表达或结构化表达"],
    "conditions": ["成立前提"],
    "boundaries": ["适用边界"],
    "counterexamples": ["反例"],
    "misconceptions": ["常见误解"]
  }
}
```

字段原则：

1. `definition` 保持短定义，解决“它是什么”。
2. `semantic_core.core_claims` 承载更完整的知识骨架。
3. 公式、边界、反例、常见误解不直接塞进 `definition`。
4. 每个关键声明后续都应能通过 `source_refs` 或证据链回溯。

## 六、教学画像

教学画像属于领域投影，不属于节点本体。也就是说，同一知识对象在不同学科、学段里可以有不同教学重点。

在不增加数据库列的前提下，教学画像继续放在数据库列
`world_domain_profiles.properties_json` 中；服务端返回 `ApiUnit` 时，该列映射为
`domain_profiles[].properties`。旧数据使用单份
`properties_json.pedagogical_profile`（接口为 `properties.pedagogical_profile`）；自动生成的数据使用
`properties_json.pedagogical_profiles_by_stage`（接口为
`properties.pedagogical_profiles_by_stage`），按学段分别保存，避免同一知识对象在初中和高中共用一份教学内容。

建议结构：

```json
{
  "pedagogical_profiles_by_stage": {
    "senior-secondary": {
      "school_stage": "senior-secondary",
      "grade_band": "grade-11",
      "learning_objectives": ["学习目标"],
      "difficulty_level": "intermediate",
      "diagnostic_questions": ["前置诊断问题"],
      "common_errors": ["常见错误"],
      "assessment_tasks": ["评价任务"],
      "remediation_suggestions": ["补救建议"],
      "extension_suggestions": ["拓展建议"],
      "generation": {
        "generated_from": "model_generation",
        "model": "模型名称",
        "prompt_version": "pedagogical-profile-v1",
        "generated_at": "生成时间",
        "input_fingerprint": "输入摘要",
        "review_status": "pending",
        "confidence": 0.8,
        "source_refs": ["证据编号"]
      }
    }
  }
}
```

字段原则：

1. `school_stages` 和 `curriculum_roles` 只说明教学位置。
2. `pedagogical_profiles_by_stage` 说明不同学段下怎么教、怎么诊断、怎么评价；旧的 `pedagogical_profile` 只用于兼容已有数据。
3. 价值、伦理、人文讨论等内容不要塞进 `learning_mode`，应放在教学画像或课程活动中。
4. 自动生成画像必须引用现有证据，记录模型、提示词版本、生成时间、输入摘要、可信度和审核状态。
5. 已有人工画像和已确认画像不得被自动重跑覆盖；输入没有变化时不重复调用模型。

## 七、跨学科候选与 ApiUnit 的边界

跨学科扫描结果不属于 `ApiUnit.relations`。`world_interdisciplinary_candidates` 是正式图谱外的治理记录：

1. `node_alignment` 只有经批准并完成节点归一后，结果才通过规范节点身份反映到 `ApiUnit`。
2. `relation` 只有经人工选择教材证据、关系类型和方向，并由受事务保护的应用步骤写入 `world_edges` 后，才进入 `ApiUnit.relations`。
3. 正式跨学科关系的 `properties.interdisciplinary` 保留候选、扫描和复核来源，`evidence_refs` 保留批准时选择的证据编号。
4. 共享标签、领域对和候选分数不会出现在正式关系中冒充证据。

完整治理契约见 `docs/interdisciplinary-knowledge-network.md`。

## 八、当前工程落点

当前前端图上显示的是节点；点开节点后，右侧详情面板通过 `ApiUnit` 展示完整知识点。

显示路径：

1. 图谱标签来自 `world_nodes.name`。
2. 详情标题来自节点名称、类型和连接数。
3. “知识正文”来自 `ApiUnit.body`。
4. “课本原文”来自 `ApiUnit.source_fragments`。
5. “结构化卡片”来自 `ApiUnit.card`。
6. “关系”来自 `ApiUnit.relations`。
7. “领域画像”来自 `ApiUnit.domain_profiles`。
8. “完整度”来自 `ApiUnit.completeness`。

后续新增检索、生成、智能辅导能力时，应优先读取 `ApiUnit`，不要直接拼多张表形成另一套隐含契约。
