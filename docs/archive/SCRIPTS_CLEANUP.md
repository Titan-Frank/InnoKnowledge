# 脚本清理报告

**日期**: 2026-04-02

## 清理结果

**删除**: 10 个废弃脚本  
**保留**: 19 个核心脚本  
**新建**: 1 个缺失脚本（export_snapshot.py）

---

## ✅ 保留脚本 (18个)

### 核心提取流程 (4个)

| 脚本 | 功能 |
|------|------|
| `extract_lesson_sqlite.py` | 提取课时内容到 SQLite |
| `expand_node_sqlite.py` | 扩展节点卡片 |
| `normalize_sqlite.py` | 图归一化和去重 |
| `strict_qa_sqlite.py` | SQLite-native QA 检查 |

### LightRAG 检索 (3个)

| 脚本 | 功能 |
|------|------|
| `retrieve_candidates.py` | 候选节点检索（hybrid/local/global/mix）|
| `local_subgraph.py` | 局部子图分析（1-2 hop）|
| `batch_group_rollup.py` | 批次主题汇总 |

### Pipeline 运行 (4个)

| 脚本 | 功能 |
|------|------|
| `run_sqlite_batch_pipeline.py` | 主 pipeline 调度器 |
| `batch_coverage.py` | Coverage 检查 |
| `finalize_batch_runtime.py` | 运行时完成处理 |
| `store_batch_runtime.py` | 存储运行时记录 |

### 工具和管理 (5个)

| 脚本 | 功能 |
|------|------|
| `viewer_sqlite_api.py` | Web 查看器 API |
| `pipeline_manifest.py` | Manifest 管理 |
| `knowledge_store_common.py` | 公共库函数 + 数据访问 |
| `ensure_integrity.py` | 数据完整性检查 |
| `node_card_targets.py` | 节点卡片目标列表 |

### 迁移工具 (2个)

| 脚本 | 功能 | 使用场景 |
|------|------|---------|
| `sync_output_root_to_sqlite.py` | JSONL → SQLite 同步 | 历史数据迁移（罕见使用）|
| `upgrade_sqlite_runtime_schema.py` | Schema 升级工具 | 数据库升级（罕见使用）|

**注意**: 迁移工具仅用于历史数据迁移，日常工作流不需要。

**注意**: `export_snapshot.py` 已合并到 `knowledge_store_common.py`，函数重命名为 `load_*()`。

---

## ❌ 删除脚本 (11个)

### 废弃提取脚本 (5个)

| 脚本 | 删除原因 |
|------|---------|
| `extract_all_lessons.py` | 违反 SQLite-first，直接写 JSONL |
| `batch_extract_chemistry.py` | 违反 SQLite-first，直接写 JSONL |
| `extract_chem_grade8_complete.py` | 针对特定教材，违反 SQLite-first |
| `extract_chem_grade8_complete_v2.py` | 同上 |
| `extract_chem_v2.py` | 同上 |

### 被替代脚本 (1个)

| 脚本 | 删除原因 | 替代方案 |
|------|---------|---------|
| `run_single_lesson.py` | 被 Agent 架构替代 | `@lesson-processor` Agent |

### 旧版本脚本 (1个)

| 脚本 | 删除原因 | 替代方案 |
|------|---------|---------|
| `run_sqlite_native_pipeline.py` | 旧版本 pipeline | `run_sqlite_batch_pipeline.py` |

### 旧 QA 脚本 (1个)

| 脚本 | 删除原因 | 替代方案 |
|------|---------|---------|
| `strict_qa.py` | 文件系统版本 | `strict_qa_sqlite.py` (SQLite 版本) |

### 一次性脚本 (2个)

| 脚本 | 删除原因 |
|------|---------|
| `verify_task_per_lesson.py` | 一次性验证脚本 |
| `batch_processor.py` | 旧的批处理器 |

### 废弃批处理脚本 (1个)

| 脚本 | 删除原因 |
|------|---------|
| `process_batch.py` | 调用已删除脚本，已被 Agent 架构替代 |

---

## 📝 新建脚本 (1个)

### export_snapshot.py

**原因**: 多个脚本依赖此模块

**依赖脚本**:
- `batch_coverage.py`
- `node_card_targets.py`
- `viewer_sqlite_api.py`
- （原）`strict_qa.py`

**导出函数**:
- `export_nodes()` - 导出节点
- `export_edges()` - 导出关系
- `export_profiles()` - 导出课程画像
- `export_mentions()` - 导出提及
- `export_evidence()` - 导出证据
- `export_node_cards()` - 导出节点卡片
- `export_full_snapshot()` - 完整快照导出

---

## 清理前后对比

| 指标 | 清理前 | 清理后 | 减少 |
|------|--------|--------|------|
| 脚本数量 | 28 | 18 | -36% |
| 废弃脚本 | 11 | 0 | -100% |
| 重复功能 | 2 (QA) | 1 | -50% |

---

## 脚本依赖关系

```
核心流程:
extract_lesson_sqlite.py
    ↓
expand_node_sqlite.py
    ↓
normalize_sqlite.py
    ↓
strict_qa_sqlite.py

Pipeline 调度:
run_sqlite_batch_pipeline.py
    ├── batch_coverage.py
    ├── local_subgraph.py
    ├── finalize_batch_runtime.py
    └── strict_qa_sqlite.py

LightRAG 检索:
retrieve_candidates.py
    ↓
local_subgraph.py
    ↓
batch_group_rollup.py

工具支持:
knowledge_store_common.py (公共库)
export_snapshot.py (导出工具)
viewer_sqlite_api.py (查看器)
```

---

## 使用建议

### 核心提取流程

```bash
# 单课时提取
python scripts/extract_lesson_sqlite.py \
  --batch-anchor struct:book:lesson:1-1-1 \
  --book-md-path data/sources/book.md

# 扩展节点卡片
python scripts/expand_node_sqlite.py \
  --node-id entity/substance:oxygen

# 归一化
python scripts/normalize_sqlite.py

# QA 检查
python scripts/strict_qa_sqlite.py
```

### Pipeline 运行

```bash
# 完整 pipeline（推荐）
python scripts/run_sqlite_batch_pipeline.py \
  --root data/v4 \
  --book-id chem-grade8 \
  --batch-anchor struct:chem:lesson:1-1-1
```

### LightRAG 检索

```bash
# 候选检索
python scripts/retrieve_candidates.py "化学平衡" \
  --mode hybrid \
  --db storage/knowledge.sqlite

# 局部子图分析
python scripts/local_subgraph.py \
  --batch-anchor struct:chem:lesson:1-1-1 \
  --hops 1
```

### 工具使用

```bash
# 查看数据
python scripts/viewer_sqlite_api.py --port 8765

# 导出快照
python scripts/export_snapshot.py \
  --db storage/knowledge.sqlite \
  --output-root data/v4

# 完整性检查
python scripts/ensure_integrity.py
```

---

## 维护说明

### 添加新脚本

如果需要添加新的处理脚本：

1. **确定分类**: 核心流程 / 工具 / 分析
2. **遵循命名**: `*_sqlite.py` 表示 SQLite-native
3. **导入规范**: 从 `knowledge_store_common` 导入公共函数
4. **添加文档**: 在此文件中记录

### 废弃脚本

如果脚本不再使用：

1. **不要直接删除**: 移动到 `deprecated/scripts/`
2. **更新文档**: 在此文件中标记为废弃
3. **说明原因**: 记录废弃原因和替代方案

---

## 验证

```bash
# 验证所有脚本可导入
python3 -c "
import sys
sys.path.insert(0, 'scripts')
from export_snapshot import export_nodes
from knowledge_store_common import connect_db
print('✓ 所有导入正常')
"

# 验证数据库操作
python scripts/ensure_integrity.py
```

---

## 参考

- `AGENTS.md` - 架构文档
- `README.md` - 使用说明
- `deprecated/README.md` - 废弃组件说明
