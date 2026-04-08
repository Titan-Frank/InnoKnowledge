# Knowledge Map Extraction Project

从教材内容构建结构化的、证据支撑的、跨学科的知识图谱。

## 快速开始

### 启动 opencode

```bash
# 方式 1: 交互式 TUI (推荐)
opencode

# 方式 2: 直接运行命令
opencode run "处理化学八年级全书的第一个课时"

# 方式 3: 指定 agent
opencode run --agent kg-pipeline "处理 chem-grade8 全书"
```

### 处理教材

```bash
# 处理单个课时
opencode run --agent kg-pipeline "处理 chem-grade8 的 struct:chem-grade8:lesson:1-1-1"

# 处理整本书（按课时顺序自动处理）
opencode run --agent kg-pipeline "处理 chem-grade8 全书"

# 交互式指定参数
opencode
# 然后输入: "@kg-pipeline 处理 chem-grade8 全书"
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
├── outlines/          # 教材目录结构
│   └── {book-id}.outline.json
├── frameworks/        # 课程框架
└── patterns/          # 模式库

runs/                  # 运行记录
└── {book-id}.pipeline.json
```

## 常用操作

### 查看数据

```bash
# 启动查看器
python scripts/viewer_sqlite_api.py --port 8765

# 访问
open http://127.0.0.1:8765/viewer/
```

### 导出快照

```bash
# 从 SQLite 导出 JSONL（供外部系统使用）
python scripts/export_snapshot.py data/v4 \
  --db storage/knowledge.sqlite \
  --dataset-id v4
```

### 检查数据一致性

```bash
```

## 工作流程

### 1. 准备教材

确保教材已完成 OCR 并转为 Markdown：

```
ocr/{book-id}.md
```

### 2. 生成目录（首次）

```bash
opencode run --agent outline-reader "为 ocr/chem-grade8.md 生成目录"
```

输出: `data/outlines/chem-grade8.outline.json`

### 3. 处理教材

```bash
opencode run --agent kg-pipeline "处理 chem-grade8 全书"
```

Manager 会：
1. 加载目录
2. 为每个课时启动 @lesson-processor
3. 监控进度
4. 报告结果

### 4. 查看结果

```bash
# 启动查看器
python scripts/viewer_sqlite_api.py

# 或检查 SQLite
sqlite3 storage/knowledge.sqlite "SELECT COUNT(*) FROM nodes;"
```

## 项目结构

```
.
├── .claude/
│   ├── agents/           # Agent 定义
│   │   ├── kg-pipeline.md         (Manager)
│   │   ├── lesson-processor.md    (Worker)
│   │   ├── outline-reader.md
│   │   ├── node-expander.md
│   │   └── qa-reviewer.md
│   └── skills/           # Skill 实现
│       ├── chapter-extract/       (提取)
│       ├── graph-normalize/       (归一化)
│       ├── knowledge-schema/      (Schema)
│       └── textbook-outline/      (目录生成)
│
├── scripts/              # 辅助脚本
│   ├── viewer_sqlite_api.py       (查看器)
│   ├── export_snapshot.py         (导出)
│   └── ...
│
├── storage/              # 主存储
│   └── knowledge.sqlite
│
├── data/                 # 数据文件
│   ├── outlines/
│   ├── frameworks/
│   └── patterns/
│
├── schemas/              # JSON Schema 定义
│   └── v2/
│
├── AGENTS.md             # 详细架构和规则
├── GLOSSARY.md           # 术语表
└── README.md             # 本文件
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

## 故障排查

### SQLite 锁定

```bash
# 检查是否有进程占用
lsof storage/knowledge.sqlite

# 备份并重建
cp storage/knowledge.sqlite storage/knowledge.backup.sqlite
```

### 课时处理失败

Manager 会自动停止并报告问题。查看：

```
runs/{book-id}.pipeline.json
```

中的 `status` 和 `issues` 字段。

### 上下文溢出

确保使用 Task-per-lesson 模式（默认）。不要在一个会话中处理多个课时。

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

[根据项目实际情况填写]
