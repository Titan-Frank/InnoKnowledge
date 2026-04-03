# Knowledge Map Schemas

## 目录结构

```
schemas/
├── framework.schema.json       # 课程框架定义
├── outline.schema.json         # 教材目录结构
├── sqlite/                     # SQLite 数据库 schema
│   └── knowledge_store.sql
└── v2/                         # 知识图谱 schema（当前版本）
    ├── node.schema.json
    ├── edge.schema.json
    ├── curriculum-profile.schema.json
    ├── node-card.schema.json
    ├── mention.schema.json
    ├── evidence.schema.json
    ├── pattern-library.schema.json
    └── README.md
```

## Schema 用途

### 项目配置 Schema

| Schema | 用途 |
|--------|------|
| `framework.schema.json` | 课程框架定义，映射课程标准到知识领域 |
| `outline.schema.json` | 教材目录结构，定义章节层级 |

### 知识图谱 Schema (v2)

| Schema | 用途 |
|--------|------|
| `node.schema.json` | 规范节点 - 跨学科稳定的知识节点 |
| `edge.schema.json` | 规范关系 - 节点间的语义关系 |
| `curriculum-profile.schema.json` | 课程画像 - 节点在特定学科/学段的画像 |
| `node-card.schema.json` | 节点卡片 - 节点的详细展开说明 |
| `mention.schema.json` | 提及记录 - 节点在教材中的出现位置 |
| `evidence.schema.json` | 证据记录 - 教材原文片段 |
| `pattern-library.schema.json` | 模式库 - 节点卡片生成模板 |

### SQLite Schema

| Schema | 用途 |
|--------|------|
| `sqlite/knowledge_store.sql` | SQLite 数据库表结构定义 |

## 使用说明

### 验证 JSON 数据

```bash
# 验证节点数据
jsonschema -i data/nodes.json schemas/v2/node.schema.json

# 验证边数据
jsonschema -i data/edges.json schemas/v2/edge.schema.json
```

### 在代码中引用

```python
from pathlib import Path
import json

# 加载 schema
schema_path = Path("schemas/v2/node.schema.json")
schema = json.loads(schema_path.read_text())
```

## 设计原则

### V2 核心设计

1. **规范节点 (Canonical Node)** - 学科中立、跨学段稳定
2. **主干/支撑分层** - `node_layer` 区分核心概念与辅助内容
3. **课程画像分离** - 学科/年级/掌握要求独立于节点本体
4. **证据支撑** - 所有节点和关系都有教材出处

详见 [v2/README.md](v2/README.md)
