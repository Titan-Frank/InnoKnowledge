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
# 示例：你的教材文件
data/sources/your-book-id.md
```

### 2. 检查环境

```bash
# 检查 SQLite 数据库
ls -lh storage/knowledge.sqlite

# 检查 Python 环境
python --version  # 需要 Python 3.8+
```

## 开始使用

### 方式 1: 交互式（推荐新手）

```bash
# 启动 opencode TUI
opencode

# 在提示符下输入
@kg-pipeline 处理 your-book-id 全书
```

### 方式 2: 命令行

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
                  [提取 → 扩展 → 归一化 → QA]
                        ↓
                  写入 SQLite
                        ↓
                  返回结果给 Manager
                        ↓
                  继续下一个课时
```

## 常见问题

### Q: 处理整本书需要多久？

A: 取决于书的大小和课时数量。每个课时大约 2-5 分钟。

### Q: 中途失败了怎么办？

A: Manager 会自动停止并报告失败的课时。修复问题后重新运行，会从失败的地方继续。

### Q: 如何查看处理进度？

A: 查看 `runs/{book-id}.pipeline.json` 文件，里面有每个课时的状态。

### Q: 可以并行处理多个课时吗？

A: 不可以。课时必须顺序处理，以避免重复节点和不一致的关系。

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
ls .opencode/agents/

# 查看可用 skill
ls .opencode/skills/
```
