# 提示词清单

更新日期：2026-07-12

本文整理当前代码仓库中会在运行时发送给模型的提示词。范围只包括真实模型调用链路，不包括测试用例中的假提示词、普通界面文案、类型字段名或研究讨论文档中的概念示例。

## 一、总览

当前仓库中有五类主要模型调用提示词，以及一类在质量失败后自动追加到 P1 的重抽提示：

| 编号 | 用途 | 入口文件 | 调用模型 | 发送位置 |
|---|---|---|---|---|
| P1 | 单课时 / 单分块知识抽取 | `packages/pipeline/src/extraction/model-lesson-extraction.ts` | 文本模型 | OpenAI Responses 或 Chat Completions |
| P2 | 教材图片是否作为知识证据保留 | `packages/pipeline/src/extraction/image-relevance.ts` | 视觉模型 | OpenAI Responses 或 Chat Completions |
| P3 | 知识节点正式正文写作 | `packages/pipeline/src/unit-bodies/generate-node-bodies.ts` | 文本模型 | OpenAI Responses 或 Chat Completions |
| P4 | 按学段生成教学画像 | `packages/pipeline/src/pedagogical-profiles/generate-pedagogical-profiles.ts` | 文本模型 | OpenAI Responses 或 Chat Completions |
| P5 | 基于检索到的 `ApiUnit` 进行带依据生成 | `packages/server/src/runtime/grounded-generation.ts` | 文本模型 | OpenAI Chat Completions，同步或流式 |
| P6 | 暂存质量失败后的定向重抽提示 | `packages/pipeline/src/cli/server-pipeline-run.ts` | 文本模型 | 追加到 P1 后沿原调用链发送 |

另有一个可选补充提示词入口：

| 入口 | 来源 | 作用 |
|---|---|---|
| `--prompt` | `packages/pipeline/src/cli/extract-lesson-openai.ts`、`packages/pipeline/src/cli/parallel-batch.ts` | 追加到 P1 的基础提示词末尾，标题为“补充项目提示” |

本文后面的每条提示词都按同一方式整理：

1. 输入：代码实际传给模型的内容，包括文本、图片和动态上下文。
2. 提示词：仓库中固定维护的自然语言指令模板，以及运行时追加规则。
3. 输出：模型必须返回的 JSON 结构，以及这些字段在 pipeline 中的含义。

## 二、JSON 输出机制

需要注意：模型输出 JSON 不是只靠提示词约束出来的。

当前代码实际用了两层约束：

1. 提示词说明任务目标，例如抽取知识节点、判断图片是否保留。
2. 请求体里的 JSON Schema 约束输出结构，要求模型必须返回指定 JSON 字段。

所以完整链路是：

```text
输入数据 + 提示词 + JSON Schema 输出约束 -> 模型返回 JSON -> 代码解析 JSON -> pipeline 继续处理
```

P1 的 JSON Schema 来自 `buildResponseSchema`。下面示例省略了 Schema 内部的完整字段，只展示它在请求体里的位置。发送给 Responses API 时，请求体会带上：

```json
{
  "text": {
    "format": {
      "type": "json_schema",
      "name": "world_knowledge_lesson_bundle",
      "strict": true,
      "schema": {
        "...": "实际字段由 buildResponseSchema 生成"
      }
    }
  }
}
```

发送给 Chat Completions 时，请求体会带上：

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "world_knowledge_lesson_bundle",
      "strict": true,
      "schema": {
        "...": "实际字段由 buildResponseSchema 生成"
      }
    }
  }
}
```

P2 也是同样机制，只是使用的 Schema 是 `imageRelevanceJsonSchema`，要求输出 `keep`、`relevance`、`reason`、`confidence`。

P3 使用的 Schema 来自 `buildModelNodeBodyResponseSchema`，要求输出 `content` 和 `source_refs`。

P4 使用 `buildModelPedagogicalProfileResponseSchema`，要求返回按学段组织的教学字段、来源编号和置信度。代码校验来源编号是否属于输入白名单，但这不等于验证每条教学结论都被来源语义蕴含；自动生成结果保持待审核。

P5 使用 Chat Completions 的 JSON object 模式，要求返回 `answer`、`citations`、`unsupported_claims` 和 `used_node_ids`。服务端随后校验引用中的节点和证据编号是否属于检索上下文。`unsupported_claims` 由模型自行报告，不是独立事实核验器的输出。

因此，提示词里的“输出必须严格符合 JSON schema”只是自然语言提醒；真正让模型按 JSON 返回的是 API 请求体中的 `json_schema` 参数。

## 三、P1：课时知识抽取

来源：

- `packages/pipeline/src/extraction/model-lesson-extraction.ts`
- 函数：`buildHybridNodeEvidenceExtractionRequest`、`buildHybridEdgeExtractionRequest`

用途：

用两阶段流程抽取当前一个 `lesson/chunk`：第一阶段判断该课时是抽取到知识还是合法无知识，并抽取节点和证据；第二阶段只基于第一阶段结果判断关系。领域画像和节点卡片由后续规范化、补齐和 reducer 流程处理。

### P1 输入

P1 的用户输入不是一句自然语言问题，而是由代码把当前课时切片序列化成 JSON 后发送给模型。来源函数是 `buildModelLessonPayload`。

输入内容分两层：

1. `lesson_context`：当前课时的元信息和检索提示。
2. `markdown_lines`：当前课时切片内的 Markdown 行，是模型抽取知识对象的主要依据。

结构如下：

```json
{
  "lesson_context": {
    "book_id": "...",
    "textbook_id": "...",
    "batch_anchor": "...",
    "lesson_run_id": "...",
    "lesson_title": "...",
    "subject": "...",
    "school_stage": "...",
    "grade_band": "...",
    "page_start": 1,
    "page_end": 2,
    "source_path": "...",
    "markdown_excerpt_preview": "...",
    "retrieval_candidates": [],
    "markdown_evidence_hints": []
  },
  "markdown_lines": []
}
```

关键输入字段含义：

| 字段 | 含义 |
|---|---|
| `book_id` / `textbook_id` | 当前教材或数据集标识 |
| `batch_anchor` | 当前 lesson/chunk 的锚点 |
| `lesson_run_id` | 当前课时抽取任务的运行标识 |
| `lesson_title` | 当前课时标题 |
| `subject`、`school_stage`、`grade_band` | 学科、学段和年级范围 |
| `page_start`、`page_end` | 当前切片对应的页码范围 |
| `source_path` | Markdown 来源文件 |
| `markdown_excerpt_preview` | 当前切片预览文本 |
| `retrieval_candidates` | 外部检索或历史候选，当前可为空 |
| `markdown_evidence_hints` | 从 Markdown 中抽出的证据提示 |
| `markdown_lines` | 当前切片的完整 Markdown 行 |

发送方式：

Responses API：

```json
{
  "instructions": "{P1 提示词}",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "{lesson payload JSON}"
        }
      ]
    }
  ]
}
```

Chat Completions：

```json
{
  "messages": [
    {
      "role": "system",
      "content": "{P1 提示词}"
    },
    {
      "role": "user",
      "content": "{lesson payload JSON}"
    }
  ]
}
```

### P1 提示词

```text
第一阶段提示词由 `buildHybridNodeEvidenceExtractionRequest` 生成，任务是只从当前 lesson/chunk 中抽取证据和候选知识节点。
第二阶段提示词由 `buildHybridEdgeExtractionRequest` 生成，任务是只根据第一阶段给出的 candidate_nodes 和 evidence_units 判断关系。

硬约束：
1. 只处理当前一个 lesson/chunk。
2. 先证据后知识对象：每个节点和关系都必须能落到当前 lesson 的 evidence anchor。
3. 不要把章节编号、复习题、术语表、小结当成正式知识节点。
4. 课标是边界，教材是证据，考点是评价，目录是线索；不要把它们直接等同于知识节点。
5. 正式候选节点应具备稳定知识身份、证据锚点、关系潜力、教学用途和未来复用性。
6. 节点主类只能使用 9 类：entity/concept/property/process/event/method/rule/representation/resource。
7. tag 只是辅助检索，不承担主分类；主分类靠 kind、domain、relation。
8. 关系只允许使用 schema 合法 type，证据不足就不要编造。
9. 输出必须严格符合 JSON schema。
10. 必须显式返回 `lesson_disposition`：有合格候选知识对象时为 `extracted`；当前课时确实没有符合准入规则的知识时为 `no_knowledge`。
11. 返回 `no_knowledge` 时，必须填写 `no_knowledge_reason`，并允许节点、证据和关系为空；不要为了避免空数组而编造节点或证据。
12. 模型调用失败、JSON 解析失败和无法判断，不等于 `no_knowledge`。

主类判断：
- entity：具体对象、物质、人物、地点、设备、样本。
- concept：抽象概念、理论对象、学科核心术语。
- property：性质、属性、状态量、可观测特征。
- process：连续过程、机制、变化过程。
- event：具有时间边界的事件或历史事实。
- method：步骤、算法、实验方法、操作技能。
- rule：定律、规则、公式、原则、约束。
- representation：图、表、模型、符号、方程、示意图。
- resource：资料、文本、工具、数据集、媒介资源。

关系判断：
- is_a 用于类属关系；instance_of 用于具体实例属于某类。
- part_of/contains 用于组成和包含。
- has_property 用于对象具有属性。
- uses/produces 用于方法或过程使用、产出某对象。
- depends_on/prerequisite_for 用于依赖和先修。
- causes/affects 用于因果和影响。
- represents/about 用于表示对象和论述主题。
- same_as 只用于高度确定的同一对象；不确定时用 related_to。

学习维度判断：
- factual：事实、名称、符号、具体信息。
- conceptual：概念、分类、原理、结构关系。
- procedural：步骤、算法、实验操作、解题方法。
- metacognitive：策略选择、反思、认知监控。

语义核心：
- 节点的 definition 保持短定义，只回答“它是什么”。
- 如果当前证据支持更完整信息，放入 node.properties.semantic_core。
- semantic_core 可以包含 core_claims、formal_expressions、conditions、boundaries、counterexamples、misconceptions。
- 没有证据支撑的公式、边界、反例、常见误解不要补。

教学画像：
- 当前两阶段课时抽取不生成教学画像。
- domain_profiles 的领域、学段和课程角色先由后处理补齐。
- 学习目标、难度、诊断题、常见错误、评价任务、补救建议和拓展建议由 P4 在正式数据归一化后单独生成。
```

### P1 可选补充提示词

如果命令行传入 `--prompt`，系统会在基础提示词后追加：

```text
补充项目提示：
{用户通过 --prompt 传入的内容}
```

来源：

- `packages/pipeline/src/extraction/model-lesson-extraction.ts`
- `packages/pipeline/src/cli/extract-lesson-openai.ts`
- `packages/pipeline/src/cli/parallel-batch.ts`

### P1 输出

P1 分两次调用模型。第一阶段 Schema 在 `buildHybridNodeEvidenceResponseSchema` 中生成，顶层必须包含：

```json
{
  "lesson_disposition": "extracted",
  "no_knowledge_reason": "",
  "nodes": [],
  "evidence_units": [],
  "issues": []
}
```

第二阶段 Schema 在 `buildHybridEdgeResponseSchema` 中生成，顶层必须包含：

```json
{
  "edges": [],
  "issues": []
}
```

字段含义：

| 字段 | 含义 | 主要约束 |
|---|---|---|
| `lesson_disposition` | 当前课时的显式抽取结论 | 只能是 `extracted` 或 `no_knowledge` |
| `no_knowledge_reason` | 合法空课时的原因 | `no_knowledge` 时必须填写；`extracted` 时为空字符串 |
| `nodes` | 候选知识节点 | `kind` 只能是 `entity/concept/property/process/event/method/rule/representation/resource`；必须有 `definition`、`domains`、`knowledge_form`、`learning_mode`、`scope` 等字段 |
| `edges` | 候选知识关系 | `type` 必须是 schema 合法关系；必须有 `from`、`to`、`directionality`、`confidence`、`evidence_anchor` |
| `evidence_units` | 当前课时内可追溯的证据单元 | 必须有 `anchor`、`excerpt`、`locator`、`modality`、`node_ids` |
| `domain_profiles` | 兼容完整响应结构的领域画像字段 | 当前两阶段流程会先设为空，后处理补齐基础画像，P4 再按学段生成教学画像 |
| `node_cards` | 面向前端展示的节点摘要卡片 | 必须绑定 `node_id` 和 `evidence_anchor`，包含 `summary`、`definition`、`essence`、`key_points`、`example`、`application`、`misconception` |
| `issues` | 模型主动报告的问题 | 例如证据不足、内容模糊、无法确定分类等 |

注意：

1. `nodes[*].definition` 是短定义，只回答“它是什么”。
2. 更完整的结构化语义信息进入 `nodes[*].properties.semantic_core`，例如核心主张、公式、适用条件、边界、反例和常见误解；它不是 `world_node_bodies` 正文。
3. `node_cards` 是结构化摘要，不等于课本原文。
4. `evidence_units` 是证据锚点，不是完整原文存储。
5. 显式的 `no_knowledge` 是合法空课时。它会保留课时运行记录，不会因为节点数为零自动视为抽取失败。

合法空课时的最小输出形态如下：

```json
{
  "lesson_disposition": "no_knowledge",
  "no_knowledge_reason": "当前切片只有目录和练习编号，没有符合准入规则的知识对象。",
  "nodes": [],
  "evidence_units": [],
  "issues": []
}
```

当第一阶段返回 `no_knowledge` 时，不需要为了得到非空结果继续编造关系；第二阶段没有候选节点可连接时应保持空关系结果。

### P1 输出后的质量治理

模型输出进入 staging 后，代码还会执行质量治理；这些规则不由提示词替代：

1. 需要人工判断但不立即阻断的警告持久化到 `world_lesson_runs.properties_json.quality_warnings`，并写入 `quality_review_required=true` 和相关的 `review_node_ids`。质量仪表盘据此计入“人工待处理”，警告不会只留在一次运行日志里。
2. 如果程序为了保留追溯链补出合成证据，该证据必须带上 `properties.synthetic=true`、`properties.quality_excluded=true`、`properties.review_status=pending`。合成证据进入待复核列表，但不计入正式证据覆盖率。
3. `lesson_disposition=no_knowledge` 和合成证据是两种不同情况：前者明确表示没有可抽取知识，后者表示已有候选对象的证据链仍需人工核验，不能相互替代。
4. lesson worker 仍只写 `world_lesson_runs` 和 `world_staging_*`。正式 `merge-staged-lessons` 与 `normalize` 使用同一个数据集级事务锁，并把读取、计划生成和正式写入放在同一事务中；失败时整体回滚，不能因模型输出已生成就留下半写入的正式数据。

### P1 示例

下面是一个简化示例，只展示输入和输出之间的关系，不代表真实教材抽取时的完整规模。

示例输入片段：

```json
{
  "lesson_context": {
    "book_id": "chem-grade8",
    "textbook_id": "chem-grade8",
    "batch_anchor": "struct:chem-grade8:lesson:solution",
    "lesson_run_id": "chem-grade8__lesson__solution",
    "lesson_title": "溶液的形成",
    "subject": "chemistry",
    "school_stage": "junior-secondary",
    "grade_band": "grade8",
    "page_start": 12,
    "page_end": 13,
    "source_path": "data/chem-grade8/lesson-solution.md",
    "markdown_excerpt_preview": "蔗糖放入水中后逐渐消失，形成均一、稳定的混合物。",
    "retrieval_candidates": [],
    "markdown_evidence_hints": [
      {
        "anchor": "ev-line-3",
        "excerpt": "蔗糖放入水中后逐渐消失，形成均一、稳定的混合物。",
        "locator": "line:3"
      }
    ]
  },
  "markdown_lines": [
    "## 溶液的形成",
    "蔗糖放入水中后逐渐消失，形成均一、稳定的混合物。",
    "这种过程叫做溶解，得到的混合物叫做溶液。"
  ]
}
```

示例输出片段：

```json
{
  "nodes": [
    {
      "id": "node:dissolution",
      "name": "溶解",
      "kind": "process",
      "subkind": null,
      "definition": "溶质分散到溶剂中形成溶液的过程。",
      "aliases": [],
      "domains": ["chemistry"],
      "knowledge_form": ["propositional"],
      "learning_mode": ["conceptual"],
      "scope": "domain-specific",
      "properties": {
        "semantic_core": {
          "core_claims": ["溶解会使溶质分散到溶剂中。"],
          "conditions": ["当前证据限定在蔗糖和水的教材示例中。"]
        }
      },
      "external_ids": {},
      "tags": ["溶液"],
      "notes": ""
    },
    {
      "id": "node:solution",
      "name": "溶液",
      "kind": "concept",
      "subkind": null,
      "definition": "由溶质和溶剂组成的均一、稳定的混合物。",
      "aliases": [],
      "domains": ["chemistry"],
      "knowledge_form": ["propositional"],
      "learning_mode": ["conceptual"],
      "scope": "domain-specific",
      "properties": {
        "semantic_core": {
          "core_claims": ["溶液具有均一、稳定的特征。"]
        }
      },
      "external_ids": {},
      "tags": ["混合物"],
      "notes": ""
    }
  ],
  "edges": [
    {
      "from": "node:dissolution",
      "to": "node:solution",
      "type": "produces",
      "directionality": "directed",
      "confidence": 0.86,
      "evidence_anchor": "ev-line-3",
      "notes": "教材句子说明溶解得到溶液。"
    }
  ],
  "evidence_units": [
    {
      "anchor": "ev-line-3",
      "excerpt": "这种过程叫做溶解，得到的混合物叫做溶液。",
      "locator": "line:3",
      "modality": "text",
      "node_ids": ["node:dissolution", "node:solution"]
    }
  ],
  "domain_profiles": [
    {
      "node_id": "node:solution",
      "domain": "chemistry",
      "school_stages": ["junior-secondary"],
      "curriculum_roles": ["core"],
      "properties": {}
    }
  ],
  "node_cards": [
    {
      "node_id": "node:solution",
      "summary": "溶液是均一、稳定的混合物。",
      "definition": "由溶质和溶剂组成的均一、稳定的混合物。",
      "essence": "关键特征是均一和稳定。",
      "key_points": ["有溶质和溶剂", "整体均一", "放置后通常保持稳定"],
      "example": "蔗糖溶于水形成蔗糖溶液。",
      "application": "判断生活中的液体混合物是否属于溶液。",
      "misconception": "不是所有混合物都是溶液。",
      "evidence_anchor": "ev-line-3"
    }
  ],
  "issues": []
}
```

## 四、P2：教材图片相关性判断

来源：

- `packages/pipeline/src/extraction/image-relevance.ts`
- 函数：`buildVlmPrompt`
- 当前版本号：`textbook-image-relevance-v4-related-context`

用途：

判断教材中的图片证据是否应该保留。该判断会影响 `world_evidence`、节点引用、卡片引用和后续 viewer 图片展示。

### P2 输入

P2 的输入由两部分组成：

1. 文本上下文：由 `buildVlmPrompt` 拼出的教材上下文和证据元数据。
2. 图片本体：图片文件被读取为 base64 data URL 后发送给视觉模型。

文本上下文字段：

| 字段 | 含义 |
|---|---|
| 标题路径 | 图片所在位置的标题层级；如果没有标题，回退到 `anchor_ref` |
| 源文件 | 图片来自哪个 Markdown 或教材解析文件 |
| 源文件行 | 图片所在源码行 |
| 前文 | 图片前面的上下文，最多约 900 字 |
| 图片行 | 图片所在行或证据摘录，最多约 500 字 |
| 后文 | 图片后面的上下文，最多约 900 字 |
| 图片说明 | `evidence.properties.caption` |
| 图片路径 | `evidence.properties.path` |
| 证据原文 | `evidence.excerpt`，最多约 500 字 |
| 位置 | `evidence.locator` |
| 尺寸 | 读取到的图片宽高；读取失败时为未知 |

发送方式：

Responses API：

```json
{
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "{P2 提示词}"
        },
        {
          "type": "input_image",
          "image_url": "data:{mime};base64,{imageBytes}"
        }
      ]
    }
  ]
}
```

Chat Completions：

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "{P2 提示词}"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:{mime};base64,{imageBytes}"
          }
        }
      ]
    }
  ]
}
```

### P2 提示词

```text
判断这张教材图片是否应该作为知识证据保留。请同时依据图片内容和图片在教材中的上下文判断。
核心规则：只要图片内容能和标题、前文、图片行、后文中的任一处形成合理对应，就保留，返回 keep=true。
保留为 core_content：图片直接表达概念、结构、实验、数据、流程、地图、模型、例题或主要结论。
保留为 supporting：图片与上下文有关，但只是辅助说明、局部截图、照片、器材、场景、过程片段、例题配图或补充材料。
不要因为图片不是最核心、信息量一般、只起辅助作用就返回 uncertain；这类情况应当返回 keep=true、relevance="supporting"。
过滤为 decorative：栏目图标、提示语、页眉页脚、二维码、标志、纯装饰图，且图片本身没有可用的学科知识内容。
过滤为 mismatch：图片本身有知识内容，但和当前标题、前后文或课时明显不相关。
只有图片看不清、上下文缺失且图片内容也无法辨认，或确实无法判断图片是否相关时，才返回 keep=true、relevance="uncertain"。
只返回 JSON：keep、relevance、reason、confidence。

教材上下文：
标题路径：{headingPath 或 anchor_ref 或 未知}
源文件：{sourcePath 或 未知}
源文件行：{sourceLine 或 未知}
前文：{图片前的上下文，最多约 900 字；无则为“无”}
图片行：{图片所在行或 evidence.excerpt，最多约 500 字；无则为“无”}
后文：{图片后的上下文，最多约 900 字；无则为“无”}

证据元数据：
图片说明：{properties.caption 或 无}
图片路径：{properties.path 或 无}
证据原文：{evidence.excerpt，最多约 500 字}
位置：{evidence.locator 或 无}
尺寸：{width}x{height} 或 未知
```

### P2 输出

P2 必须返回一个 JSON 对象。Schema 在 `imageRelevanceJsonSchema` 中生成，要求模型返回：

```json
{
  "keep": true,
  "relevance": "core_content",
  "reason": "...",
  "confidence": 0.9
}
```

`relevance` 只允许：

```text
core_content / supporting / decorative / mismatch / uncertain
```

字段含义：

| 字段 | 含义 |
|---|---|
| `keep` | 是否保留这张图片作为知识证据 |
| `relevance` | 图片和当前教材上下文的关系类别 |
| `reason` | 保留或过滤的简短理由 |
| `confidence` | 模型对判断的置信度，数字 |

`relevance` 的具体语义：

| 取值 | 含义 |
|---|---|
| `core_content` | 图片直接表达概念、结构、实验、数据、流程、地图、模型、例题或主要结论 |
| `supporting` | 图片与上下文有关，但只是辅助说明、局部截图、照片、器材、场景、过程片段、例题配图或补充材料 |
| `decorative` | 栏目图标、提示语、页眉页脚、二维码、标志、纯装饰图，且没有可用学科知识内容 |
| `mismatch` | 图片本身有知识内容，但和当前标题、前后文或课时明显不相关 |
| `uncertain` | 图片看不清、上下文缺失且图片内容也无法辨认，或确实无法判断 |

后续处理规则：

1. `keep=true` 的图片证据会保留。
2. `keep=false` 的图片证据会被过滤，并触发相关节点引用、关系引用、领域画像引用和卡片引用的清理。
3. `uncertain` 不等于过滤；提示词明确要求只有无法判断时才使用，并且通常仍是 `keep=true`。
4. `uncertain` 且未复核，或 `review_status=pending`，只在前端调试页待复核列表显示，普通知识单元详情默认隐藏。
5. 人工标为核心图、辅助图或保留后写入 `review_status=approved`，普通知识单元详情显示；人工删除后写入 `review_status=rejected`，普通知识单元详情隐藏。

### P2 示例

下面示例表示：图片本身只是实验器材照片，但它和当前课文上下文有关，所以应保留为辅助证据。

示例输入片段：

```json
{
  "text": "判断这张教材图片是否应该作为知识证据保留。...\\n教材上下文：\\n标题路径：溶液的形成 / 探究蔗糖溶解\\n源文件：data/chem-grade8/lesson-solution.md\\n源文件行：18\\n前文：将少量蔗糖加入水中，用玻璃棒搅拌。\\n图片行：![搅拌蔗糖水](images/sugar-water.png)\\n后文：观察蔗糖是否还能被看到，并记录现象。\\n\\n证据元数据：\\n图片说明：搅拌蔗糖水\\n图片路径：images/sugar-water.png\\n证据原文：搅拌蔗糖水实验图\\n位置：page:12\\n尺寸：640x420",
  "image_url": "data:image/png;base64,{imageBytes}"
}
```

示例输出：

```json
{
  "keep": true,
  "relevance": "supporting",
  "reason": "图片展示搅拌蔗糖水的实验场景，和前后文的溶解观察活动对应，但主要起辅助说明作用。",
  "confidence": 0.88
}
```

## 五、P3：知识节点正式正文写作

来源：

- `packages/pipeline/src/unit-bodies/generate-node-bodies.ts`
- 函数：`buildModelNodeBodyPrompt`
- CLI 入口：`npm run generate-node-bodies -w packages/pipeline -- --mode model ...`
- 当前提示词版本：`node-body-writer-v1`

用途：

根据一个知识节点、它的高质量结构化卡片、课本原文片段和证据引用，生成可阅读、可追溯的 Markdown 正式正文，并写入 `world_node_bodies`。生成结果的 `generated_from` 为 `model_generation`。

### P3 输入

P3 的用户输入是由代码组装后的 JSON。主要来源包括：

1. `world_nodes`：节点身份、类型、定义、领域、标签和属性。
2. `world_node_cards`：经过过滤的高质量结构化卡片。
3. `world_mentions`：节点在教材中的提及位置，用来补充证据候选。
4. `world_evidence`：课本原文片段、页码、位置和证据 ID。

输入结构如下：

```json
{
  "dataset_id": "main",
  "node": {
    "id": "concept:auto-78d8a8ec8874",
    "name": "电场强度",
    "kind": "concept",
    "subkind": null,
    "definition": "放入电场中某点的电荷所受的电场力F与其电荷量q之比，反映电场强弱和方向。",
    "aliases": [],
    "domains": ["physics"],
    "knowledge_form": ["propositional"],
    "learning_mode": ["conceptual"],
    "scope": "domain-specific",
    "tags": [],
    "properties": {}
  },
  "card": {
    "title": "电场强度",
    "summary": "电场强度是定量描述电场强弱和方向的核心物理量。",
    "markdown": "## 定义\n\n...",
    "sections": [
      {
        "id": "definition",
        "title": "定义",
        "section_type": "definition",
        "content": ["放入电场中某点的电荷所受的电场力F与其电荷量q之比。"],
        "source_refs": ["evidence:auto-64c1ee9124ae"]
      }
    ]
  },
  "evidence": [
    {
      "id": "evidence:auto-64c1ee9124ae",
      "source_id": "physics-book",
      "anchor_ref": "struct:physics:lesson:electric-field",
      "source_path": "data/mineru/physics/full.md",
      "page_start": 12,
      "page_end": 12,
      "locator": "page:12",
      "modality": "text",
      "excerpt": "课本原文片段，最多约 1400 字。",
      "normalized_claims": []
    }
  ],
  "allowed_source_refs": ["evidence:auto-64c1ee9124ae"]
}
```

关键输入字段含义：

| 字段 | 含义 |
|---|---|
| `node` | 当前知识对象身份，不是课本原文 |
| `card.markdown` | 高质量结构化卡片转换成的 Markdown 摘要 |
| `card.sections` | 卡片分节内容，自动回填占位分节不会进入正文生成 |
| `evidence` | 可引用的课本原文片段和证据元数据 |
| `allowed_source_refs` | 模型允许在 `source_refs` 中返回的证据 ID 白名单 |

发送方式：

Responses API：

```json
{
  "instructions": "{P3 提示词}",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "{node body payload JSON}"
        }
      ]
    }
  ]
}
```

Chat Completions：

```json
{
  "messages": [
    {
      "role": "system",
      "content": "{P3 提示词}"
    },
    {
      "role": "user",
      "content": "{node body payload JSON}"
    }
  ]
}
```

### P3 提示词

```text
你是 Open Knowledge Map 的知识正文写作者。
任务：根据一个知识节点、它的高质量结构化卡片、课本原文片段和证据引用，写出可阅读、可追溯的 Markdown 知识正文。

硬约束：
1. 只能使用输入里给出的节点信息、卡片内容和证据片段，不要补充没有证据支持的新事实。
2. 正文不是课本原文搬运；可以解释和组织，但不能虚构。
3. `source_refs` 只能填写输入 evidence 中出现的 id，不能创造新的证据 id。
4. 如果证据不足以支持某个小节，就省略该小节，不要硬写。
5. 如果在正文句末标注证据，直接用完整证据 ID 加方括号，例如 `[evidence:auto-64c1ee9124ae]`，不要用反引号包裹证据标记。
6. Markdown 不要使用一级标题；正文可以包含 `## 定义`、`## 核心解释`、`## 关键要点`、`## 示例或应用`、`## 易错点` 等二级标题。
7. 输出必须是 JSON，不要输出额外解释。
```

### P3 输出

P3 必须返回一个 JSON 对象。Schema 在 `buildModelNodeBodyResponseSchema` 中生成，要求模型返回：

```json
{
  "content": "## 定义\n...\n",
  "source_refs": ["evidence:auto-64c1ee9124ae"]
}
```

字段含义：

| 字段 | 含义 |
|---|---|
| `content` | Markdown 正式正文，不使用一级标题 |
| `source_refs` | 正文整体引用的证据 ID 列表，只能来自输入的 `allowed_source_refs` |

后续处理规则：

1. 代码会解析模型输出，兼容 `content`、`markdown`、`body`、`content_markdown`、`knowledge_body` 这类正文别名。
2. 代码会解析 `source_refs`，也兼容 `evidence_refs`、`sources`，但最终只保留输入证据白名单中的 ID。
3. 如果正文为空，或没有引用任何输入证据，当前节点不会写入 `world_node_bodies`，而是记录为模型生成失败。
4. 成功结果写入 `world_node_bodies`，`generated_from` 为 `model_generation`。
5. 前端会把正文里的 `[evidence:...]` 渲染成角标链接，而不是直接显示完整证据 ID。

### P3 示例

示例输出：

```json
{
  "content": "## 定义\n放入电场中某点的电荷所受的电场力 F 与其电荷量 q 之比，反映电场的强弱和方向 [evidence:auto-64c1ee9124ae]。\n\n## 核心本质\n电场强度是电场本身的空间属性，表征单位正电荷受力的能力 [evidence:auto-64c1ee9124ae]。",
  "source_refs": ["evidence:auto-64c1ee9124ae"]
}
```

注意：示例中的证据标记应保持和输入证据 ID 一致。实际前端会把 `[evidence:...]` 显示成角标编号，例如 `[1]`。

## 六、P4：按学段生成教学画像

来源：

- `packages/pipeline/src/pedagogical-profiles/generate-pedagogical-profiles.ts`
- 函数：`buildModelPedagogicalProfilePrompt`
- CLI 入口：`npm run generate-pedagogical-profiles -w packages/pipeline -- ...`
- 当前提示词版本：`pedagogical-profile-v1`

用途：

在正式节点完成归一化后，针对每个“领域画像记录＋学段”生成学习目标、难度、诊断、评价、补救和拓展内容。生成结果按学段写入 `world_domain_profiles.properties_json.pedagogical_profiles_by_stage`。

### P4 输入

P4 输入包含：

1. 当前领域、学段、年级范围和课程角色。
2. 正式知识节点及其语义核心。
3. 结构化节点卡片。
4. 当前节点的入边、出边和相关节点名称。
5. 与本次教材关联的证据片段和允许引用的证据编号。

同一领域画像包含多个学段时，系统会拆成多个独立请求，不能把初中和高中目标写入同一份画像。

### P4 提示词

```text
你是 Open Knowledge Map 的教学画像生成器。
任务：根据一个已经规范化的知识对象、指定领域和指定学段，生成可用于教学、诊断和评价的结构化画像。

硬约束：
1. 知识事实只能来自输入的节点、结构化卡片、关系和证据；不得补充无证据支持的学科事实。
2. 学习目标、问题、任务和建议可以进行教学设计，但必须围绕输入知识，不得引入新的知识结论。
3. 每个列表写 1 至 3 条，内容具体、简洁、可执行，避免空泛表述。
4. 学习目标使用可观察的行为描述；评价任务应能检验这些目标。
5. 难度必须相对于当前 school_stage 判断。
6. source_refs 只能填写 allowed_source_refs 中出现的证据编号。
7. common_errors 只描述与当前知识边界直接相关的典型错误。
8. 输出必须严格符合 JSON schema，不要输出额外解释。
```

### P4 输出

```json
{
  "learning_objectives": ["能够依据证据说明该知识对象的关键特征。"],
  "difficulty_level": "intermediate",
  "diagnostic_questions": ["学习这一内容前需要掌握哪些概念？"],
  "common_errors": ["忽略该结论的适用条件。"],
  "assessment_tasks": ["根据给定证据完成判断并说明理由。"],
  "remediation_suggestions": ["回到定义、条件和证据逐项核对。"],
  "extension_suggestions": ["比较该知识在相邻情境中的作用。"],
  "source_refs": ["evidence:auto-64c1ee9124ae"],
  "confidence": 0.82
}
```

后续处理规则：

1. 七类内容都必须至少包含一条非空文本，难度和可信度必须在合法范围内。
2. 代码会过滤不在输入白名单中的证据编号；没有合法证据编号时记为模型失败。
3. 生成信息记录模型、提示词版本、生成时间、输入摘要、审核状态和证据编号。
4. 人工画像、未知来源画像和已确认画像不会被自动覆盖。
5. 输入摘要未变化时跳过调用；输入变化时只更新尚未确认的模型画像。
6. 任一模型请求失败时，一键流水线会在向量和严格质检前阻断并报告失败位置。

## 七、P5：基于 ApiUnit 的带依据生成

来源：

- `packages/server/src/runtime/grounded-generation.ts`
- 函数：`buildModelMessages`、`generateGroundedAnswer`、`generateGroundedAnswerStream`

用途：

先检索完整 `ApiUnit`，再把节点、卡片、正文、关系、证据和来源片段压缩成有界上下文，要求模型用与问题相同的语言作答。系统提示明确要求引用上下文中已经出现的 `evidence_id`；服务端校验编号归属，并把结果分为 `grounded`、`partial` 或 `insufficient_context`。该检查不证明每个生成结论都被引用片段语义蕴含。

## 八、P6：暂存质量失败后的定向重抽

来源：

- `packages/pipeline/src/cli/server-pipeline-run.ts`
- 函数：`buildStagingQualityRetryPrompt`

用途：

只有 `staging-quality` 阻断某个课时或分块时才生成。提示中会加入重试次数、上一轮问题和当前学科上下文，允许明确返回 `no_knowledge`，并禁止为了通过检查而制造节点或关系。该文本通过 `--prompt` 追加到受影响分块的 P1 调用，不会重跑整本教材。

## 九、非运行提示词和排除项

以下内容没有作为当前运行时提示词整理进主清单：

1. `packages/pipeline/src/extraction/model-lesson-extraction.test.ts` 中的 `"只保留证据充分的节点。"` 是测试用例里的样例补充提示词。
2. `packages/types/src/patterns.ts` 中的 `prompt: string` 是类型字段，不是仓库内实际提示词内容。
3. `docs/discussion.md` 中的 `awareness_prompts` 是理论讨论示例，不参与当前 pipeline 运行。
4. embedding 调用只发送待嵌入文本，没有额外自然语言提示词。
5. MinerU 调用使用参数化请求，没有仓库内自然语言提示词。

## 十、维护规则

后续如果新增模型调用，请同步更新本文，并至少记录：

1. 入口文件和函数名。
2. 完整提示词模板。
3. 动态输入字段。
4. 使用 Responses API 还是 Chat Completions。
5. 输出结构约束。
6. 缓存版本或提示词版本号，如果有。
