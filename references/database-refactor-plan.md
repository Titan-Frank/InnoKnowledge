# Knowledge Database Refactor Plan

## Goal

将当前以 `data/<version>/` 下 JSON / JSONL 为主的存储方式，重构为：

- JSON / JSONL 继续保留，作为版本化快照层和审计层
- 新增一个面向查询和服务的数据库层
- 后续 MCP、Viewer、检索脚本、QA 脚本优先读取数据库层，而不是全量扫描 JSONL

本阶段只做数据库设计，不做 MCP 实现。

## Recommendation

首选数据库：`SQLite`

原因：

- 单文件数据库，便于本地开发、备份、分发、版本切换
- 读多写少的知识库场景非常适合
- 支持事务、索引、外键、`FTS5`、`JSON1`
- 后续包成 MCP 时部署成本最低
- 当前数据规模和增长预期，远没有到必须上独立图数据库的阶段

不建议当前阶段直接把主存储切到：

- `Neo4j`
  - 图遍历能力强，但运维和建模成本更高
  - 目前你的主要瓶颈是全文件读取和缺少索引，不是图遍历本身不够强
- `DuckDB`
  - 更适合分析型批处理，不适合作为长期 serving 主库
- 继续直接读 JSONL
  - 增量更新、索引检索、并发查询、MCP 封装都会越来越吃力

## Target Architecture

采用双层存储：

### 1. Snapshot Layer

保留现有文件布局：

- `data/<version>/graph/*.jsonl`
- `data/<version>/profiles/*.jsonl`
- `data/<version>/node_cards/*.json`
- `data/outlines/*.outline.json`
- `data/frameworks/*.json`

职责：

- 作为抽取和归一化结果的原始快照
- 作为可审计、可 diff、可回滚的数据源
- 作为数据库重建时的事实输入

### 2. Serving Layer

新增数据库文件，例如：

- `storage/knowledge.sqlite`

职责：

- 为 Viewer、检索脚本、未来 MCP 提供低延迟查询
- 为常见过滤条件建立索引
- 为全文检索建立 FTS
- 为版本切换提供统一入口

## Core Design Principles

### Version-Aware, Not Version-Blind

当前 `data/v2/`、`data/v3/`、`data/v4/`、`data/v4.1/` 本质上是不同运行版本的输出根。

数据库中不能把这些版本直接混成一份无来源数据，建议引入 `datasets` 表：

- 一个 `dataset` 对应一个版本根，例如 `data/v4/`
- 所有节点、边、画像、mentions、evidence、cards 都归属于一个 `dataset_id`
- 数据库可以同时装载多个版本
- 系统再用一个 `is_active` 或 `status = active` 指定当前服务版本

这样可以：

- 安全切换当前服务版本
- 对比不同版本差异
- 避免导入新版本时破坏旧版本

### Query-Optimized Hybrid Model

不是把所有数组字段都完全拆成最细粒度的关系表，也不是把所有内容都塞进 JSON。

建议采用混合方案：

- 高频过滤字段：单独列
- 高频精确匹配字段：单独索引表
- 全文检索字段：进入 FTS
- 低频、结构灵活字段：保留 JSON

这样能兼顾：

- 查询速度
- 迁移成本
- schema 演进弹性

### Append-First and Non-Destructive

数据库层必须延续项目约束：

- 版本导入默认是新增 dataset，而不是覆盖旧 dataset
- 同一 canonical node 在不同学段的 profile 允许共存
- 只有显式激活某个 dataset 时，查询默认指向该版本
- 删除旧记录必须是显式维护动作，不能作为普通归一化副作用

### Retrieval-First Extraction

数据库层不仅用于“存得快、查得快”，还要支持更稳的关系抽取架构：

- lesson / 小批次范围内抽取
- 先检索候选节点，再做关系判断
- 先产出 relation proposals，再决定是否提升为 canonical edges
- 冲突先进入 review，而不是直接覆盖旧边

## Logical Data Model

建议拆成 6 组对象：

### 1. Dataset / Source Group

- `datasets`
- `source_artifacts`

用途：

- 管理版本根
- 记录教材、框架、outline、源 PDF 等来源信息

### 2. Canonical Graph Group

- `nodes`
- `node_terms`
- `edges`

用途：

- 存放主干知识图谱
- 支持名称 / alias 精确查找
- 支持邻接查询

### 3. Curriculum Projection Group

- `profiles`
- `profile_textbooks`

用途：

- 存放同一 canonical node 在不同学科 / 学段 / 年级上的投影
- 支持按 `subject + school_stage + grade_band` 过滤
- 支持按教材回查

### 4. Provenance Group

- `mentions`
- `evidence`
- `evidence_links`

用途：

- 支持从 node / edge / profile / card 反向找到证据
- 支持从教材 source / anchor 快速回查受影响对象

### 5. Expansion Group

- `node_cards`

用途：

- 存放面向解释和教学扩展的卡片内容
- 保留结构化字段与原始 sections JSON

### 6. Candidate / Review Group

- `retrieval_candidates`
- `relation_proposals`
- `review_queue`

用途：

- 记录每个 batch 的 top-k 节点候选
- 把局部关系先存成 proposal，而不是直接进 canonical edge
- 把冲突、歧义和弱证据情况放进 review queue

## Physical Schema Recommendation

### datasets

每个版本根一条记录。

关键字段：

- `dataset_id`
- `version_key`
- `root_path`
- `schema_version`
- `status`
- `is_active`
- `created_at`
- `activated_at`
- `notes`

建议约束：

- `version_key` 唯一，例如 `v4`
- 同时只有一个 `is_active = 1`

### source_artifacts

可选但建议尽早建立。

关键字段：

- `dataset_id`
- `source_id`
- `source_type`
- `book_id`
- `title`
- `file_path`
- `outline_path`
- `properties_json`

用途：

- 管理教材和来源元信息
- 为后续从 source 快速回查提供稳定入口

### nodes

关键字段：

- `dataset_id`
- `id`
- `canonical_name`
- `node_kind`
- `node_layer`
- `node_subkind`
- `definition`
- `status`
- `card_ref`
- `deprecated_by`
- `aliases_json`
- `learning_modes_json`
- `bridge_tags_json`
- `framework_refs_json`
- `profile_refs_json`
- `same_as_refs_json`
- `properties_json`
- `created_at`
- `updated_at`
- `notes`

说明：

- 主体字段保留为结构化列
- 多值字段保留 JSON，避免第一版设计过度拆分

### node_terms

这是高价值表，建议第一版就做。

关键字段：

- `dataset_id`
- `node_id`
- `term`
- `term_norm`
- `term_type`

`term_type` 取值建议：

- `canonical`
- `alias`

用途：

- 精确搜索
- 前缀匹配
- 去重候选发现

### edges

关键字段：

- `dataset_id`
- `id`
- `edge_type`
- `edge_layer`
- `backbone_expand`
- `from_id`
- `to_id`
- `directionality`
- `confidence`
- `status`
- `framework_refs_json`
- `profile_refs_json`
- `source_refs_json`
- `properties_json`
- `created_at`
- `updated_at`

说明：

- 邻接查询主要依赖 `from_id` / `to_id` 索引
- 证据 refs 先保留 JSON，同时通过 `evidence_links` 统一做可查关系

### profiles

关键字段：

- `dataset_id`
- `id`
- `node_id`
- `subject`
- `school_stage`
- `grade_band`
- `curriculum_role`
- `mastery_level`
- `status`
- `framework_refs_json`
- `textbook_refs_json`
- `textbook_ids_json`
- `learning_objectives_json`
- `assessment_signals_json`
- `source_refs_json`
- `properties_json`
- `updated_at`

建议增加一个冗余列：

- `context_key = subject + '|' + school_stage + '|' + grade_band`

用途：

- 快速判断是否属于同一画像上下文
- 落实“同上下文保守合并，不同上下文并存”的规则

### profile_textbooks

关键字段：

- `dataset_id`
- `profile_id`
- `textbook_id`

用途：

- 高效按教材过滤 profile
- 避免在 JSON 数组上频繁扫描

### mentions

关键字段：

- `dataset_id`
- `id`
- `source_type`
- `source_id`
- `anchor_ref`
- `target_type`
- `target_id`
- `role`
- `source_refs_json`
- `confidence`
- `properties_json`

说明：

- 这是 source 到 graph object 的桥接表
- 要重点索引 `(source_id, anchor_ref)` 和 `(target_type, target_id)`

### evidence

关键字段：

- `dataset_id`
- `id`
- `source_type`
- `source_id`
- `anchor_ref`
- `source_path`
- `page_start`
- `page_end`
- `locator`
- `excerpt`
- `modality`
- `extraction_method`
- `normalized_claims_json`
- `properties_json`

说明：

- `excerpt` 是全文检索核心字段之一
- `source_id + anchor_ref + locator` 是高频回查路径

### evidence_links

建议统一建一个多态关系表，而不是分别给 edge / profile / card 建 N 张关系表。

关键字段：

- `dataset_id`
- `owner_type`
- `owner_id`
- `evidence_id`
- `ordinal`

`owner_type` 取值建议：

- `edge`
- `profile`
- `mention`
- `card`
- `card_section`

用途：

- 从任何对象统一反查证据
- 以后 MCP 接口可以固定走一套 evidence 查询逻辑

### node_cards

关键字段：

- `dataset_id`
- `node_id`
- `id`
- `card_layer`
- `title`
- `summary`
- `pattern_refs_json`
- `framework_refs_json`
- `profile_refs_json`
- `mention_refs_json`
- `source_refs_json`
- `sections_json`
- `properties_json`
- `status`
- `updated_at`

说明：

- `sections` 不建议第一版完全拆表
- 卡片结构变化频繁，先保留 `sections_json`
- 如后续需要 section 级检索，再补 `card_sections`

### retrieval_candidates

关键字段：

- `dataset_id`
- `batch_anchor`
- `query_id`
- `query_text`
- `candidate_node_id`
- `rank`
- `score`
- `retrieval_method`
- `filters_json`
- `created_at`

用途：

- 审计当前 batch 在关系判断前看到了哪些 top-k 候选
- 复盘错误复用和漏召回

### relation_proposals

关键字段：

- `dataset_id`
- `proposal_id`
- `batch_anchor`
- `source_id`
- `anchor_ref`
- `subject`
- `school_stage`
- `grade_band`
- `from_node_id`
- `to_node_id`
- `edge_type`
- `confidence`
- `evidence_refs_json`
- `status`
- `conflict_type`
- `conflict_with_edge_id`
- `properties_json`
- `created_at`
- `resolved_at`

`status` 建议取值：

- `candidate`
- `accepted`
- `review`
- `rejected`

用途：

- 先存局部关系候选
- 只有 `accepted` 的 proposal 才提升为 canonical edge

### review_queue

关键字段：

- `dataset_id`
- `review_id`
- `owner_type`
- `owner_id`
- `batch_anchor`
- `review_type`
- `status`
- `priority`
- `details_json`
- `created_at`
- `resolved_at`

用途：

- 存冲突边
- 存歧义 node reuse
- 存弱 evidence 情况
- 支持人工或后续 agent review

## Search Design

建议启用 SQLite `FTS5`，至少建 4 张全文索引表：

### node_search

索引内容：

- `canonical_name`
- `aliases`
- `definition`

### profile_search

索引内容：

- `learning_objectives`
- `assessment_signals`

### evidence_search

索引内容：

- `excerpt`
- `locator`
- `normalized_claims`

### card_search

索引内容：

- `title`
- `summary`
- `sections`

建议做法：

- 由导入脚本在导入完成后统一重建 FTS
- 不依赖复杂触发器做实时维护
- 因为当前主要是批量导入，重建 FTS 更稳定

候选检索优先顺序建议为：

1. `node_terms` 精确 / 归一化匹配
2. 结构化过滤后的 `FTS`
3. 结构化过滤后的 embedding 检索

## Index Strategy

至少建立以下索引：

### Core Lookup

- `nodes(dataset_id, id)`
- `edges(dataset_id, id)`
- `profiles(dataset_id, id)`
- `mentions(dataset_id, id)`
- `evidence(dataset_id, id)`
- `node_cards(dataset_id, node_id)`

### Canonical Graph

- `nodes(dataset_id, canonical_name)`
- `node_terms(dataset_id, term_norm)`
- `edges(dataset_id, from_id)`
- `edges(dataset_id, to_id)`
- `edges(dataset_id, edge_type)`

### Curriculum

- `profiles(dataset_id, node_id)`
- `profiles(dataset_id, subject, school_stage, grade_band)`
- `profiles(dataset_id, context_key)`
- `profile_textbooks(dataset_id, textbook_id)`

### Provenance

- `mentions(dataset_id, target_type, target_id)`
- `mentions(dataset_id, source_id, anchor_ref)`
- `evidence(dataset_id, source_id, anchor_ref)`
- `evidence_links(dataset_id, owner_type, owner_id)`
- `evidence_links(dataset_id, evidence_id)`

### Candidate / Review

- `retrieval_candidates(dataset_id, batch_anchor, query_id, rank)`
- `retrieval_candidates(dataset_id, candidate_node_id)`
- `relation_proposals(dataset_id, batch_anchor, status)`
- `relation_proposals(dataset_id, from_node_id, to_node_id, edge_type)`
- `review_queue(dataset_id, status, review_type)`

### Versioning

- `datasets(version_key)`
- `datasets(is_active)`

## Write Path

建议采用“快照导入”模式，而不是让抽取脚本直接逐条写 SQLite：

1. 抽取 / 归一化继续产出 `data/<version>/` 快照
2. 运行导入器读取该版本目录
3. 先做 schema 校验
4. 开启事务导入数据库
5. 重建该 `dataset_id` 对应的索引和 FTS
6. 跑导入后 QA
7. 如果通过，再把该 `dataset` 标记为 active

好处：

- 失败时容易回滚
- 不会污染当前 active 数据集
- 和现有工作流兼容

## Import Strategy

建议第一版只做“全量导入单个版本根”，不要一开始追求复杂增量同步。

### Phase 1

- 选择一个版本根，例如 `data/v4/`
- 清空或新建一个 `dataset_id`
- 全量导入 nodes / edges / profiles / mentions / evidence / node_cards
- 构建 `node_terms`
- 构建 FTS

### Phase 2

- 支持多版本并存
- 支持 `activate dataset`
- 支持版本对比

### Phase 3

- 如有必要，再做 lesson 级增量刷新

## Migration Plan

### Step 1

新增 SQLite schema，不改现有抽取流程。

### Step 2

编写导入器：

- 输入：`<output-root>`
- 输出：`knowledge.sqlite`

### Step 3

把现有 QA 脚本中的全量 JSONL 读取，逐步迁到数据库查询。

### Step 4

把 Viewer 的数据读取从：

- `fetchJsonl(...)`

逐步改为：

- 一个轻量后端接口
- 或未来的 MCP / local service

### Step 5

等数据库路径跑稳后，再设计 MCP 接口层。

## Query Patterns To Optimize First

数据库第一版应优先优化这些查询：

1. 通过节点 id 读取完整节点信息
2. 通过名称 / alias 搜索节点
3. 读取节点的一跳和二跳邻居
4. 读取某节点的所有 curriculum profiles
5. 读取某 profile / edge / node card 对应的 evidence
6. 按教材、学科、学段筛选节点和画像
7. 全文搜索 evidence excerpt 和 node card 内容
8. 为 lesson / batch 的概念短语召回 top-k candidate nodes
9. 检查新的 relation proposal 是否与现有 canonical edge 冲突

## Why This Fits Future MCP

虽然这一步先不做 MCP，但该设计已经在为 MCP 预留接口习惯：

- 所有对象都有稳定 id
- 所有查询都可由小粒度 SQL 组合完成
- source 到 graph object 的映射关系清楚
- 支持版本切换和 active dataset 机制
- 后续只要在数据库上封装工具函数即可

## Recommended First Deliverables

数据库重构第一阶段建议只做 3 个交付物：

1. SQLite schema
2. JSONL to SQLite 导入器
3. 导入后 QA 校验脚本

先把“存得稳、查得快、版本清晰”做出来，再接 MCP。
