# 表结构与 Pipeline 对齐检查报告

**检查日期**: 2026-04-02
**数据库**: storage/knowledge.sqlite
**Schemas**: schemas/v2/*.schema.json

---

## 总体结论

✅ **基本对齐，可以正常工作**

表结构与 pipeline 脚本在核心功能上完全匹配。所有必需的 INSERT 语句都包含了正确的字段，数据类型匹配，外键关系正确。

---

## 核心表对齐详情

### 1. nodes 表 ✅ 完全匹配

| Schema 字段 | DB 列名 | 状态 | 备注 |
|------------|---------|------|------|
| id | id | ✅ | 复合主键 (dataset_id, id) |
| canonical_name | canonical_name | ✅ | |
| node_kind | node_kind | ✅ | enum 约束匹配 |
| node_layer | node_layer | ✅ | backbone/support |
| node_subkind | node_subkind | ✅ | nullable |
| definition | definition | ✅ | NOT NULL |
| aliases | aliases_json | ✅ | JSON 存储数组 |
| learning_modes | learning_modes_json | ✅ | JSON 存储数组 |
| bridge_tags | bridge_tags_json | ✅ | JSON 存储数组 |
| framework_refs | framework_refs_json | ✅ | JSON 存储数组 |
| profile_refs | profile_refs_json | ✅ | JSON 存储数组 |
| card_ref | card_ref | ✅ | 链接到 node_cards |
| same_as_refs | same_as_refs_json | ✅ | JSON 存储数组 |
| properties | properties_json | ✅ | JSON 存储对象 |
| status | status | ✅ | candidate/active/merged/deprecated |
| deprecated_by | deprecated_by | ✅ | |
| created_at | created_at | ✅ | |
| updated_at | updated_at | ✅ | |
| notes | notes | ✅ | |

**INSERT 语句位置**: `scripts/extract_lesson_sqlite.py:220-251`
**UPDATE 语句位置**: `scripts/extract_lesson_sqlite.py:274-288`

---

### 2. profiles 表 ✅ 完全匹配

| Schema 字段 | DB 列名 | 状态 | 备注 |
|------------|---------|------|------|
| id | id | ✅ | |
| node_id | node_id | ✅ | FK → nodes |
| subject | subject | ✅ | |
| school_stage | school_stage | ✅ | enum 约束 |
| grade_band | grade_band | ✅ | |
| context_key | context_key | ✅ | compound key |
| curriculum_role | curriculum_role | ✅ | enum 约束 |
| mastery_level | mastery_level | ✅ | enum 约束 |
| framework_refs | framework_refs_json | ✅ | JSON 存储 |
| textbook_refs | textbook_refs_json | ✅ | JSON 存储 |
| textbook_ids | textbook_ids_json | ✅ | JSON 存储 |
| learning_objectives | learning_objectives_json | ✅ | JSON 存储 |
| assessment_signals | assessment_signals_json | ✅ | JSON 存储 |
| source_refs | source_refs_json | ✅ | JSON 存储 |
| properties | properties_json | ✅ | JSON 存储 |
| status | status | ✅ | draft/reviewed/validated |
| updated_at | updated_at | ✅ | |

**INSERT 语句位置**: `scripts/extract_lesson_sqlite.py:306-344`

---

### 3. evidence 表 ✅ 完全匹配

| Schema 字段 | DB 列名 | 状态 | 备注 |
|------------|---------|------|------|
| id | id | ✅ | |
| source_type | source_type | ✅ | enum |
| source_id | source_id | ✅ | |
| anchor_ref | anchor_ref | ✅ | |
| source_path | source_path | ✅ | nullable |
| page_start | page_start | ✅ | nullable |
| page_end | page_end | ✅ | nullable |
| excerpt | excerpt | ✅ | NOT NULL |
| locator | locator | ✅ | NOT NULL |
| modality | modality | ✅ | enum |
| extraction_method | extraction_method | ✅ | NOT NULL |
| normalized_claims | normalized_claims_json | ✅ | JSON 存储 |
| properties | properties_json | ✅ | JSON 存储 |

**INSERT 语句位置**: `scripts/extract_lesson_sqlite.py:365-387`

---

### 4. mentions 表 ✅ 完全匹配

| Schema 字段 | DB 列名 | 状态 | 备注 |
|------------|---------|------|------|
| id | id | ✅ | |
| source_type | source_type | ✅ | enum |
| source_id | source_id | ✅ | |
| anchor_ref | anchor_ref | ✅ | |
| target_type | target_type | ✅ | enum |
| target_id | target_id | ✅ | |
| role | role | ✅ | enum |
| source_refs | source_refs_json | ✅ | JSON 存储 |
| confidence | confidence | ✅ | REAL 0-1 |
| properties | properties_json | ✅ | JSON 存储 |

**INSERT 语句位置**: `scripts/extract_lesson_sqlite.py:422-440`

---

### 5. edges 表 ✅ 完全匹配（列名差异已处理）

| Schema 字段 | DB 列名 | 状态 | 备注 |
|------------|---------|------|------|
| id | id | ✅ | |
| edge_type | edge_type | ✅ | enum 约束 |
| edge_layer | edge_layer | ✅ | enum |
| backbone_expand | backbone_expand | ✅ | INTEGER (0/1) |
| from | from_id | ✅ | 避免 SQL 关键字 |
| to | to_id | ✅ | 避免 SQL 关键字 |
| directionality | directionality | ✅ | enum |
| confidence | confidence | ✅ | REAL |
| framework_refs | framework_refs_json | ✅ | JSON 存储 |
| profile_refs | profile_refs_json | ✅ | JSON 存储 |
| source_refs | source_refs_json | ✅ | JSON 存储 |
| properties | properties_json | ✅ | JSON 存储 |
| status | status | ✅ | enum |
| created_at | created_at | ✅ | |
| updated_at | updated_at | ✅ | |

**INSERT 语句位置**: `scripts/extract_lesson_sqlite.py:463-489`

---

### 6. node_cards 表 ⚠️ 轻微不匹配

| Schema 字段 | DB 列名 | 状态 | 备注 |
|------------|---------|------|------|
| id | id | ✅ | 存在但未做主键 |
| node_id | node_id | ✅ | **复合主键的一部分** |
| card_layer | card_layer | ✅ | |
| title | title | ✅ | |
| summary | summary | ✅ | |
| pattern_refs | pattern_refs_json | ✅ | |
| framework_refs | framework_refs_json | ✅ | |
| profile_refs | profile_refs_json | ✅ | |
| mention_refs | mention_refs_json | ✅ | |
| source_refs | source_refs_json | ✅ | |
| sections | sections_json | ✅ | |
| properties | properties_json | ✅ | |
| status | status | ✅ | |
| updated_at | updated_at | ✅ | |

**⚠️ 差异**: 
- **Schema**: `id` 是可选字段，理论上允许一个节点有多张卡片
- **DB**: 主键为 `(dataset_id, node_id)`，强制每个节点只能有一张卡片
- **影响**: 符合当前 AGENTS.md 的设计（每个 backbone 节点一张卡片）

**INSERT 语句位置**: `scripts/expand_node_sqlite.py:107-131`

---

## 辅助表

### 7. node_terms 表 ✅
**用途**: 存储节点名称的规范化形式以支持检索
**Pipeline**: 由 `normalize_sqlite.py` 自动维护

### 8. profile_textbooks 表 ✅
**用途**: 课程画像与教材的多对多关系
**Pipeline**: 隐式维护

### 9. evidence_links 表 ✅
**用途**: 证据与所有者（edge/profile/mention/card）的关联
**Pipeline**: `sync_output_root_to_sqlite.py:350`

### 10. retrieval_candidates 表 ✅
**用途**: 检索候选结果缓存
**Pipeline**: `scripts/retrieve_candidates.py`

### 11. relation_proposals 表 ✅
**用途**: 关系建议队列
**Pipeline**: `normalize_sqlite.py`

### 12. review_queue 表 ✅
**用途**: QA 问题队列
**Pipeline**: `strict_qa_sqlite.py`

---

## FTS5 搜索表

| 表名 | 用途 | 状态 |
|------|------|------|
| node_search | 节点全文搜索 | ✅ |
| profile_search | 画像全文搜索 | ✅ |
| evidence_search | 证据全文搜索 | ✅ |
| card_search | 卡片全文搜索 | ✅ |

**同步脚本**: `scripts/extract_lesson_sqlite.py:678-715`

---

## 数据流验证

```
Input: Markdown Lesson
    ↓
extract_lesson_sqlite.py
    ├── INSERT nodes
    ├── INSERT profiles
    ├── INSERT evidence
    ├── INSERT mentions
    └── INSERT edges
    ↓
expand_node_sqlite.py
    └── INSERT/REPLACE node_cards
    ↓
normalize_sqlite.py
    ├── UPDATE edges (deduplicate)
    ├── UPDATE profiles
    ├── INSERT node_terms
    └── INSERT relation_proposals
    ↓
strict_qa_sqlite.py
    └── INSERT review_queue (if issues found)
```

所有 INSERT/UPDATE 语句字段与表结构 **完全匹配**。

---

## 索引覆盖

```sql
-- nodes
idx_nodes_name
idx_nodes_kind_layer

-- edges
idx_edges_from
idx_edges_to
idx_edges_type

-- profiles
idx_profiles_node
idx_profiles_context
idx_profiles_context_key

-- mentions
idx_mentions_target
idx_mentions_source_anchor

-- evidence
idx_evidence_source_anchor
idx_evidence_pages

-- FTS5
node_search (fts5)
profile_search (fts5)
evidence_search (fts5)
card_search (fts5)
```

**索引覆盖完整** ✅

---

## 外键约束

```sql
-- edges
FK: from_id → nodes(id)
FK: to_id → nodes(id)

-- profiles
FK: node_id → nodes(id)

-- profile_textbooks
FK: profile_id → profiles(id)

-- evidence_links
FK: evidence_id → evidence(id)

-- node_cards
FK: node_id → nodes(id)

-- retrieval_candidates
FK: candidate_node_id → nodes(id)

-- relation_proposals
FK: from_node_id → nodes(id)
FK: to_node_id → nodes(id)
```

**外键完整** ✅

---

## 结论

### ✅ 可以正常工作

1. **所有核心表的 INSERT/UPDATE 语句字段完全匹配**
2. **外键关系正确**
3. **索引覆盖完整**
4. **数据类型匹配**
5. **enums 和约束正确**

### ⚠️ 已知差异（不影响功能）

1. **node_cards 主键**: 实际使用 `(dataset_id, node_id)` 而非 `id`，强制一对一关系
   - 符合当前设计（每个节点一张卡片）
   - 如需支持多卡片，需修改主键为 `(dataset_id, id)`

2. **JSON 字段命名**: 数据库使用 `_json` 后缀（如 `aliases_json`），schema 使用数组类型
   - 这是 SQLite 的标准做法
   - Pipeline 脚本正确处理了 JSON 序列化/反序列化

---

## 建议

### 立即行动：无
当前结构可以正常工作。

### 可选优化：
1. 如需支持一个节点多张卡片，修改 `node_cards` 主键：
   ```sql
   -- 当前
   PRIMARY KEY (dataset_id, node_id)
   
   -- 改为
   PRIMARY KEY (dataset_id, id)
   ```

2. 考虑添加 `evidence_links` 的自动化维护触发器，避免手动同步。
