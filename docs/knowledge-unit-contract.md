# 知识对象与知识单元契约

更新日期：2026-07-13

状态：`ai-nks-v0.2` 和 `world-v1.3` 的当前公共消费契约。

本文固定 Open Knowledge Map 对“知识点”的工程定义。知识点不是教材目录条目，也不是图上的一行节点记录，而是以统一知识对象为身份核心，聚合关系、学科语义、课程教学投影和来源证据后形成的完整视图。

## 一、核心定义

> 知识单元是以 `world_nodes` 中的统一知识对象为身份核心，聚合正式关系、学科语义画像、课程与教学投影、提及、证据、媒体、原文片段、结构化卡片、知识正文和完整度信号后形成的可追溯消费视图。

生产和消费必须分离：

1. 生产侧按课时抽取、暂存、归并、身份归一和质检；
2. 消费侧通过 `ApiUnit` 读取完整知识单元；
3. PDF 或 Markdown 不需要先改造成知识单元再进入抽取流程；
4. 跨学科候选在正式应用前不进入知识单元的关系集合。

## 二、对象分工

| 名称 | 主要职责 | 不承担的职责 |
|---|---|---|
| `world_nodes` | 保存统一身份、顶层形态、短定义、适用范围和语义核心 | 不保存全部学科角色、教学内容或来源原文 |
| `world_edges` | 保存唯一正式关系网络 | 不保存候选关系，不替代证据 |
| `world_domain_profiles` | 保存对象在一个学科中的语义角色和学科特有属性 | 不保存学段、年级、课程角色或教学画像 |
| `world_curriculum_projections` | 保存对象在课程、学段和年级中的教学位置与教学画像 | 不改写对象身份和学科本体语义 |
| `world_mentions`、`world_evidence` | 保存来源提及和可核验证据 | 不自动证明结论被语义蕴含 |
| `world_node_cards` | 保存结构化摘要和分节说明 | 不等于来源原文 |
| `world_node_bodies` | 保存面向阅读和生成的知识正文 | 不冒充来源原文，不绕过证据 |
| `world_interdisciplinary_candidates` | 保存同一对象、直接关系或桥接路径候选及审核状态 | 不是正式关系，不直接进入 `ApiUnit` |
| `ApiUnit` | 为查看器、检索、生成和智能辅导聚合完整知识单元 | 不作为生产侧中间状态落库 |

## 三、公开结构

`GET /api/source/:key/unit/:node_id` 返回：

```ts
interface ApiUnit {
  node: ApiUnitNode;
  relations: {
    outgoing: ApiUnitRelation[];
    incoming: ApiUnitRelation[];
  };
  domain_profiles: ApiUnitDomainProfile[];
  curriculum_projections: ApiUnitCurriculumProjection[];
  mentions: ApiMention[];
  evidence: ApiEvidence[];
  media: ApiUnitMedia[];
  source_fragments: ApiUnitSourceFragment[];
  card: ApiNodeCard | null;
  body: ApiUnitBody | null;
  completeness: ApiUnitCompleteness;
}
```

字段来源：

| 字段 | 含义 | 来源 |
|---|---|---|
| `node` | 统一知识对象骨架和语义核心 | `world_nodes` |
| `relations` | 未弃用的正式入边和出边，附中文关系名称 | `world_edges` |
| `domain_profiles` | 学科、领域模式、模式版本、学科角色和学科属性 | `world_domain_profiles` |
| `curriculum_projections` | 课程体系、学段、年级、课程角色和教学画像 | `world_curriculum_projections` |
| `mentions` | 来源中对该对象的提及 | `world_mentions` |
| `evidence` | 支撑对象、关系、画像、投影、卡片或正文的证据 | `world_evidence` |
| `media` | 从证据解析出的图片等媒体 | `world_evidence` |
| `source_fragments` | 来源原文或多模态片段 | `world_evidence` |
| `card` | 结构化摘要和分节说明 | `world_node_cards` |
| `body` | 持久化知识正文 | `world_node_bodies` |
| `completeness` | 当前知识单元完整度和逐项质量信号 | 服务端聚合计算 |

## 四、统一知识对象

顶层形态保持九类：

```text
实体、概念、属性、过程、事件、方法、规则、表征、资源
```

对应的内部代码为 `entity`、`concept`、`property`、`process`、`event`、`method`、`rule`、`representation`、`resource`。代码只用于机器契约。

`world_nodes.properties_json.semantic_core` 承载更完整的稳定语义：

```json
{
  "semantic_core": {
    "core_claims": ["核心命题或关键结论"],
    "formal_expressions": ["公式、符号或结构化表达"],
    "conditions": ["成立前提"],
    "boundaries": ["适用边界"],
    "counterexamples": ["反例"],
    "misconceptions": ["常见误解"]
  }
}
```

`definition` 只回答“它是什么”。公式、条件、边界、反例和常见误解不得全部挤入短定义。

## 五、学科语义画像

`domain_profiles` 只回答“这个对象在某个学科里是什么”。每条画像包含：

- `domain`：学科；
- `schema_id` 和 `schema_version`：领域模式及版本；
- `domain_role`：定义、定理、定律、模型、算法、反应等学科角色；
- `properties`：学科特有属性；
- `source_refs`：证据编号；
- 状态、时间和说明。

不同学科使用不同角色集合。共享顶层形态不等于统一所有学科的本体分类。

## 六、课程与教学投影

`curriculum_projections` 只回答“这个对象在某个课程中怎样被安排和教学”。每条投影包含：

- `curriculum_id`：课程体系编号；
- `domain`：课程所属学科；
- `school_stage` 和 `grade_band`：学段与年级；
- `curriculum_roles`：核心、支撑、首次引入、巩固、迁移、评价等角色；
- `properties.pedagogical_profile`：该投影唯一的教学画像；
- `source_refs`、状态、时间和说明。

教学画像结构：

```json
{
  "pedagogical_profile": {
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
```

原则：

1. 一个投影只对应一个课程和学段，不在同一字段中再按学段嵌套；
2. 学科画像不保存教学画像；
3. 自动生成内容必须保留输入指纹、模型、提示词版本、置信度、审核状态和证据；
4. 人工维护或已确认内容不得被自动重跑覆盖；
5. 证据编号合法不等于内容已经通过语义蕴含验证。

## 七、正式关系

`ApiUnit.relations` 只返回已经写入 `world_edges` 且未弃用的关系。接口同时提供内部代码和中文名称，界面以中文显示。

当前中文关系为：是一种、是实例、是组成部分、包含、具有属性、使用、产生、依赖、是前置知识、导致、影响、表示、形式化表达、应用于、类似于、建模描述、主题是、相关。

完整定义和代码映射见 `docs/ai-nks-v0.2.md`。已停用的 `same_as` 不属于当前关系集，同一对象通过节点归一反映在 `ApiUnit` 中。

## 八、跨学科候选边界

三类跨学科候选都不直接属于 `ApiUnit.relations`：

1. 同一对象候选批准并应用后，通过规范节点身份反映；
2. 直接关系候选批准、选择直接证据并应用后，才进入 `world_edges`；
3. 桥接路径候选的两段都完成关系、方向和直接证据审核并应用后，才作为两条正式关系进入 `world_edges`。

正式跨学科关系在 `properties.interdisciplinary` 中保留候选、扫描和审核来源，在 `source_refs` 中保留审核时选择的证据。

## 九、正文、卡片和来源片段

三者边界固定如下：

1. `source_fragments` 是来源原文、图片、表格或公式证据；
2. `card` 是结构化摘要；
3. `body` 是知识正文，可由人工维护、卡片展开或模型生成，但必须保留证据引用。

查看器不得把知识正文标成“课本原文”，也不得在正文缺失时临时拼接另一套隐含结构冒充持久化正文。

## 十、完整度

`completeness` 当前检查：

- 短定义和语义核心；
- 正式关系；
- 来源证据和来源片段；
- 学科语义画像；
- 课程与教学投影；
- 结构化卡片；
- 知识正文及正文引用；
- 来源提及。

完整度是工程质量信号，不替代人工审核和研究评测。

## 十一、消费规则

1. 查看器、检索、带依据生成和后续智能辅导优先读取 `ApiUnit`；
2. 不直接拼接多张表形成第二套未记录契约；
3. 用户界面显示中文关系和中文学科角色，内部代码只用于机器交换；
4. 若向量路径不可用，检索必须明确回退到文本模式；
5. 生成结果只能引用当前检索上下文中的证据编号；
6. 候选、待审核画像和已弃用记录不能冒充已确认事实。
