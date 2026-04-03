# Chapter Extract - SQLite-Native Version

直接写入 SQLite，不生成中间 JSON/JSONL 文件。

## 架构对比

### 传统流程（File-First）
```
$chapter-extract ──┬──→ nodes.jsonl
                 ├──→ edges.jsonl
                 ├──→ profiles.jsonl
                 ├──→ mentions.jsonl
                 ├──→ evidence.jsonl
                 └──→ node_cards/*.json
                          │
                          ▼
              run_sqlite_batch_pipeline.py
                          │
                          ▼
              SQLite (canonical store)
```

### SQLite-Native 流程
```
$chapter-extract ──┬──→ INSERT INTO nodes
                 ├──→ INSERT INTO edges
                 ├──→ INSERT INTO profiles
                 ├──→ INSERT INTO mentions
                 ├──→ INSERT INTO evidence
                 └──→ INSERT INTO node_cards
                          │
                          ▼
              SQLite (canonical store)
              [无中间文件，无格式转换]
```

## 技术方案

### 修改点

#### 1. 技能层 (`$chapter-extract`)

**当前行为**: 数据验证后直接写入 `{output-root}/graph/*.jsonl`

**新行为**: 
```python
# 伪代码
from knowledge_store_common import connect_db

conn = connect_db(db_path)
for node in extracted_nodes:
    conn.execute("""
        INSERT OR REPLACE INTO nodes 
        (dataset_id, id, canonical_name, node_kind, node_layer, ...)
        VALUES (?, ?, ?, ?, ?, ...)
    """, (dataset_id, node['id'], ...))
    
for card in node_cards:
    conn.execute("""
        INSERT OR REPLACE INTO node_cards
        (dataset_id, node_id, title, summary, sections_json, ...)
        VALUES (?, ?, ?, ?, ?, ...)
    """, (dataset_id, card['node_id'], ...))

conn.commit()
```

**优点**:
- 零中间文件
- 无需 `import_to_sqlite.py` 转换
- 无需处理 sections → JSON 序列化问题
- 事务安全（批量 INSERT + commit）

#### 2. 节点扩展 (`@node-expander`)

**当前行为**: 生成 `{output-root}/node_cards/{node_id}.json`

**新行为**:
直接 INSERT INTO node_cards 表

#### 3. 移除步骤

**可移除**: 
- `scripts/apply_batch_artifacts.py` - 不再需要（数据已在 SQLite）
- `scripts/import_to_sqlite.py` - 不再需要
- `data/v4/graph/*.jsonl` - 不再生成
- `data/v4/node_cards/*.json` - 不再生成

**保留但简化**:
- `run_sqlite_batch_pipeline.py` - 仅保留 QA 和 coverage 步骤

### 新流程

```bash
# 1. 提取（直接写入 SQLite）
$chapter-extract \
  --batch-anchor struct:chem:lesson:1-1-1 \
  --book-md-path /path/to/book.md \
  --db storage/knowledge.sqlite \
  --dataset-id v4

# 2. 节点扩展（直接写入 SQLite）
@node-expander \
  --node-id concept:chemical-change \
  --db storage/knowledge.sqlite \
  --dataset-id v4

# 3. 规范化（操作 SQLite）
$graph-normalize \
  --dataset-id v4 \
  --db storage/knowledge.sqlite

# 4. QA（读取 SQLite）
@qa-reviewer \
  --dataset-id v4 \
  --db storage/knowledge.sqlite
```

### 导出 JSON（可选）

如果需要 JSON 导出（如 Viewer API 或备份）:
```bash
# 从 SQLite 导出 JSONL 快照
python scripts/export_snapshot.py \
  --db storage/knowledge.sqlite \
  --dataset-id v4 \
  --output data/v4/
```

## Schema 对齐

确保提取代码中的字段名与 SQLite 表列名一致：

| JSON 字段 | SQLite 列 | 转换 |
|-----------|-----------|------|
| `aliases` | `aliases_json` | `json.dumps()` |
| `learning_modes` | `learning_modes_json` | `json.dumps()` |
| `sections` | `sections_json` | `json.dumps()` |
| `properties` | `properties_json` | `json.dumps()` |

## 代码变更清单

### 修改文件
1. `.opencode/skills/chapter-extract/SKILL.md` - 更新 Phase 5: Persist
2. `.opencode/agents/node-expander.md` - 改为直接写 SQLite
3. `scripts/` - 移除或简化 import/apply 脚本

### 新增文件
1. `scripts/extract_direct_sqlite.py` - 纯 SQLite 提取器
2. `scripts/expand_node_sqlite.py` - 纯 SQLite 节点扩展器

### 验证
```bash
# 提取后验证
sqlite3 storage/knowledge.sqlite "
  SELECT 
    (SELECT COUNT(*) FROM nodes) as nodes,
    (SELECT COUNT(*) FROM edges) as edges,
    (SELECT COUNT(*) FROM profiles) as profiles,
    (SELECT COUNT(*) FROM mentions) as mentions,
    (SELECT COUNT(*) FROM evidence) as evidence,
    (SELECT COUNT(*) FROM node_cards) as cards
  ;
"
```

## 优势

| 方面 | File-First | SQLite-Native |
|------|------------|---------------|
| IO 次数 | 高（写 JSON + 读 JSON + 写 SQLite） | 低（直接写 SQLite） |
| 格式转换 | 需要（JSON ↔ SQLite） | 无需 |
| 事务安全 | 困难 | 原生支持 |
| 存储空间 | 大（JSON + SQLite 重复） | 小（仅 SQLite） |
| 数据一致性 | 易出错 | 高 |
| 代码复杂度 | 高（多套格式处理） | 低（仅 SQL） |
| Pipeline 步骤 | 5+ 步骤 | 3 步骤 |

## 迁移计划

**Phase 1**: 创建 `chapter-extract-sqlite` 技能并行运行
**Phase 2**: 验证数据一致性
**Phase 3**: 废弃 JSONL 输出
**Phase 4**: 移除 `import_to_sqlite.py`

## 实现参考

SQLite 表结构：
```sql
-- nodes
CREATE TABLE nodes (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  node_kind TEXT NOT NULL,
  node_layer TEXT NOT NULL,
  node_subkind TEXT,
  definition TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  learning_modes_json TEXT NOT NULL DEFAULT '[]',
  bridge_tags_json TEXT NOT NULL DEFAULT '[]',
  framework_refs_json TEXT NOT NULL DEFAULT '[]',
  profile_refs_json TEXT NOT NULL DEFAULT '[]',
  card_ref TEXT,
  same_as_refs_json TEXT NOT NULL DEFAULT '[]',
  properties_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (dataset_id, id)
);

-- node_cards
CREATE TABLE node_cards (
  dataset_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  sections_json TEXT NOT NULL,  -- JSON array
  properties_json TEXT DEFAULT '{}',
  pattern_refs_json TEXT DEFAULT '[]',
  status TEXT DEFAULT 'active',
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (dataset_id, node_id),
  FOREIGN KEY (dataset_id, node_id) REFERENCES nodes(dataset_id, id)
);
```
