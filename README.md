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

# 完整知识模式（自动把当前 batch 的主干节点纳入节点卡扩展）
opencode run --agent build "@kg-pipeline 以完整知识模式处理 <book-id> 的 <lesson-anchor>"
```

严格模式下，`@kg-pipeline` 应先确定 `data/<version>/` 输出根，再初始化运行清单并在每批后执行严格 QA。
当前推荐架构是：SQLite 作为主写数据库，`data/<version>/` 作为从 SQLite 导出的 snapshot，供 viewer / Git / 发布使用。

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
└── v4/                 # 示例输出根（实际使用 data/<version>/）
    ├── graph/          # 节点、边、mentions、evidence
    ├── profiles/       # 课程画像
    ├── node_cards/     # 节点卡
    ├── qa/             # 严格 QA 报告
    └── runs/           # pipeline manifest
```

## 工作流程

1. 准备教材 PDF，分配 `book-id`
2. 抽取目录骨架 → `data/outlines/<book-id>.outline.json`
3. 按 lesson 抽取证据和局部节点，直接写入 SQLite
4. 先检索候选节点，再做局部关系判断
5. 对局部关系做小范围归一化和跨课链接
6. 从 SQLite 导出 `data/<version>/` snapshot
7. QA 检查
8. 为重要节点生成节点卡

## 关系抽取架构

- 不做整库大上下文关系抽取
- 先检索 top-k 候选节点，再判断复用 / 新建 / 建边
- 先抽本课局部关系，再做小范围归一化
- 所有 canonical edge 都必须有明确 evidence anchor
- 新边如果和旧边冲突，先进入 review，不直接覆盖

**建议粒度**：一次处理一课或一小段页码，避免整本书一次性抽取。

SQLite 运行时链路可以按下面的顺序验证：

```bash
# 老库先升级 runtime schema，补 relation_proposal evidence_links 能力
python3 scripts/upgrade_sqlite_runtime_schema.py --db storage/knowledge.sqlite --apply

# 召回候选节点
python3 scripts/retrieve_candidates.py 氧气 \
  --db storage/knowledge.sqlite \
  --dataset-id v3 \
  --batch-anchor lesson-2-1-2 \
  --write --replace

# 写入关系提案
python3 scripts/store_relation_proposals.py \
  --db storage/knowledge.sqlite \
  --dataset-id v3 \
  --input /tmp/relation-proposals.jsonl \
  --replace

# 提升无冲突且证据充分的提案
python3 scripts/promote_relation_proposals.py \
  --db storage/knowledge.sqlite \
  --dataset-id v3 \
  --batch-anchor lesson-2-1-2

# 统一做 SQLite QA
python3 scripts/sqlite_import_qa.py \
  --db storage/knowledge.sqlite \
  --output-root data/v3
```

如果由 `@kg-pipeline` 驱动，推荐把这两步当成默认入口：

```bash
# 只有在从旧 snapshot 恢复数据库时，才需要这步 bootstrap
python3 scripts/sync_output_root_to_sqlite.py data/v5 \
  --db storage/knowledge.sqlite \
  --replace --activate --preserve-runtime

# 每批 backbone 写完后，统一完成 proposal -> promote -> snapshot export -> SQLite QA
python3 scripts/finalize_batch_runtime.py \
  --root data/v5 \
  --book-id <book-id> \
  --batch-anchor <anchor-id> \
  --db storage/knowledge.sqlite
```

如果当前 batch 的中间产物是刚抽出来的，推荐先直接写入 SQLite staging，而不是依赖 runtime JSONL 作为唯一中间层：

```bash
python3 scripts/store_batch_runtime.py \
  --root data/v5 \
  --book-id <book-id> \
  --batch-anchor <anchor-id> \
  --db storage/knowledge.sqlite \
  --queries-file /tmp/<anchor-id>.queries.jsonl \
  --nodes-file /tmp/<anchor-id>.nodes.jsonl \
  --profiles-file /tmp/<anchor-id>.profiles.jsonl \
  --evidence-file /tmp/<anchor-id>.evidence.jsonl \
  --mentions-file /tmp/<anchor-id>.mentions.jsonl \
  --relation-proposals-file /tmp/<anchor-id>.relation-proposals.jsonl
```

然后再应用和 finalize：

```bash
python3 scripts/apply_batch_artifacts.py \
  --root data/v5 \
  --book-id <book-id> \
  --batch-anchor <anchor-id> \
  --db storage/knowledge.sqlite

python3 scripts/finalize_batch_runtime.py \
  --root data/v5 \
  --book-id <book-id> \
  --batch-anchor <anchor-id> \
  --db storage/knowledge.sqlite
```

如果一个 batch 的 runtime 工件已经准备好，也可以直接用单命令把整条 SQLite 流程走完：

```bash
python3 scripts/run_sqlite_batch_pipeline.py \
  --root data/v5 \
  --book-id <book-id> \
  --batch-anchor <anchor-id> \
  --db storage/knowledge.sqlite
```

`<anchor-id>` 推荐使用 outline 里的 canonical id，例如 `struct:chem-grade8-all-in-one:lesson:1-1-1`。批处理脚本也兼容常见简写如 `lesson-1-1-1`，但入库后的 `anchor_ref`、`batch_anchor` 和导出的 snapshot 会统一归一化成 canonical outline id。

如果只想把 viewer 所需 snapshot 从数据库重新导出：

```bash
python3 scripts/export_snapshot.py data/v5 \
  --db storage/knowledge.sqlite \
  --dataset-id v5
```

如果一个 batch 的抽取结果已经先写到了 runtime 工件目录，可以直接应用到 SQLite：

```bash
python3 scripts/apply_batch_artifacts.py \
  --root data/v5 \
  --book-id <book-id> \
  --batch-anchor <anchor-id> \
  --db storage/knowledge.sqlite
```

`apply_batch_artifacts.py` 现在默认优先读取 SQLite `batch_runtime_records` 里的 batch 数据；如果 SQLite staging 里没有这批记录，才会回退去读下面这些 runtime 文件：

- `data/v5/runs/runtime/<book-id>/<anchor-id>.nodes.jsonl`
- `data/v5/runs/runtime/<book-id>/<anchor-id>.profiles.jsonl`
- `data/v5/runs/runtime/<book-id>/<anchor-id>.evidence.jsonl`
- `data/v5/runs/runtime/<book-id>/<anchor-id>.mentions.jsonl`
- `data/v5/runs/runtime/<book-id>/<anchor-id>.node-cards.jsonl`
- `data/v5/runs/runtime/<book-id>/<anchor-id>.queries.jsonl`
- `data/v5/runs/runtime/<book-id>/<anchor-id>.relation-proposals.jsonl`

如果需要把 SQLite staging 里的某个 batch 重新导出成 JSONL 调试文件，可以用：

```bash
python3 scripts/export_batch_runtime.py \
  --root data/v5 \
  --book-id <book-id> \
  --batch-anchor <anchor-id> \
  --db storage/knowledge.sqlite
```

## 严格模式

建议在 `@kg-pipeline` 中把下面两步作为默认动作：

```bash
# 初始化运行清单
python3 scripts/pipeline_manifest.py init \
  --root data/v4 \
  --book-id <book-id>

# 每批后执行严格 QA
python3 scripts/strict_qa.py \
  --root data/v4 \
  --book-id <book-id>
```

```bash
# 检查当前 batch 的 mention/evidence 覆盖
python3 scripts/batch_coverage.py \
  --root data/v4 \
  --book-id <book-id> \
  --anchors <anchor-id>

# 列出当前 batch 缺失节点卡的主干节点
python3 scripts/node_card_targets.py \
  --root data/v4 \
  --book-id <book-id> \
  --anchors <anchor-id> \
  --missing-only
```

严格模式的完成条件：

1. 每个 batch 的 `backbone -> normalize -> qa` 均已完成。
2. 最终 QA 已完成。
3. `python3 scripts/pipeline_manifest.py check --manifest data/<version>/runs/<book-id>.pipeline.json --require-final-qa` 通过。

如果用户要求“完整知识”，还要额外满足：

1. 当前 batch 的 backbone 节点 mention/evidence 覆盖已通过 `batch_coverage.py`。
2. 当前 batch 缺失的 backbone node card 已通过 `node_card_targets.py` 找出并补齐。

## 关键文件

- [AGENTS.md](AGENTS.md) - 项目规则
- [schemas/v2/](schemas/v2/) - Schema 定义
- [.opencode/agents/](.opencode/agents/) - Agent 定义
- [.opencode/skills/](.opencode/skills/) - Skill 定义
