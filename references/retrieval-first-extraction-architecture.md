# Retrieval-First Relation Extraction Architecture

## Goal

随着知识库规模增大，关系抽取不能继续依赖“大上下文直接判断”。

新的默认架构应改为：

1. lesson / 小批次范围内抽取
2. 先检索候选节点
3. 再做局部关系判断
4. 先形成候选关系
5. 再做小范围归一化与跨课链接
6. 只把证据充分且无冲突的关系提升为 canonical edge
7. 把冲突或证据不足的关系放入 review / candidate 通道，而不是直接写入 canonical graph

## Why

如果知识库变大后仍然让模型直接面对整个图：

- 候选节点过多，容易误连
- 同名 / 近义项增多，容易重复建点或错连旧点
- 上下文长度拉长后，模型会忽略关键候选
- 归一化错误会放大为大范围关系污染

检索优先的架构目标是：

- 缩小模型的判断范围
- 提高 node reuse 的稳定性
- 把“边的产生”从一次性生成改成“候选 -> 审核 -> 提升”
- 强化 evidence 驱动

## Default Pipeline

### Step 1: Batch Selection

- 只处理一个 lesson 或一个紧邻的小批次
- 不直接对整本书做一次性关系抽取

### Step 2: Evidence Extraction

- 先从当前 lesson 提取 evidence
- 每条局部 claim 都应优先落到 evidence
- 若没有清晰 evidence，不进入 canonical edge 判断

### Step 3: Candidate Node Retrieval

在决定“复用旧节点 / 新建节点 / 建边”前，先为当前 lesson 中的每个候选概念检索 top-k 节点候选。

推荐检索模式：

- `local`: exact / alias / prefix / FTS，适合最保守的 replay / debug
- `global`: 从 local seed 扩一层关系邻域，补足 relation context
- `hybrid`: 默认模式，融合 local + global
- `mix`: 在 `hybrid` 基础上，再让 profile / evidence 文本命中参与排序

候选召回应优先使用：

1. `id`
2. `canonical_name`
3. `aliases`
4. `node_kind`
5. `subject`
6. `school_stage`
7. `grade_band`
8. FTS / profile / evidence text（作为补充，不作为唯一依据）

### Step 4: Candidate Filtering

关系判断前，不要把全库所有节点都交给模型。

只保留：

- 当前 lesson 明确提到的局部节点
- 检索召回的 top-k canonical candidates
- 当前 batch 已确认复用的节点

并加入硬约束：

- `node_kind` 合理
- `subject` 合理
- `school_stage` 合理
- `grade_band` 合理

不满足约束的候选不应直接进入关系判断。

### Step 5: Local Relation Extraction

先只抽本课局部关系，不直接试图完成全局最优归一化。

局部关系生成规则：

- 关系必须绑定本课 evidence
- 若 relation 是 inferred，则降低 confidence
- 没有明确 evidence 时，不得直接进入 canonical edge

本阶段的输出应首先是：

- local relation proposals
- review-needed proposals

而不是默认直接写入 canonical edges

### Step 6: Small-Scope Normalization

对每个 lesson / 小批次，在局部范围内做一次小范围归一化：

- 去掉 exact duplicate 边
- 合并同上下文的重复 profile
- 处理本批次内部重复节点候选
- 检查本批次 relation proposals 与已有 canonical graph 的冲突

### Step 7: Cross-Lesson Linking

局部关系稳定后，再做跨课链接。

跨课链接必须限制在：

- 当前 batch 新产生的局部节点 / 局部关系
- 与这些节点检索得到的少量高置信候选

不要把跨课链接变成整库两两比较。

## Canonical Edge Promotion Rules

一条关系只有满足以下条件，才可以提升为 canonical edge：

- 存在明确 evidence anchor
- relation type 合理
- endpoints 存在且上下文一致
- 不与现有 canonical edge 形成明显冲突
- confidence 达到可接受阈值

否则：

- 保留为 candidate relation
- 或标记为 review

## Conflict Policy

当新关系与现有 graph 冲突时：

- 不直接覆盖旧 canonical edge
- 不直接删除旧 canonical edge
- 先标记 review
- 保留冲突细节和 evidence

常见冲突包括：

- 同一对节点出现互斥 edge type
- 新边与既有 prerequisite / hierarchy 方向冲突
- 新边 evidence 明显弱于旧边
- 新边要求错误复用某个已有 node

## Review Queue Policy

需要 review 的对象包括：

- ambiguous node reuse
- conflicting edge proposal
- weakly supported inferred edge
- cross-stage semantic mismatch
- merge risk

review queue 至少应记录：

- owner type
- owner id
- batch anchor
- conflict type
- evidence refs
- status
- notes

## Candidate Storage Policy

候选关系建议单独存储，而不是直接写入 canonical edges：

- `status = candidate`
- `status = review`
- `status = accepted`
- `status = rejected`

只有 `accepted` 的 proposal 才进入 canonical edge。

## Retrieval Policy

候选检索优先顺序：

1. exact name / alias match
2. normalized term match
3. filtered graph-neighborhood expansion
4. filtered full-text search over node/profile/evidence text
5. filtered embedding search

embedding 是补充手段，不替代：

- evidence
- exact id reuse
- structured filtering
- node kind constraints

## QA Policy

QA 不仅检查 schema，还要检查：

- 新边是否有 evidence
- 新边是否直接绕过 candidate / review 流程
- 新边是否与现有 canonical edge 冲突
- 当前 batch 是否只在小范围候选内做判断
- 是否存在无约束跨学段误连

## Database Support Requirements

数据库层应支持：

- top-k candidate node retrieval
- 按 `subject / school_stage / grade_band / node_kind` 过滤
- relation proposal storage
- review queue storage
- canonical edge promotion
- conflict inspection

## Recommended Operational Rule

默认操作口径：

- lesson 内先局部抽取
- 候选优先
- evidence 优先
- 冲突先 review
- canonical graph 慢一点更新也没关系，但不要脏更新
