# 不匹配处理与增量更新机制详解

**文档日期**: 2026-04-02

---

## 一、不匹配字段的处理

### 1.1 SQL 层不匹配（表结构 vs INSERT 语句）

#### 场景 A：INSERT 了表中不存在的列
**结果**: SQLite 立即报错，pipeline 失败

```python
# 假设表中没有 "new_field" 列
connection.execute("""
    INSERT INTO nodes (..., new_field) VALUES (..., ?)
""")
# ❌ SQL 错误: table nodes has no column named new_field
```

**影响**: 
- 当前 lesson 的提取完全失败
- 不会写入任何数据（事务回滚）
- 需要修复 schema 或脚本后重试

#### 场景 B：缺少 NOT NULL 字段
**结果**: SQLite 报错

```sql
-- canonical_name 是 NOT NULL
INSERT INTO nodes (id, node_kind, ...) 
VALUES ('test', 'concept', ...);
-- ❌ NOT NULL constraint failed: nodes.canonical_name
```

#### 场景 C：字段类型不匹配
**结果**: SQLite 会尝试隐式转换

```python
# 期望 JSON 数组的字段存储了字符串
INSERT INTO nodes (aliases_json) VALUES ("not json")
# ⚠️ 不会报错，但后续 json.loads() 会失败
```

### 1.2 Schema 层不匹配（vs JSON Schema）

**检查时机**: `strict_qa_sqlite.py`

```python
# 示例：如果 edge_type 不在允许的 enum 中
edge_type = "invalid_type"
# QA 检查:
if edge_type not in VALID_EDGE_TYPES:
    self._add_error("schema", edge_id, f"Invalid edge_type: {edge_type}")
```

**QA 发现不匹配的处理**:

| 严重程度 | 处理方式 | 是否会阻止后续处理 |
|---------|---------|------------------|
| Error | 记录错误，pipeline 停止（默认） | ✅ 是 |
| Warning | 记录警告，默认继续 | ❌ 否（可用 `--fail-on-warning` 改变） |

**关键代码** (`strict_qa_sqlite.py:759-767`):
```python
if error_count > 0:
    print(f"❌ QA FAILED: {error_count} errors")
    return 1  # 返回非零，pipeline 停止

if args.fail_on_warning and warning_count > 0:
    print(f"❌ QA FAILED: {warning_count} warnings treated as errors")
    return 1
```

### 1.3 JSON 字段内容不匹配

**存储时**（extract_lesson_sqlite.py）:
```python
json.dumps(node.get("aliases", []), ensure_ascii=False)
# 如果 aliases 不是列表，json.dumps 会报错
```

**读取时**（normalize_sqlite.py）:
```python
existing_aliases = set(json.loads(row["aliases_json"]))
# 如果存储的不是合法 JSON，这里会抛出 JSONDecodeError
```

---

## 二、节点增量更新机制

### 2.1 核心逻辑

**检查节点存在**: `extract_lesson_sqlite.py:197-208`

```python
def extract_nodes(self, nodes_data: list[dict]):
    for node in nodes_data:
        node_id = node.get("id") or make_node_id(...)
        
        # 1. 检查是否已存在
        existing = self.connection.execute(
            "SELECT 1 FROM nodes WHERE dataset_id = ? AND id = ?",
            (self.dataset_id, node_id)
        ).fetchone()
        
        if existing:
            # 2. 已存在 → 局部更新
            self._update_node(node_id, node)
        else:
            # 3. 新节点 → 完整插入
            self._insert_node(node_id, node)
```

### 2.2 更新策略对比

| 实体类型 | 已存在时的策略 | 更新的字段 | 不更新的字段 |
|---------|--------------|-----------|------------|
| **nodes** | 合并数组 | aliases, learning_modes, bridge_tags | canonical_name, definition, node_kind, node_subkind, ... |
| **profiles** | 完全替换 | ALL | 全部会被覆盖 |
| **evidence** | 完全替换 | ALL | 全部会被覆盖 |
| **mentions** | 完全替换 | ALL | 全部会被覆盖 |
| **edges** | 完全替换 | ALL | 全部会被覆盖 |
| **node_cards** | 完全替换 | ALL | 全部会被覆盖 |

### 2.3 Nodes 的特殊增量策略

**代码位置**: `extract_lesson_sqlite.py:253-289`

```python
def _update_node(self, node_id: str, node: dict) -> None:
    """更新已存在节点"""
    row = self.connection.execute(
        "SELECT aliases_json, learning_modes_json, bridge_tags_json FROM nodes ..."
    ).fetchone()
    
    if row:
        # ✅ 合并数组（并集）
        existing_aliases = set(json.loads(row["aliases_json"]))
        existing_aliases.update(node.get("aliases", []))  # 新增别名
        
        existing_modes = set(json.loads(row["learning_modes_json"]))
        existing_modes.update(node.get("learning_modes", []))
        
        existing_tags = set(json.loads(row["bridge_tags_json"]))
        existing_tags.update(node.get("bridge_tags", []))
        
        # 只更新这三个字段 + timestamp
        self.connection.execute("""
            UPDATE nodes SET
                aliases_json = ?,
                learning_modes_json = ?,
                bridge_tags_json = ?,
                updated_at = ?
            WHERE dataset_id = ? AND id = ?
        """)
```

**这意味着**:
- ✅ 别名会累积（不同课本可能用不同名称）
- ✅ 学习方式会累积
- ✅ 桥接标签会累积
- ❌ **定义 (definition) 不会改变** ⚠️ **重要！**
- ❌ 规范名称 (canonical_name) 不会改变
- ❌ node_kind/subkind 不会改变

### 2.4 其他实体的 REPLACE 策略

**Profiles** (`extract_lesson_sqlite.py:306`):
```sql
INSERT OR REPLACE INTO profiles (...)
```
- 使用主键 `(dataset_id, id)` 判断是否存在
- 如果存在：先 DELETE，再 INSERT（完全替换）
- **也就是说：同一 profile_id 会被完全覆盖**

**Evidence** (`extract_lesson_sqlite.py:365`):
```sql
INSERT OR REPLACE INTO evidence (...)
```
- 完全替换模式

**Mentions** (`extract_lesson_sqlite.py:422`):
```sql
INSERT OR REPLACE INTO mentions (...)
```
- 完全替换模式

**Edges** (`extract_lesson_sqlite.py:463`):
```sql
INSERT OR REPLACE INTO edges (...)
```
- 完全替换模式

### 2.5 Node Cards 的插入策略

**位置**: `expand_node_sqlite.py:107`

```python
self.connection.execute("""
    INSERT OR REPLACE INTO node_cards (
        dataset_id, node_id, id, card_layer, title, summary, ...
    ) VALUES (...)
""")
```

**说明**:
- 主键是 `(dataset_id, node_id)`，不是 `id`
- 所以一个节点只能有一张卡片
- 扩展已存在节点的卡片会**完全替换**旧卡片

---

## 三、实际影响分析

### 场景 1：同一课本重新提取

```
第1次提取：Lesson 1-1-1
  - 创建节点 A (definition="定义1")
  
第2次提取：再次提取 Lesson 1-1-1
  - 发现节点 A 已存在
  - _update_node 只合并 aliases
  - definition 保持 "定义1" 不变 ❌
```

**问题**: 如果第2次提取的 definition 更精确，它不会被更新。

### 场景 2：不同课本同一概念

```
课本 A 提取：Lesson 1-1-1
  - 创建节点 "化学变化" (aliases=["化学反应"])
  
课本 B 提取：Lesson 3-2
  - 发现节点 "化学变化" 已存在
  - 合并 aliases: ["化学反应", "化学转变"] ✅
  - definition 保持课本A的版本 ❌
```

**结果**: 别名累积（好），但定义保留最先的版本（可能不理想）。

### 场景 3：修正错误定义

```
第1次提取：
  - 创建节点 X (definition="错误的定义")
  
手动修正：
  - 用户发现错误，想修正
  
第2次提取（修正后）：
  - 节点 X 已存在
  - _update_node 不更新 definition
  - 错误定义仍然存在 ❌
```

**解决方案**:
1. 手动 UPDATE 数据库
2. 先删除节点再重新提取
3. 修改 pipeline 支持强制更新

---

## 四、推荐处理策略

### 4.1 当前机制的使用建议

**适合场景**:
- ✅ 多课本累积别名和元数据
- ✅ 逐步丰富节点的学习模式和标签
- ✅ 一课一课顺序处理

**不适合场景**:
- ❌ 修正已存在节点的定义
- ❌ 改变节点的核心属性（kind, subkind）
- ❌ 需要完全刷新节点内容

### 4.2 如何强制完整更新

如果需要强制更新节点的所有字段：

```python
# 方案1：先删除再插入
connection.execute(
    "DELETE FROM nodes WHERE dataset_id = ? AND id = ?",
    (dataset_id, node_id)
)
# 然后调用 _insert_node

# 方案2：直接 UPDATE 所有字段
connection.execute("""
    UPDATE nodes SET
        canonical_name = ?,
        definition = ?,
        node_kind = ?,
        ...
    WHERE dataset_id = ? AND id = ?
""")
```

### 4.3 QA 检查建议

在 `strict_qa_sqlite.py` 中，可以增加检查：

```python
# 检查节点定义的一致性
def check_definition_consistency(self):
    """检查同一节点在不同课本中的定义是否一致。"""
    conflicts = self.connection.execute("""
        SELECT n.id, n.canonical_name,
               COUNT(DISTINCT n.definition) as def_count
        FROM nodes n
        JOIN mentions m ON n.id = m.target_id
        GROUP BY n.id
        HAVING def_count > 1
    """).fetchall()
    
    for row in conflicts:
        self._add_warning(
            "consistency",
            row["id"],
            f"Node has {row['def_count']} different definitions across textbooks"
        )
```

---

## 五、总结

| 问题 | 答案 |
|-----|------|
| 不匹配的字段会怎样？ | SQL 层报错停止；Schema 层 QA 报错/警告 |
| 节点会增量更新吗？ | **部分增量**：仅 aliases、learning_modes、bridge_tags 合并，其他字段不变 |
| 如何完全更新节点？ | 需要手动 UPDATE 或 DELETE+INSERT |
| 可以累积别名吗？ | ✅ 是的，这是设计意图 |
| 可以修正定义吗？ | ❌ 不会自动更新，需要手动干预 |

---

## 六、改进建议

### 6.1 短期改进

为 `_update_node` 添加可选的完整更新模式：

```python
def _update_node(self, node_id: str, node: dict, full_update: bool = False) -> None:
    if full_update:
        # 更新所有字段
        self.connection.execute("""
            UPDATE nodes SET
                canonical_name = ?,
                node_kind = ?,
                node_subkind = ?,
                definition = ?,
                ...
            WHERE dataset_id = ? AND id = ?
        """, (...))
    else:
        # 现有的部分更新逻辑
        ...
```

### 6.2 长期改进

添加版本控制机制：

```python
# 在 nodes 表中添加 version 字段
# 每次更新增加版本号
# 保留历史版本的 definition
```

或者使用证据优先级：

```python
# 优先使用更可靠的来源的定义
if new_evidence_reliability > existing_reliability:
    update_definition = True
```
