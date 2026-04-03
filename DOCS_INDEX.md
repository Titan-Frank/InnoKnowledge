# 文档索引

## 快速开始

| 文档 | 用途 |
|------|------|
| [QUICKSTART.md](QUICKSTART.md) | 5 分钟快速上手 |
| [README.md](README.md) | 项目概览和常用操作 |

## 核心文档

| 文档 | 用途 |
|------|------|
| [AGENTS.md](AGENTS.md) | 架构设计、约束规则、检查清单 |
| [GLOSSARY.md](GLOSSARY.md) | 术语定义 |
| [PIPELINE_SAFETY.md](PIPELINE_SAFETY.md) | 安全操作指南 |

## Agent 文档

| Agent | 职责 | 文档 |
|-------|------|------|
| @kg-pipeline | Manager - 调度和监控 | [.opencode/agents/kg-pipeline.md](.opencode/agents/kg-pipeline.md) |
| @lesson-processor | Worker - 单课时处理 | [.opencode/agents/lesson-processor.md](.opencode/agents/lesson-processor.md) |
| @outline-reader | 教材目录生成 | [.opencode/agents/outline-reader.md](.opencode/agents/outline-reader.md) |
| @node-expander | 节点卡片生成 | [.opencode/agents/node-expander.md](.opencode/agents/node-expander.md) |
| @qa-reviewer | 质量检查 | [.opencode/agents/qa-reviewer.md](.opencode/agents/qa-reviewer.md) |

## Skill 文档

| Skill | 功能 | 文档 |
|-------|------|------|
| $chapter-extract | 课时内容提取 | [.opencode/skills/chapter-extract/SKILL.md](.opencode/skills/chapter-extract/SKILL.md) |
| $graph-normalize | 图归一化 | [.opencode/skills/graph-normalize/SKILL.md](.opencode/skills/graph-normalize/SKILL.md) |
| $knowledge-schema | Schema 定义 | [.opencode/skills/knowledge-schema/SKILL.md](.opencode/skills/knowledge-schema/SKILL.md) |
| $textbook-outline | 目录结构提取 | [.opencode/skills/textbook-outline/SKILL.md](.opencode/skills/textbook-outline/SKILL.md) |

## Schema 文档

| Schema | 用途 |
|--------|------|
| [schemas/v2/](schemas/v2/) | 所有数据结构的 JSON Schema |
| [schemas/v2/README.md](schemas/v2/README.md) | Schema 使用说明 |

## 技术细节

| 文档 | 用途 |
|------|------|
| [MISMATCH_AND_INCREMENTAL_UPDATE.md](MISMATCH_AND_INCREMENTAL_UPDATE.md) | 数据不匹配处理机制 |
| [TABLE_PIPELINE_ALIGNMENT.md](TABLE_PIPELINE_ALIGNMENT.md) | 表结构与 Pipeline 对齐检查 |

## 开发文档

| 文档 | 用途 |
|------|------|
| [.opencode/CONVENTIONS.md](.opencode/CONVENTIONS.md) | 编码和文档规范 |
| [.opencode/STYLE_GUIDE.md](.opencode/STYLE_GUIDE.md) | 写作风格指南 |
| [.opencode/REFACTOR_SUMMARY.md](.opencode/REFACTOR_SUMMARY.md) | 架构重构说明 |

## 按使用场景查找

### 我想开始使用

1. [QUICKSTART.md](QUICKSTART.md) - 5 分钟上手
2. [README.md](README.md) - 了解项目

### 我想了解架构

1. [AGENTS.md](AGENTS.md) - 核心架构
2. [.opencode/REFACTOR_SUMMARY.md](.opencode/REFACTOR_SUMMARY.md) - 架构演进

### 我想处理教材

1. [QUICKSTART.md](QUICKSTART.md) - 基本操作
2. [.opencode/agents/kg-pipeline.md](.opencode/agents/kg-pipeline.md) - Manager 行为
3. [.opencode/agents/lesson-processor.md](.opencode/agents/lesson-processor.md) - Worker 行为

### 我想查看数据结构

1. [schemas/v2/README.md](schemas/v2/README.md) - Schema 概览
2. [AGENTS.md](AGENTS.md) - 输出契约部分

### 我想开发新功能

1. [.opencode/CONVENTIONS.md](.opencode/CONVENTIONS.md) - 规范
2. [AGENTS.md](AGENTS.md) - 约束规则
3. 参考现有 Agent/Skill 实现

### 我想排查问题

1. [PIPELINE_SAFETY.md](PIPELINE_SAFETY.md) - 安全指南
2. [MISMATCH_AND_INCREMENTAL_UPDATE.md](MISMATCH_AND_INCREMENTAL_UPDATE.md) - 错误处理
3. [TABLE_PIPELINE_ALIGNMENT.md](TABLE_PIPELINE_ALIGNMENT.md) - 数据对齐

## 项目结构

```
.
├── README.md                    项目概览
├── QUICKSTART.md                快速开始
├── AGENTS.md                    核心架构
├── GLOSSARY.md                  术语表
├── PIPELINE_SAFETY.md           安全指南
│
├── .opencode/
│   ├── agents/                  Agent 定义
│   ├── skills/                  Skill 实现
│   ├── CONVENTIONS.md           编码规范
│   ├── STYLE_GUIDE.md           写作风格
│   └── REFACTOR_SUMMARY.md      重构说明
│
├── schemas/v2/                  JSON Schema
├── scripts/                     辅助脚本
├── storage/                     SQLite 数据库
├── data/                        数据文件
│   ├── outlines/                教材目录
│   ├── frameworks/              课程框架
│   └── patterns/                模式库
└── runs/                        运行记录
```
