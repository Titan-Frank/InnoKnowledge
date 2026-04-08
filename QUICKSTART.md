# Quick Start Guide

5 分钟快速上手知识图谱构建。

## 安装 opencode

```bash
# 如果尚未安装
curl -fsSL https://opencode.ai/install.sh | bash
```

## 准备工作

### 1. 准备教材文件

确保你的教材已完成 OCR 并转为 Markdown 格式：

```bash
# 教材文件位于 ocr/ 目录
ocr/
├── 八年级/
│   └── 初中（五•四学制）_化学_沪科技版_全一册_八年级/hybrid_auto/*.md
├── 九年级/
│   └── 初中（五•四学制）_化学_沪科技版_全一册_九年级/hybrid_auto/*.md
└── 高中年级/
    └── 高中_化学_沪科技版_*/hybrid_auto/*.md
```

### 2. 检查环境

```bash
# 检查 SQLite 数据库
ls -lh storage/knowledge.sqlite

# 检查 Python 环境
python --version  # 需要 Python 3.8+
```

## 开始使用

### 方式 1: 并行课时计划 + reducer

```bash
# 为整本书生成并行课时计划
python scripts/parallel_batch_runner.py \
  --book-id your-book-id \
  --output-root data/main \
  --parallel 4 \
  --batch-size 4 \
  --generate-tasks

# 每个 lesson worker 抽取后写入 staging
python scripts/store_lesson_staging.py --help

# 合并 staged lessons，生成 canonical graph
python scripts/run_parallel_lesson_pipeline.py \
  --root data/main \
  --book-id your-book-id
```

### 方式 2: 交互式（保留）

```bash
# 启动 opencode TUI
opencode

# 在提示符下输入
@kg-pipeline 处理 your-book-id 全书
```

### 方式 3: 命令行

```bash
# 处理整本书
opencode run --agent kg-pipeline "处理 your-book-id 全书"

# 处理单个课时
opencode run --agent kg-pipeline "处理 your-book-id 的 struct:your-book-id:lesson:1-1-1"
```

## 查看结果

### 启动查看器

```bash
python scripts/viewer_sqlite_api.py --port 8765
```

访问: http://127.0.0.1:8765/viewer/

### 检查数据

```bash
# 查看节点数量
sqlite3 storage/knowledge.sqlite "SELECT COUNT(*) FROM nodes;"

# 查看最近的节点
sqlite3 storage/knowledge.sqlite "SELECT id, canonical_name FROM nodes ORDER BY created_at DESC LIMIT 10;"
```

## 工作原理

```
你 → opencode → @kg-pipeline (Manager)
                        ↓
                  为每个课时启动 Task
                        ↓
                  @lesson-processor (Worker)
                        ↓
                  [提取 → store_lesson_staging.py]
                        ↓
                  staging_*
                        ↓
                  @kg-reducer
                        ↓
                  [merge → normalize → QA]
                        ↓
                  canonical SQLite graph
```

## 常见问题

### Q: 处理整本书需要多久？

A: 取决于书的大小和课时数量。每个课时大约 2-5 分钟。

### Q: 中途失败了怎么办？

A: Manager 会自动停止并报告失败的课时。修复问题后重新运行，会从失败的地方继续。

### Q: 如何查看处理进度？

A: 查看 `runs/{book-id}.pipeline.json` 文件，里面有每个课时的状态。

### Q: 可以并行处理多个课时吗？

A: 可以，但仅限并行写入 `lesson_runs` + `staging_*`。`nodes`、`edges` 等 canonical 表仍由 reducer 串行提交。

### Q: 数据存在哪里？

A: 主存储在 `storage/knowledge.sqlite`。JSON/JSONL 文件是导出产物，不是主存储。

## 下一步

- 阅读 [README.md](README.md) 了解完整功能
- 阅读 [AGENTS.md](AGENTS.md) 了解架构细节
- 查看 [schemas/v2/](schemas/v2/) 了解数据结构

## 获取帮助

```bash
# opencode 帮助
opencode --help

# 查看可用 agent
ls .claude/agents/

# 查看可用 skill
ls .claude/skills/
```
