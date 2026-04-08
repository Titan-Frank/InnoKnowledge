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
# 处理整本书
@kg-pipeline 处理 chem-grade8 全书

# 限制范围
@kg-pipeline 处理 chem-grade8，课程 1-1-1 到 1-2-3
```

## 架构

项目采用 **Manager-Worker 模式**：

```
@kg-pipeline (Manager - 纯调度，无业务逻辑)
│
├── @outline-reader (如需生成目录)
│
└── FOR each lesson (顺序处理):
    └── @lesson-processor (Worker - 完整业务逻辑)
        ├── /chapter-extract (提取节点/关系)
        ├── @node-expander × N (并行生成节点卡片)
        ├── /graph-normalize (去重/归一化)
        ├── closeout scripts (写入 SQLite)
        └── @qa-reviewer (质量检查)
```

**职责分离**：
- **Manager** (@kg-pipeline): 决定 "做什么"
- **Worker** (@lesson-processor): 知道 "怎么做"

## 核心原则

1. **全局优先** - 知识图谱服务于跨学科知识，不是单一教材
2. **证据支撑** - 每个节点和关系必须有教材出处
3. **检索优先** - 先检索候选再推理，避免全图操作
4. **SQLite 优先** - SQLite 是主存储，JSON/JSONL 是导出产物
5. **课时隔离** - 每个课时在独立 Task 中处理，避免上下文爆炸

## 数据存储

### 主存储 (SQLite)

```
storage/knowledge.sqlite
├── nodes              # 知识节点
├── edges              # 关系
├── profiles           # 课程画像
├── mentions           # 教材引用
├── evidence           # 原文证据
└── node_cards         # 节点详情卡片
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
│   ├── agents/           # Agent 定义 (5个)
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
├── storage/              # SQLite 数据库
├── data/                 # 数据文件
├── ocr/                  # 教材 Markdown
├── schemas/              # JSON Schema
├── viewer/               # Web 查看器
│
├── CLAUDE.md             # 项目说明 (Claude Code 入口)
├── AGENTS.md             # 详细架构和规则
├── QUICKSTART.md         # 快速上手
└── DOCS_INDEX.md         # 文档索引
```

## 文档导航

**快速开始**:
- [QUICKSTART.md](QUICKSTART.md) - 5 分钟快速上手
- [DOCS_INDEX.md](DOCS_INDEX.md) - 完整文档索引

**核心文档**:
- [AGENTS.md](AGENTS.md) - 完整架构、约束和检查清单
- [GLOSSARY.md](GLOSSARY.md) - 术语定义
- [PIPELINE_SAFETY.md](PIPELINE_SAFETY.md) - 安全操作指南

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
