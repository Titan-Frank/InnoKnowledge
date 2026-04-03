# JSON 组件清理完成报告

**日期**: 2026-04-02  
**状态**: ✅ 完成

---

## 已移除/归档的组件

### 1. 旧脚本 (移动到 `deprecated/scripts/`)

| 脚本 | 原因 | 替代方案 |
|------|------|----------|
| `apply_batch_artifacts.py` | JSON→SQLite 转换不再需要 | `extract_lesson_sqlite.py` 直接写入 |
| `import_to_sqlite.py` | JSON→SQLite 转换不再需要 | 直接写入 |

### 2. JSONL 中间文件 (已删除)

**位置**: `data/v4/`

**删除的文件**:
- ❌ `graph/knowledge.nodes.jsonl`
- ❌ `graph/knowledge.edges.jsonl`
- ❌ `profiles/knowledge.profiles.jsonl`
- ❌ `graph/*.mentions.jsonl`
- ❌ `graph/*.evidence.jsonl`
- ❌ `node_cards/*.json`

**备份位置**: `deprecated/jsonl_backup/*.tar.gz`

### 3. 更新的文档

| 文件 | 修改内容 |
|------|----------|
| `AGENTS.md` | 更新 Output Contract，移除 JSONL 作为主要存储的描述 |
| `.opencode/skills/chapter-extract/SKILL.md` | 更新 Phase 5，添加 SQLite-native 命令，移除 JSON 输出说明 |

---

## 当前架构状态

### 核心脚本 (SQLite-Native)

```
scripts/
├── extract_lesson_sqlite.py      ✅ 直接提取 → SQLite
├── expand_node_sqlite.py         ✅ 直接扩展卡片 → SQLite
├── normalize_sqlite.py           ✅ 直接规范化 → SQLite
├── strict_qa_sqlite.py           ✅ 直接 QA → SQLite
├── ensure_integrity.py           ✅ 完整性检查
├── run_sqlite_native_pipeline.py ✅ 统一管道
└── knowledge_store_common.py     ✅ 共享工具

deprecated/scripts/
├── apply_batch_artifacts.py      ⛔ 废弃 (JSON→SQLite)
└── import_to_sqlite.py           ⛔ 废弃 (JSON→SQLite)
```

### 数据存储

```
storage/knowledge.sqlite          ✅ 唯一主存储
data/outlines/*.outline.json      ✅ 结构定义 (保留)
data/runs/*.pipeline.json         ✅ 运行记录 (保留)

# 不再生成:
data/v4/graph/*.jsonl             ⛔ 已删除
├── knowledge.nodes.jsonl
├── knowledge.edges.jsonl
├── *.mentions.jsonl
└── *.evidence.jsonl

data/v4/node_cards/*.json         ⛔ 已删除
data/v4/profiles/*.jsonl          ⛔ 已删除
```

---

## 导出 JSONL（如需）

如果外部系统需要 JSONL 格式，可以从 SQLite 导出：

```bash
python scripts/export_snapshot.py \
  --db storage/knowledge.sqlite \
  --dataset-id v4 \
  --output data/v4/
```

---

## 验证

### SQLite 数据完整性

```bash
sqlite3 storage/knowledge.sqlite "
SELECT 
  (SELECT COUNT(*) FROM nodes) as nodes,
  (SELECT COUNT(*) FROM node_cards) as cards,
  (SELECT COUNT(*) FROM profiles) as profiles,
  (SELECT COUNT(*) FROM edges) as edges,
  (SELECT COUNT(*) FROM mentions) as mentions,
  (SELECT COUNT(*) FROM evidence) as evidence
"
```

**当前状态**: 包含之前提取的 6 个节点卡片等数据

### 旧脚本不存在

```bash
ls scripts/apply_batch_artifacts.py  # 不存在
ls scripts/import_to_sqlite.py       # 不存在
```

### JSONL 目录为空

```bash
ls data/v4/graph/       # 空目录
ls data/v4/node_cards/  # 空目录
ls data/v4/profiles/    # 空目录
```

---

## 使用新架构

### 提取第一课

```bash
python scripts/extract_lesson_sqlite.py \
  --batch-anchor "struct:chem-grade8-shanghai-all-in-one:lesson:1-1-1" \
  --book-md-path "/path/to/book.md" \
  --dataset-id "v4" \
  --dry-run  # 先试运行
```

### 完整 Pipeline

```bash
python scripts/run_sqlite_native_pipeline.py \
  --book-id "chem-grade8-shanghai-all-in-one" \
  --batch-anchor "struct:chem-grade8-shanghai-all-in-one:lesson:1-1-1" \
  --book-md-path "/path/to/book.md" \
  --dataset-id "v4"
```

### 验证

```bash
# QA 检查
python scripts/strict_qa_sqlite.py --dataset-id "v4"

# 完整性检查
python scripts/ensure_integrity.py --dataset-id "v4"
```

---

## 架构对比 (清理前后)

### 清理前
```
Markdown
  ↓
$chapter-extract
  ↓
├── knowledge.nodes.jsonl
├── knowledge.edges.jsonl
├── node_cards/*.json
└── ...
  ↓
import_to_sqlite.py
  ↓
apply_batch_artifacts.py
  ↓
SQLite
```

### 清理后
```
Markdown
  ↓
extract_lesson_sqlite.py
  ↓
SQLite (直接写入)
```

**管道步骤**: 7+ → 3  
**中间文件**: 5+ JSONL → 0  
**代码复杂度**: 高 → 低

---

## 下一步

1. **集成 LLM 提取** - 替换 placeholder 提取逻辑
2. **并行扩展** - 使用 concurrent.futures 并行生成卡片
3. **更新 @kg-pipeline** - 使用新的 SQLite-native 调用方式
4. **性能优化** - 批量插入优化

---

**清理完成！** 系统现在完全使用 SQLite-native 架构，无 JSON 中间文件。
