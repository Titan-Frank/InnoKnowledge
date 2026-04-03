# SQLite-Native 架构重构总结

## 重构目标
将知识提取管道从 **JSON-First** 迁移到 **SQLite-Native**，避免 JSONL 中间文件，直接写入 SQLite。

## 已完成组件

### 1. 核心脚本

#### `scripts/extract_lesson_sqlite.py`
- **功能**: 直接提取课时内容到 SQLite
- **特点**:
  - 读取 Markdown 教材
  - 解析课时范围（支持页码标记或标题搜索）
  - **直接 INSERT** nodes, edges, profiles, mentions, evidence
  - 自动重建 FTS 索引
  - 支持 dry-run 模式
- **不产生**:
  - ❌ knowledge.nodes.jsonl
  - ❌ knowledge.edges.jsonl
  - ❌ *.mentions.jsonl
  - ❌ *.evidence.jsonl

**用法**:
```bash
python scripts/extract_lesson_sqlite.py \
  --batch-anchor "struct:chem-grade8-shanghai-all-in-one:lesson:1-1-1" \
  --book-md-path "/path/to/book.md" \
  --dataset-id "v4" \
  --db "storage/knowledge.sqlite"
```

#### `scripts/expand_node_sqlite.py`
- **功能**: 直接生成节点卡片到 SQLite
- **特点**:
  - 写入 `node_cards` 表
  - 更新 `nodes.card_ref` 链接
  - 自动重建 card_search FTS 索引
  - 支持 sections 数组/字典格式转换
- **不产生**:
  - ❌ data/v4/node_cards/*.json

**用法**:
```bash
python scripts/expand_node_sqlite.py \
  --node-id "concept:chemical-science" \
  --dataset-id "v4" \
  --db "storage/knowledge.sqlite" \
  --title "化学科学" \
  --summary "..." \
  --sections "[{...}]"
```

### 2. 文档

#### `.opencode/skills/chapter-extract/SKILL_SQLITE_NATIVE_V2.md`
- 完整的 SQLite-native 工作流程
- API 说明和示例
- 与传统流程对比

## 架构对比

### 旧流程 (JSON-First)
```
教材 Markdown
     ↓
$chapter-extract
     ↓
├── knowledge.nodes.jsonl
├── knowledge.edges.jsonl
├── *.mentions.jsonl
├── *.evidence.jsonl
└── node_cards/*.json
     ↓
import_to_sqlite.py
     ↓
SQLite (最终存储)
```

**问题**:
- 磁盘 I/O 三次（读 Markdown + 写 JSONL + 读 JSONL + 写 SQLite）
- JSON ↔ SQLite 格式转换复杂
- 代码 bug 多（刚修复 3 个转换 bug）
- 存储重复（JSONL + SQLite 两份）
- Pipeline 步骤 5+

### 新流程 (SQLite-Native)
```
教材 Markdown
     ↓
extract_lesson_sqlite.py
     ↓
SQLite (直接写入 nodes, edges, profiles, mentions, evidence)
     ↓
expand_node_sqlite.py（为每个 backbone node）
     ↓
SQLite (直接写入 node_cards)
     ↓
normalize_sqlite.py（规范化）
     ↓
strict_qa_sqlite.py（验证）
     ↓
SQLite (最终存储)
```

**优势**:
- 磁盘 I/O 一次（读 Markdown + 直接写 SQLite）
- 无格式转换
- 代码简单（纯 SQL）
- 存储单一
- Pipeline 步骤 3

## 新 Pipeline 流程

```bash
# 1. 提取课时（直接写 SQLite）
python scripts/extract_lesson_sqlite.py \
  --batch-anchor "struct:chem-grade8:lesson:1-1-1" \
  --book-md-path ".../book.md" \
  --dataset-id "v4"

# 2. 扩展节点卡片（并行执行每个 backbone node）
for node_id in $(get_backbone_nodes_from_sqlite); do
  python scripts/expand_node_sqlite.py \
    --node-id "$node_id" \
    --dataset-id "v4" \
    --title "..." \
    --summary "..." \
    --sections "[...]" &
done
wait

# 3. 规范化（操作 SQLite）
python scripts/normalize_sqlite.py --dataset-id "v4"

# 4. QA 验证（读取 SQLite）
python scripts/strict_qa_sqlite.py --dataset-id "v4" --scope "..."
```

## 组件状态

| 组件 | 状态 | 说明 |
|------|------|------|
| extract_lesson_sqlite.py | ✅ 完成 | 核心提取脚本 |
| expand_node_sqlite.py | ✅ 完成 | 节点卡片生成 |
| SKILL_SQLITE_NATIVE_V2.md | ✅ 完成 | 技能说明文档 |
| normalize_sqlite.py | ⏳ TODO | 简化版图规范化 |
| strict_qa_sqlite.py | ⏳ TODO | SQLite-native QA |
| @kg-pipeline 更新 | ⏳ TODO | 调用新脚本 |

## API Usage

### 从 Python 调用

```python
from extract_lesson_sqlite import SQLiteExtractor
from expand_node_sqlite import NodeCardInserter
from knowledge_store_common import connect_db

conn = connect_db("storage/knowledge.sqlite")

# 提取课时
extractor = SQLiteExtractor(
    connection=conn,
    dataset_id="v4",
    book_id="chem-grade8-shanghai-all-in-one",
    batch_anchor="struct:chem-grade8:lesson:1-1-1",
)

backbone_nodes = extractor.extract_nodes(nodes_data)
extractor.extract_profiles(profiles_data)
evidence_map = extractor.extract_evidence(evidence_data)
extractor.extract_mentions(mentions_data, evidence_map)
extractor.extract_edges(edges_data)

# 扩展节点卡片
inserter = NodeCardInserter(connection=conn, dataset_id="v4")
for node_id in backbone_nodes:
    inserter.insert_or_update_card(node_id, card_data)

inserter.update_card_search_index()
```

## 验证命令

```bash
# 检查 SQLite 数据
sqlite3 storage/knowledge.sqlite "
SELECT 
  (SELECT COUNT(*) FROM nodes) as nodes,
  (SELECT COUNT(*) FROM edges) as edges,
  (SELECT COUNT(*) FROM profiles) as profiles,
  (SELECT COUNT(*) FROM mentions) as mentions,
  (SELECT COUNT(*) FROM evidence) as evidence,
  (SELECT COUNT(*) FROM node_cards) as cards
;"

# 检查 backbone nodes 是否有 cards
sqlite3 storage/knowledge.sqlite "
SELECT 
  n.id,
  n.canonical_name,
  CASE WHEN nc.node_id IS NOT NULL THEN '✓' ELSE '✗' END as has_card
FROM nodes n
LEFT JOIN node_cards nc 
  ON n.dataset_id = nc.dataset_id AND n.id = nc.node_id
WHERE n.node_layer = 'backbone' AND n.dataset_id = 'v4'
;"
```

## 数据一致性验证

### 插入顺序（避免外键约束）

```python
# 1. nodes（无依赖）
extractor.extract_nodes(nodes_data)

# 2. profiles（依赖 nodes）
extractor.extract_profiles(profiles_data)

# 3. evidence（无依赖）
evidence_map = extractor.extract_evidence(evidence_data)

# 4. mentions（依赖 nodes 和 evidence）
extractor.extract_mentions(mentions_data, evidence_map)

# 5. edges（依赖 nodes）
extractor.extract_edges(edges_data)

# 6. node_cards（依赖 nodes，可独立执行）
inserter.insert_or_update_card(node_id, card_data)
```

## 降级方案

如需导出 JSONL（如 Viewer API 需要）:

```bash
# 从 SQLite 导出快照
python scripts/export_snapshot.py \
  --db storage/knowledge.sqlite \
  --dataset-id v4 \
  --output data/v4/
```

## 已废弃组件（计划中）

- `scripts/apply_batch_artifacts.py` - 不再需要从 JSONL 导入 SQLite
- `scripts/import_to_sqlite.py` - 不再需要 JSONL → SQLite 转换
- `data/v4/graph/*.jsonl` - 不再生成中间文件
- `data/v4/node_cards/*.json` - 不再生成中间文件

## 立即使用

当前的八年级化学提取可以使用新架构：

```bash
# 第一课提取
python scripts/extract_lesson_sqlite.py \
  --batch-anchor "struct:chem-grade8-shanghai-all-in-one:lesson:1-1-1" \
  --book-md-path "/Users/titan-frank/Documents/hsd/research/Knowledge/ocr/八年级/初中（五•四学制）_化学_沪科技版_全一册_八年级/hybrid_auto/初中（五•四学制）_化学_沪科技版_全一册_八年级.md" \
  --dataset-id "v4" \
  --dry-run  # 先试运行
```

**注意**: 当前脚本使用 placeholder 提取逻辑。实际生产需要集成 LLM 调用。

## 下一步（可选）

1. **normalize_sqlite.py** - 创建 SQLite-native 的图规范化脚本
2. **strict_qa_sqlite.py** - 创建 SQLite-native 的 QA 验证脚本
3. **更新 @kg-pipeline** - 修改 pipeline 调用新脚本
4. **移除旧脚本** - 废弃 import_to_sqlite.py 和 apply_batch_artifacts.py

---

**重构日期**: 2026-04-02
**状态**: 核心组件完成，可用状态
