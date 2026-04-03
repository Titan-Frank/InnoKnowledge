# export_snapshot 合并报告

**日期**: 2026-04-02

## 变更原因

`export_snapshot.py` 的命名误导了其真实用途：

| 误导性名称 | 实际用途 |
|-----------|---------|
| `export_nodes()` | 90% 用于从 SQLite 加载数据，10% 用于导出 JSONL |
| `export_*()` | 名字暗示"导出"，但主要用于"读取" |

**核心问题**: 当前工作流是 SQLite-first，不需要 JSONL 中间文件。

## 合并方案

### 函数重命名

| 旧名 | 新名 | 用途 |
|------|------|------|
| `export_nodes()` | `load_nodes()` | 从 SQLite 加载节点 |
| `export_edges()` | `load_edges()` | 从 SQLite 加载关系 |
| `export_profiles()` | `load_profiles()` | 从 SQLite 加载画像 |
| `export_mentions()` | `load_mentions()` | 从 SQLite 加载提及 |
| `export_evidence()` | `load_evidence()` | 从 SQLite 加载证据 |
| `export_node_cards()` | `load_node_cards()` | 从 SQLite 加载节点卡片 |
| `export_full_snapshot()` | `export_full_snapshot()` | 导出完整快照（保留，用于备份）|

### 目标文件

合并到: `scripts/knowledge_store_common.py`

## 变更详情

### 删除文件

- `scripts/export_snapshot.py` (332 行)

### 更新文件

| 文件 | 变更 |
|------|------|
| `knowledge_store_common.py` | +210 行（新增 load_* 函数）|
| `batch_coverage.py` | 更新 import |
| `node_card_targets.py` | 更新 import |
| `viewer_sqlite_api.py` | 更新 import |
| `process_batch.py` | 禁用 export_snapshot 调用 |
| `finalize_batch_runtime.py` | 更新注释 |
| `run_sqlite_batch_pipeline.py` | 更新注释 |

## 新的工作流

### 日常工作（无需 JSONL）

```
SQLite 数据库
    ↓
load_*() 函数
    ↓
Python dict 列表
    ↓
直接使用
```

**示例**:
```python
from knowledge_store_common import load_nodes, connect_db

connection = connect_db("storage/knowledge.sqlite")
nodes = load_nodes(connection, "v4")  # 直接返回 list[dict]

# 不需要 JSONL 文件！
for node in nodes:
    print(node["canonical_name"])
```

### 备份导出（可选）

```
SQLite 数据库
    ↓
export_full_snapshot()
    ↓
JSONL 文件（供外部系统使用）
```

**示例**:
```python
from knowledge_store_common import export_full_snapshot

# 可选：导出快照用于备份或外部系统
export_full_snapshot(
    connection,
    dataset_id="v4",
    output_root=Path("data/v4"),
    book_id="chem-grade8"
)
```

## 优势

### 1. 名称准确

- `load_*` = 从数据库加载
- `export_*` = 导出到文件

### 2. 集中管理

所有数据访问函数统一在 `knowledge_store_common.py`:
- 数据库连接
- Schema 管理
- 数据加载
- 快照导出

### 3. 符合架构

**SQLite-first 架构**:
- 主存储: SQLite
- 日常访问: `load_*()` 直接读 SQLite
- 备份导出: `export_full_snapshot()` 可选

### 4. 减少混淆

不再有"export 用于读取"的混淆。

## 使用场景对比

### Before（混淆）

```python
# 混淆：export 用于读取？
from export_snapshot import export_nodes

nodes = export_nodes(connection, dataset_id)  # 并不导出？
```

### After（清晰）

```python
# 清晰：load 用于读取
from knowledge_store_common import load_nodes

nodes = load_nodes(connection, dataset_id)  # 明确是加载
```

## 兼容性

### 破坏性变更

❌ `export_snapshot.py` 已删除

### 迁移指南

```python
# Before
from export_snapshot import export_nodes, export_edges

# After
from knowledge_store_common import load_nodes, load_edges
```

## 测试验证

```bash
# 测试导入
python3 -c "
from knowledge_store_common import (
    load_nodes, load_edges, load_profiles,
    load_mentions, load_evidence, load_node_cards,
    export_full_snapshot
)
print('✓ 所有函数可用')
"

# 测试加载
python3 -c "
from knowledge_store_common import connect_db, load_nodes
conn = connect_db('storage/knowledge.sqlite')
nodes = load_nodes(conn, 'v4')
print(f'✓ 加载了 {len(nodes)} 个节点')
"
```

## 文件统计

| 项目 | Before | After | 变化 |
|------|--------|-------|------|
| 脚本文件 | 20 | 19 | -1 |
| 总代码行数 | ~8000 | ~8000 | 0 |
| 数据访问函数位置 | 分散 | 集中 | ✅ |

## 参考

- `AGENTS.md` - SQLite-first 架构
- `SCRIPTS_CLEANUP.md` - 脚本清理报告
- `knowledge_store_common.py` - 数据访问函数
