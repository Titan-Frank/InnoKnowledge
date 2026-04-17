# Knowledge Map Extraction Project

从教材内容构建结构化的、证据支撑的、跨学科的知识图谱。

## 快速开始

### 启动基础设施

```bash
# 启动 PostgreSQL（含 pgvector 扩展）
docker compose up -d

# 默认连接
DATABASE_URL=postgresql://okm:okm@localhost:5432/knowledge
```

### 使用 Claude Code 处理教材

```bash
# 方式 1: 交互式（推荐）
claude

# 然后输入：
@kg-pipeline 处理 chem-grade8 全书

# 方式 2: 处理单个课题
/extract-lesson chem-grade8 1-1-1
```

### 启动 Web 查看器

```bash
npm install                  # 安装依赖
npm run dev                  # 开发模式（Hono API + Vite HMR）
# API:    http://127.0.0.1:8765/api/health
# 查看器: http://127.0.0.1:5173/viewer/

npm run serve                # 生产模式（构建后单进程服务）
# 查看器: http://127.0.0.1:8765/viewer/
```

### Python Pipeline 脚本

```bash
# 课时抽取 → staging 表（自动生成 embedding）
python scripts/store_lesson_staging.py \
  --root data/main --book-id chem-grade8 \
  --batch-anchor struct:chem-grade8:lesson:1-1-1 \
  --nodes-json '<json>' --edges-json '<json>' --profiles-json '<json>' \
  --mentions-json '<json>' --evidence-json '<json>' --node-cards-json '<json>'

# 合并 staging → canonical（语义对齐 + 去重）
python scripts/merge_staged_lessons.py --root data/main --book-id chem-grade8 --lesson-run-id <id>

# 归一化：去重、环检测、孤立节点处理
python scripts/normalize.py --dataset-id main

# 验证
python scripts/strict_qa.py --dataset-id main
python scripts/check_graph_integrity.py --dataset-id main

# 工具
python scripts/retrieve_candidates.py --mode hybrid --dataset-id main  # 语义检索
python scripts/backfill_embeddings.py --dataset-id main                # 重新生成 embedding
python scripts/cluster_nodes.py --dataset-id main                      # 社区检测 + PCA 布局
```

## 架构

项目采用 **Manager-Worker-Reducer** 架构，staging/canonical 两阶段写入：

```
@kg-pipeline (Manager - 纯调度，无业务逻辑)
│
├── @outline-reader (如需生成目录)
│
├── FOR each lesson (可并行，每个课题独立 Task):
│   └── @lesson-processor (Worker - 课时抽取)
│       ├── /chapter-extract (提取节点/关系/证据)
│       ├── @node-expander × N (并行生成节点卡片)
│       └── scripts/store_lesson_staging.py (自动 embedding + 写入 staging)
│
├── @kg-reducer (Reducer - 串行 canonical commit)
│   ├── scripts/merge_staged_lessons.py (语义对齐)
│   ├── scripts/normalize.py (去重、环检测)
│   ├── scripts/strict_qa.py (质量检查)
│   └── scripts/check_graph_integrity.py (完整性检查)
│
└── @qa-reviewer (可选只读审查)
```

**职责分离**：
- **Manager** (@kg-pipeline): 决定 "做什么"
- **Worker** (@lesson-processor): 并行生成课时级候选，只写 staging
- **Reducer** (@kg-reducer): 决定 canonical truth 并提交正式图

## 核心原则

1. **PostgreSQL 优先** - PostgreSQL 是唯一主存储（via `DATABASE_URL`），JSON/JSONL 仅是导出产物
2. **课时隔离** - 每个课时在独立 Task 中处理，避免上下文爆炸
3. **证据支撑** - 每个节点和关系必须有教材出处（mentions/evidence）
4. **检索优先** - 先检索候选再推理，避免全图操作
5. **Staging/Canonical 分离** - 并行 worker 只写 staging 表，仅 Reducer 合并到 canonical

## Embedding

节点在 staging 阶段通过 `scripts/embedding_client.py` 自动嵌入：

- **模型**: `Qwen/Qwen3-Embedding-4B`（2560 维，中文优化）
- **认证**: `EMBEDDING_API_KEY` 环境变量（Bearer token）
- **存储**: `embedding vector(2560)` 列，通过 pgvector 扩展
- **文本组成**: `canonical_name + definition + aliases`
- **Pipeline 用途**:
  - `merge_staged_lessons.py`: pgvector `<=>` 语义节点对齐（`--embedding-threshold 0.92`）
  - `retrieve_candidates.py`: 向量通道语义检索（`--mode hybrid`）

若 embedding 服务不可达，pipeline 以 NULL embedding 继续，不影响运行，仅降低合并精度。

## 数据存储

### PostgreSQL 表

**Canonical 表**: `nodes`, `edges`, `profiles`, `mentions`, `evidence`, `node_cards`, `node_terms`, `evidence_links`, `datasets`, `source_artifacts`

**Staging 表**: `staging_nodes`, `staging_edges`, `staging_profiles`, `staging_mentions`, `staging_evidence`, `staging_node_cards`

**Operational 表**: `lesson_runs`, `merge_runs`, `canonical_node_map`, `batch_runtime_records`, `retrieval_candidates`, `relation_proposals`, `review_queue`, `profile_textbooks`

PG schema: `schemas/pg/knowledge_store.sql`

### 文件结构

```
data/
├── outlines/          # 教材目录结构
├── frameworks/        # 课程框架
└── patterns/          # 模式库

runs/                  # Pipeline 进度
└── {book-id}.pipeline.json

ocr/                   # 教材 Markdown 文件
```

## Schema 参考

JSON Schema 位于 `schemas/v2/`：
- `node.schema.json` - 节点（`node_kind`, `node_layer`, `learning_modes`）
- `edge.schema.json` - 关系（`edge_type`, `edge_layer`）
- `curriculum-profile.schema.json` - 课程画像
- `mention.schema.json` - 教材位置引用
- `evidence.schema.json` - 原文证据
- `node-card.schema.json` - 节点详情卡片
- `pattern-library.schema.json` - 模式库

**节点类型**: `concept`, `entity`（subkinds: substance, equipment）, `activity`, `method`, `principle`, `representation`

**边类型**:
- **层级**（不允许环）: `is_a`, `instance_of`, `contains`, `part_of`, `prerequisite_for`, `depends_on`, `extends`
- **关联**（允许环）: `explains`, `causes`, `affects`, `uses`, `measures`, `produces`, `consumes`, `has_property`, `related_to`

## 项目结构

```
.
├── .claude/
│   ├── agents/                # Agent 定义
│   │   ├── kg-pipeline.md             (Manager)
│   │   ├── kg-reducer.md              (Reducer)
│   │   ├── lesson-processor.md        (Worker)
│   │   ├── node-expander.md           (节点卡片)
│   │   ├── outline-reader.md          (目录生成)
│   │   └── qa-reviewer.md             (质量审查)
│   ├── skills/                # Skill 实现
│   │   ├── chapter-extract/           (知识提取)
│   │   ├── graph-normalize/           (图归一化)
│   │   ├── knowledge-schema/          (Schema 校验)
│   │   └── textbook-outline/          (目录生成)
│   ├── commands/              # 命令
│   │   └── extract-lesson.md
│   ├── CONVENTIONS.md         # 编码规范
│   ├── GLOSSARY.md            # 术语表
│   └── STYLE_GUIDE.md         # 写作风格
│
├── scripts/                   # Python 脚本
│   ├── store_lesson_staging.py        (staging 写入)
│   ├── merge_staged_lessons.py        (staging → canonical)
│   ├── normalize.py                   (归一化)
│   ├── strict_qa.py                   (质量验证)
│   ├── check_graph_integrity.py       (完整性检查)
│   ├── embedding_client.py            (Embedding 客户端)
│   ├── retrieve_candidates.py         (语义检索)
│   ├── backfill_embeddings.py         (Embedding 回填)
│   ├── cluster_nodes.py               (社区检测 + PCA 布局)
│   ├── migrate_sqlite_to_pg.py        (SQLite 迁移)
│   └── ...                            (其他工具脚本)
│
├── packages/                  # TypeScript monorepo
│   ├── types/                 #   共享 API 类型
│   ├── server/                #   Hono + PostgreSQL API 服务
│   │   └── src/
│   │       ├── db/            #     连接 + 查询
│   │       ├── routes/        #     health, bundle, meta, node-card, search
│   │       ├── services/      #     embedding 服务
│   │       └── data/          #     frameworks, patterns, outlines
│   └── viewer/                #   Vite + React + Sigma.js + Graphology
│       └── src/
│           ├── graph/         #     Graphology 适配器、布局、可见性
│           ├── store/         #     Zustand 状态管理
│           ├── hooks/         #     数据加载、节点卡片、Sigma
│           └── components/    #     UI 组件（AppShell, Sidebar, DetailPanel 等）
│
├── schemas/                   # JSON Schema + SQL DDL
│   ├── v2/                    #   版本化 JSON Schema
│   ├── pg/                    #   PostgreSQL DDL
│   └── sqlite/                #   SQLite DDL (legacy)
│
├── docker-compose.yml         # Docker 编排
├── Dockerfile                 # 应用镜像
├── Dockerfile.pg              # PostgreSQL + pgvector 镜像
├── storage/                   # 本地 PostgreSQL 数据卷
├── data/                      # 数据文件
├── ocr/                       # 教材 Markdown
├── runs/                      # Pipeline 运行进度
│
├── CLAUDE.md                  # 项目说明 (Claude Code 入口)
├── AGENTS.md                  # 详细架构和规则
└── CHANGELOG.md               # 变更日志
```

## 文档导航

- [AGENTS.md](AGENTS.md) - 完整架构、约束和检查清单
- [CHANGELOG.md](CHANGELOG.md) - 变更日志
- [schemas/v2/README.md](schemas/v2/README.md) - Schema 设计说明
- [.claude/GLOSSARY.md](.claude/GLOSSARY.md) - 术语定义
- [.claude/CONVENTIONS.md](.claude/CONVENTIONS.md) - 编码和文档标准

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
