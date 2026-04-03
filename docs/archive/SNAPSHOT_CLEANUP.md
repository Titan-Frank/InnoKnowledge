# Snapshot 依赖清理报告

**日期**: 2026-04-02

## 清理目标

识别并移除与 SQLite-first 工作流无关的 snapshot/JSONL 依赖。

## 分析过程

### 1. 识别 snapshot 依赖

扫描所有脚本中的关键词：
- `.jsonl` 文件引用
- `snapshot` 关键词
- `load_jsonl` 函数调用
- `export_full_snapshot` 引用

### 2. 分类结果

| 类别 | 脚本 | 状态 |
|------|------|------|
| **核心工作流** | 4 个脚本 | ✅ SQLite-first |
| **LightRAG** | 3 个脚本 | ✅ SQLite-first |
| **Pipeline** | 4 个脚本 | ✅ SQLite-first |
| **工具** | 5 个脚本 | ✅ SQLite-first |
| **迁移工具** | 2 个脚本 | ⚠️ 罕见使用 |
| **废弃** | 1 个脚本 | ❌ 删除 |

## 删除的脚本

### process_batch.py

**功能**: 从 batch JSON 文件运行完整 pipeline

**废弃原因**:
1. 调用已删除的 `strict_qa.py`
2. 独立批处理器，已被 Agent 架构替代
3. 没有其他脚本依赖
4. 当前工作流使用 `run_sqlite_batch_pipeline.py`

**结论**: ❌ 删除

## 保留的迁移工具

### sync_output_root_to_sqlite.py

**用途**: JSONL → SQLite 迁移

**保留原因**:
- 用于导入历史 JSONL 数据
- 数据恢复场景
- 初始数据迁移

**标记**: ⚠️ 迁移工具，日常工作流不需要

### upgrade_sqlite_runtime_schema.py

**用途**: SQLite Schema 升级

**保留原因**:
- 数据库版本升级
- Schema 变更

**标记**: ⚠️ 迁移工具，罕见使用

## knowledge_store_common.py 中的迁移函数

以下函数用于 JSONL → SQLite 迁移：

```python
# 迁移工具（JSONL → SQLite）
load_jsonl()           # 从 JSONL 加载数据
load_snapshot()        # 从 JSONL 快照加载完整数据集
SnapshotPaths          # JSONL 文件路径定义
SnapshotData           # JSONL 数据结构
```

**用途**: 被 `sync_output_root_to_sqlite.py` 调用

**标记**: 已在代码中添加注释说明

## 最终脚本列表 (18个)

### ✅ 核心工作流 (4)

| 脚本 | 功能 |
|------|------|
| `extract_lesson_sqlite.py` | 提取课时到 SQLite |
| `expand_node_sqlite.py` | 扩展节点卡片 |
| `normalize_sqlite.py` | 图归一化 |
| `strict_qa_sqlite.py` | QA 检查 |

### 🔍 LightRAG (3)

| 脚本 | 功能 |
|------|------|
| `retrieve_candidates.py` | 候选检索 |
| `local_subgraph.py` | 局部子图分析 |
| `batch_group_rollup.py` | 批次汇总 |

### ⚙️ Pipeline 运行时 (4)

| 脚本 | 功能 |
|------|------|
| `run_sqlite_batch_pipeline.py` | 主 pipeline |
| `batch_coverage.py` | Coverage 检查 |
| `finalize_batch_runtime.py` | 运行时完成 |
| `store_batch_runtime.py` | 存储运行时记录 |

### 🛠️ 工具 (5)

| 脚本 | 功能 |
|------|------|
| `viewer_sqlite_api.py` | Web 查看器 |
| `pipeline_manifest.py` | Manifest 管理 |
| `knowledge_store_common.py` | 公共库 + 数据访问 |
| `ensure_integrity.py` | 完整性检查 |
| `node_card_targets.py` | 节点卡片目标 |

### 📦 迁移工具 (2)

| 脚本 | 功能 | 使用场景 |
|------|------|---------|
| `sync_output_root_to_sqlite.py` | JSONL → SQLite | 历史数据迁移 |
| `upgrade_sqlite_runtime_schema.py` | Schema 升级 | 数据库升级 |

## 日常工作流 vs 迁移场景

### 日常工作流（SQLite-first）

```
用户
  ↓
opencode --agent kg-pipeline
  ↓
@lesson-processor
  ↓
extract_lesson_sqlite.py → SQLite
  ↓
expand_node_sqlite.py → SQLite
  ↓
normalize_sqlite.py → SQLite
  ↓
strict_qa_sqlite.py → SQLite
  ↓
viewer_sqlite_api.py → 从 SQLite 读
```

**全程不需要 JSONL！**

### 迁移场景（仅用于历史数据）

```bash
# 如果你有旧的 JSONL 数据
python scripts/sync_output_root_to_sqlite.py data/v4 \
  --db storage/knowledge.sqlite \
  --replace --activate --preserve-runtime
```

⚠️ 这是迁移工具，日常工作流不需要！

## 统计数据

| 项目 | Before | After | 变化 |
|------|--------|-------|------|
| 脚本总数 | 28 | 18 | -36% |
| 核心脚本 | 19 | 16 | -3 (迁移) |
| 迁移工具 | 0 | 2 | +2 (标记) |
| 废弃脚本 | 10 | 0 | -10 |

## 关键改进

### 1. 移除冗余
- ✅ 删除 11 个废弃/冗余脚本
- ✅ 保留 18 个必需脚本

### 2. 清晰分类
- ✅ 核心工作流 vs 迁移工具
- ✅ 日常使用 vs 罕见场景

### 3. 文档标记
- ✅ 迁移工具添加明确注释
- ✅ 函数说明使用场景

### 4. 架构一致
- ✅ 100% 符合 SQLite-first
- ✅ 没有混淆的 snapshot 依赖

## 验证

```bash
# 测试核心工作流
python scripts/extract_lesson_sqlite.py \
  --batch-anchor struct:book:lesson:1-1-1 \
  --book-md-path data/sources/book.md

# 测试查看器
python scripts/viewer_sqlite_api.py --port 8765

# 测试数据访问
python -c "
from knowledge_store_common import load_nodes, connect_db
conn = connect_db('storage/knowledge.sqlite')
nodes = load_nodes(conn, 'v4')
print(f'✓ 加载了 {len(nodes)} 个节点')
"
```

## 总结

项目现在非常干净：
- 18 个精心选择的脚本
- 清晰的分类和用途
- 没有冗余代码
- 完全符合 SQLite-first 原则
- 迁移工具明确标记

**日常工作流不需要任何 JSONL 文件！**
