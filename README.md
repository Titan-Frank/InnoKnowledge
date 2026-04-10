# Knowledge Map Extraction Project

从教材内容构建结构化的、证据支撑的、跨学科的知识图谱。

## 快速开始

### 启动 Claude Code

```bash
# 方式 1: 交互式（推荐）
claude

# 然后输入：
@kg-pipeline 处理 chem-grade8 全书

# 方式 2: 处理单个课时
/extract-lesson chem-grade8 1-1-1
```

### 处理教材

```bash
# 生成并行课时计划
python scripts/parallel_batch_runner.py \
  --book-id chem-grade8-all-in-one \
  --output-root data/main \
  --parallel 4 \
  --batch-size 1 \
  --generate-tasks

# 课时 worker 完成抽取后，写入 staging
python scripts/store_lesson_staging.py --help

# 把 staged lessons 合并到 canonical graph，再做 normalize/QA
python scripts/run_parallel_lesson_pipeline.py \
  --root data/main \
  --book-id chem-grade8-all-in-one
```

## 架构

项目采用 **Parallel Staging + Canonical Commit**：

```
@kg-pipeline (Manager - 纯调度，无业务逻辑)
│
├── @outline-reader (如需生成目录)
│
├── FOR each lesson (可并行):
│   └── @lesson-processor (Worker - 课时抽取)
│       ├── /chapter-extract (提取节点/关系)
│       ├── provisional node cards / evidence / mentions
│       └── scripts/store_lesson_staging.py
│
└── @kg-reducer (Reducer - 串行 canonical commit)
    ├── scripts/merge_staged_lessons.py
    ├── scripts/normalize_sqlite.py
    ├── scripts/strict_qa_sqlite.py
    └── scripts/check_graph_integrity.py
```

**职责分离**：
- **Manager** (@kg-pipeline): 决定 “做什么”
- **Lesson Worker** (@lesson-processor): 并行生成课时级候选
- **Reducer** (@kg-reducer): 决定 canonical truth 并提交正式图

## 核心原则

1. **全局优先** - 知识图谱服务于跨学科知识，不是单一教材
2. **证据支撑** - 每个节点和关系必须有教材出处
3. **检索优先** - 先检索候选再推理，避免全图操作
4. **SQLite 优先** - SQLite 是主存储，JSON/JSONL 是导出产物
5. **课时隔离** - 每个课时在独立 Task 中处理，避免上下文爆炸
6. **Staging First** - 并行 worker 只写 staging，不直接写 canonical graph

## 数据存储

### 主存储 (SQLite)

```
storage/knowledge.sqlite
├── lesson_runs         # 并行课时运行登记
├── staging_*           # 原始课时候选层
├── nodes              # 知识节点
├── edges              # 关系
├── profiles           # 课程画像
├── mentions           # 教材引用
├── evidence           # 原文证据
├── node_cards         # 节点详情卡片
├── merge_runs         # reducer 运行记录
└── canonical_node_map # 原始节点到 canonical 节点映射
```

### 辅助文件

```
data/
├── outlines/          # 教材目录结构 (7个教材)
├── frameworks/        # 课程框架
└── patterns/          # 模式库

runs/                  # Pipeline 进度
└── {book-id}.pipeline.json

ocr/                   # 教材 Markdown 文件
├── 八年级/
├── 九年级/
└── 高中年级/
```

## 常用操作

### 查看数据

```bash
# 并行课时切分
python scripts/parallel_batch_runner.py --help

# 把一个 lesson 的抽取结果写入 staging
python scripts/store_lesson_staging.py --help

# 合并 staged lessons 并跑 normalize/QA
python scripts/run_parallel_lesson_pipeline.py --help

# 启动查看器
python scripts/viewer_sqlite_api.py --port 8765

# 访问
open http://127.0.0.1:8765/viewer/

# 直接查询 SQLite
sqlite3 storage/knowledge.sqlite "SELECT COUNT(*) FROM nodes;"
```

### 验证数据

```bash
# QA 验证
python scripts/strict_qa_sqlite.py --dataset-id main

# 图完整性检查
python scripts/check_graph_integrity.py --dataset-id main
```

## 项目结构

```
.
├── .claude/
│   ├── agents/           # Agent 定义 (6个)
│   │   ├── kg-pipeline.md         (Manager)
│   │   ├── lesson-processor.md    (Worker)
│   │   ├── outline-reader.md
│   │   ├── node-expander.md
│   │   └── qa-reviewer.md
│   ├── skills/           # Skill 实现 (4个)
│   │   ├── chapter-extract/       (提取)
│   │   ├── graph-normalize/       (归一化)
│   │   ├── knowledge-schema/      (Schema)
│   │   └── textbook-outline/      (目录生成)
│   ├── commands/         # 命令 (1个)
│   │   └── extract-lesson.md
│   ├── CONVENTIONS.md    # 编码规范
│   ├── GLOSSARY.md       # 术语表
│   └── STYLE_GUIDE.md    # 写作风格
│
├── scripts/              # 辅助脚本 (20+)
│   ├── parallel_batch_runner.py
│   ├── store_lesson_staging.py
│   ├── merge_staged_lessons.py
│   └── run_parallel_lesson_pipeline.py
├── storage/              # SQLite 数据库
├── data/                 # 数据文件
├── ocr/                  # 教材 Markdown
├── schemas/              # JSON Schema
├── viewer/               # Web 查看器
│
├── CLAUDE.md             # 项目说明 (Claude Code 入口)
├── AGENTS.md             # 详细架构和规则
└── CHANGELOG.md          # 变更日志
```

## 文档导航

**核心文档**:
- [AGENTS.md](AGENTS.md) - 完整架构、约束和检查清单
- [.claude/GLOSSARY.md](.claude/GLOSSARY.md) - 术语定义
- [.claude/CONVENTIONS.md](.claude/CONVENTIONS.md) - 编码和文档标准

**开发文档**:
- [CHANGELOG.md](CHANGELOG.md) - 变更日志
- [schemas/v2/README.md](schemas/v2/README.md) - Schema 说明

## 开发

### 添加新的 Agent

1. 创建 `.claude/agents/{agent-name}.md`
2. 添加 YAML frontmatter:
   ```yaml
   ---
   name: agent-name
   description: Agent description
   tools: Read, Bash
   ---
   ```
3. 实现逻辑

### 添加新的 Skill

1. 创建 `.claude/skills/{skill-name}/SKILL.md`
2. 添加 YAML frontmatter:
   ```yaml
   ---
   name: skill-name
   description: Skill description
   ---
   ```
3. 实现完整工作流程

## 许可

MIT
