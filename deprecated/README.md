# 废弃脚本目录

## ⚠️ 警告

此目录中的脚本已被废弃，**禁止在生产环境中使用**。

这些脚本违反了项目的核心架构原则（SQLite-first），会导致数据不一致。

## 已废弃的脚本（已删除）

以下脚本因违反 SQLite-first 架构已被**永久删除**：

### ~~extract_chemistry_complete.py~~ ❌ DELETED
- **删除时间**: 2026-04-02
- **废弃原因**: 直接写入 JSONL 文件，绕过 SQLite 主存储
- **导致问题**: SQLite 和 JSONL 数据不一致，Viewer 无法显示新数据
- **正确替代**: 使用 `$chapter-extract` skill 直接写入 SQLite

### ~~extract_chemistry_v4.py~~ ❌ DELETED  
- **删除时间**: 2026-04-02
- **废弃原因**: 同上，直接操作 JSONL 而不经过 SQLite
- **导致问题**: 数据重复、schema 不一致
- **正确替代**: 使用 `$chapter-extract` skill 直接写入 SQLite

## 混淆的视觉提示

如果在系统中看到这些脚本的遗留引用：

```python
# ❌ 错误的模式（这些脚本的做法）
with open("data/v4/graph/knowledge.nodes.jsonl", "w") as f:
    f.write(json.dumps(node) + "\n")

# ✅ 正确的模式（应该使用的）
connection.execute(
    "INSERT INTO nodes (id, canonical_name, ...) VALUES (?, ?, ...)",
    (node_id, canonical_name, ...)
)
connection.commit()
```

## 历史记录

- **2025-04-02**: 将这些脚本移入 deprecated 目录
- **原因**: 导致 pipeline 数据不一致事故
- **影响**: 145 nodes 写入 JSONL 但只有 85 在 SQLite 中
- **修复**: 运行 import_to_sqlite.py 重新同步

- **2026-04-02**: 永久删除废弃脚本
- **原因**: 防止再次误用生成违规 JSON
- **删除文件**: `extract_chemistry_complete.py`, `extract_chemistry_v4.py`
- **仅保留**: 本 README 作为历史记录

- **2026-04-02**: 大规模脚本清理
- **原因**: 移除过时、干扰、与 pipeline 无关的脚本
- **删除文件** (10个):
  - `extract_all_lessons.py` - 违反 SQLite-first
  - `batch_extract_chemistry.py` - 违反 SQLite-first
  - `extract_chem_grade8_complete.py` - 特定教材脚本
  - `extract_chem_grade8_complete_v2.py` - 同上
  - `extract_chem_v2.py` - 同上
  - `run_single_lesson.py` - 被 @lesson-processor 替代
  - `run_sqlite_native_pipeline.py` - 旧版本
  - `strict_qa.py` - 文件系统版本（保留 SQLite 版本）
  - `verify_task_per_lesson.py` - 一次性验证脚本
  - `batch_processor.py` - 旧的批处理器
- **保留**: 19 个核心脚本
- **新建**: `export_snapshot.py`（缺失依赖）
- **文档**: `SCRIPTS_CLEANUP.md`

## 如果必须使用这些脚本

**警告**: 这会破坏数据一致性！

如果出于调试目的需要查看这些脚本：
1. 确保理解它们在做什么
2. 不要直接运行
3. 如果必须参考其中的逻辑，提取代码片段而不是运行整个脚本

## 正确的数据提取流程

参见: `/PIPELINE_SAFETY.md`

### 单课提取
```bash
python scripts/run_single_lesson.py --book-id <book-id> --output-root data/v4
```

### 批量提取
```bash
python scripts/parallel_batch_runner.py \
    --book-id <book-id> \
    --output-root data/v4 \
    --parallel 2 \
    --batch-size 4
```

### 数据验证
```bash
python check_data_consistency.py
```

### 启动 Viewer
```bash
python scripts/viewer_sqlite_api.py --db storage/knowledge.sqlite --port 8765
```

## 联系

如果有疑问，查阅：
- `/AGENTS.md` - 项目架构规范
- `/PIPELINE_SAFETY.md` - 操作安全指南
- `.opencode/skills/chapter-extract/SKILL.md` - 正确的提取流程
