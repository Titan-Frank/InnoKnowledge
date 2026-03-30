# Knowledge Map Extraction Project

教材知识图谱构建工具。从教材 PDF 中抽取结构化的知识主干网络、课程画像、节点卡和证据链。

## 快速开始

### 启动 Viewer

```bash
open viewer/index.html
```

或启动本地服务器：

```bash
python -m http.server 8080 -d .
# 访问 http://localhost:8080/viewer/
```

### 抽取知识图谱

```bash
# 单课抽取
opencode run --agent build "@kg-pipeline 处理 <book-id> 的 <lesson-anchor>"

# 整本书（按 lesson 分批）
opencode run --agent build "@kg-pipeline 处理 <book-id> 全书，按 lesson 分批抽取"
```

## 核心概念

| 概念 | 说明 |
|------|------|
| 主干节点 | 稳定的核心知识锚点（概念、原理、物质） |
| 支撑节点 | 辅助节点（实验、方法、仪器） |
| 课程画像 | 节点在特定学段/学科中的投影 |
| 节点卡 | 单个节点的详细说明文档 |
| 证据链 | 每个节点的教材来源追溯 |

## Agent 流水线

| Agent | 用途 |
|-------|------|
| `@outline-reader` | 提取教材目录 |
| `@backbone-builder` | 抽取知识主干 |
| `@graph-normalizer` | 归一化、去重 |
| `@qa-reviewer` | 只读质量检查 |
| `@node-expander` | 扩展节点卡 |
| `@kg-pipeline` | 完整流水线 |

## 输出结构

```
data/
├── outlines/           # 教材目录
├── frameworks/         # 课程框架
├── patterns/           # 模式库
└── v2/                 # 默认输出
    ├── graph/          # 节点、边、mentions、evidence
    ├── profiles/       # 课程画像
    └── node_cards/     # 节点卡
```

## 工作流程

1. 准备教材 PDF，分配 `book-id`
2. 抽取目录骨架 → `data/outlines/<book-id>.outline.json`
3. 按 lesson 抽取知识主干
4. 归一化去重
5. QA 检查
6. 为重要节点生成节点卡

**建议粒度**：一次处理一课或一小段页码，避免整本书一次性抽取。

## 关键文件

- [AGENTS.md](AGENTS.md) - 项目规则
- [schemas/v2/](schemas/v2/) - Schema 定义
- [.opencode/agents/](.opencode/agents/) - Agent 定义
- [.opencode/skills/](.opencode/skills/) - Skill 定义
