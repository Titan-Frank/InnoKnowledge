# Knowledge Map Extraction Project

教材知识图谱构建工具。当前默认从 OCR 完成的教材 markdown 中抽取结构化的知识主干、课程画像、证据链和节点卡。

## 推荐入口

最推荐的入口是 `@kg-pipeline`。

```bash
# 单课
opencode run --agent build "@kg-pipeline 处理 <book-id> 的 <lesson-anchor>，输出到 data/v5"

# 整本书
opencode run --agent build "@kg-pipeline 处理 <book-id> 全书，按 lesson 分批抽取，输出到 data/v5"

# 完整知识模式
opencode run --agent build "@kg-pipeline 以完整知识模式处理 <book-id> 全书，按 lesson 分批抽取，输出到 data/v5"
```

如果要顺序跑多本教材，建议直接按 markdown 书稿逐本调用 `@kg-pipeline`。

## 核心原则

- SQLite 是执行期主写层。
- `data/<version>/` 是按需导出的 snapshot。
- 默认按 lesson 或小批次处理，不做整书大上下文抽取。
- 关系抽取是 retrieval-first，不是 whole-graph free-form generation。
- 默认候选召回使用 LightRAG-inspired `hybrid` 检索；必要时再切到 `local` 或 `mix`。
- GraphRAG / LightRAG 风格的 local subgraph 和 group roll-up 只做辅助分析，不直接当 canonical evidence。

## 最短上手流程

### 1. 抽取 outline

直接让 `@outline-reader` 读取 markdown 的标题层级和页码标记来生成 outline。

常见做法是先人工抽查 markdown 里的结构信号：

```bash
rg -n "^(#{1,6})\\s+|^第[一二三四五六七八九十0-9]+[章单元课节专题主题]|^\\[?Page[[:space:]]+[0-9]+\\]?|^<!--\\s*page:" "/absolute/path/to/book.md"
```

然后让 `@outline-reader` 生成 `data/outlines/<book-id>.outline.json`。

### 2. 初始化 manifest

```bash
python3 scripts/pipeline_manifest.py init \
  --root data/v5 \
  --book-id <book-id>
```

### 3. 如有需要，从 snapshot 恢复 SQLite

只有在已有 `data/<version>/` snapshot、但 SQLite 需要重建时才需要这步：

```bash
python3 scripts/sync_output_root_to_sqlite.py data/v5 \
  --db storage/knowledge.sqlite \
  --replace --activate --preserve-runtime
```

### 4. 跑 pipeline

推荐直接用 `@kg-pipeline`。如果你要人工盯单课，可以直接跑正式 batch closeout：

```bash
python3 scripts/run_sqlite_batch_pipeline.py \
  --root data/v5 \
  --book-id <book-id> \
  --batch-anchor <lesson-anchor> \
  --db storage/knowledge.sqlite
```

这个脚本现在默认会顺序做：

- `apply_batch_artifacts.py`
- `batch_coverage.py`
- `local_subgraph.py`
- `finalize_batch_runtime.py`
- `strict_qa.py`
- `batch_group_rollup.py`

其中：

- `local_subgraph.py` 没有 seeds 时会输出 skipped 报告，不会单独导致 batch 失败
- `batch_group_rollup.py` 会在有 lesson window 时自动生成

### 5. 完成后做最终检查

```bash
python3 scripts/pipeline_manifest.py check \
  --manifest data/v5/runs/<book-id>.pipeline.json \
  --require-final-qa
```

## 常用手工命令

### 启动 Viewer

```bash
python3 scripts/viewer_sqlite_api.py \
  --db storage/knowledge.sqlite \
  --port 8765
```

访问 [http://127.0.0.1:8765/viewer/](http://127.0.0.1:8765/viewer/)

### 调整 batch pipeline 的 GraphRAG 辅助步骤

```bash
python3 scripts/run_sqlite_batch_pipeline.py \
  --root data/v5 \
  --book-id <book-id> \
  --batch-anchor <lesson-anchor> \
  --db storage/knowledge.sqlite \
  --local-subgraph-hops 2 \
  --batch-group-size 4
```

常用参数：

- `--skip-local-subgraph`
- `--local-subgraph-hops 1|2`
- `--local-subgraph-max-neighbors <n>`
- `--local-subgraph-top-k <n>`
- `--local-subgraph-node-id <node-id>`
- `--batch-group-anchors <anchor1,anchor2,...>`
- `--batch-group-size <n>`
- `--skip-batch-group-rollup`

### LightRAG 风格候选检索

`scripts/retrieve_candidates.py` 现在支持多模式候选召回：

- `local`: 只看 canonical name / alias / FTS，最保守
- `global`: 从 lexical seed 出发扩一层关系邻域
- `hybrid`: `local + global`，默认模式
- `mix`: `hybrid + profile/evidence` 文本支持

例子：

```bash
python3 scripts/retrieve_candidates.py 化学平衡 \
  --db storage/knowledge.sqlite \
  --dataset-id v4 \
  --mode hybrid \
  --limit 8

python3 scripts/retrieve_candidates.py 温度 \
  --db storage/knowledge.sqlite \
  --dataset-id v4 \
  --mode mix \
  --limit 8
```

工作口径：

- 默认先用 `hybrid`，让明确词面命中和局部图邻域一起参与候选排序
- 当 lesson 里的术语比较松散、词面召回不足时，再用 `mix`
- 不管哪种模式，候选都只是缩小判断范围，不直接当 evidence

### 导出 snapshot

```bash
python3 scripts/export_snapshot.py data/v5 \
  --db storage/knowledge.sqlite \
  --dataset-id v5
```

### 完整知识模式下补节点卡

```bash
python3 scripts/node_card_targets.py \
  --root data/v5 \
  --book-id <book-id> \
  --anchors <lesson-anchor> \
  --db storage/knowledge.sqlite \
  --missing-only
```

然后用 `@node-expander` 处理这些目标，再复跑：

```bash
python3 scripts/batch_coverage.py \
  --root data/v5 \
  --book-id <book-id> \
  --anchors <lesson-anchor> \
  --db storage/knowledge.sqlite \
  --require-node-cards
```

## 输出位置

执行期主数据在 SQLite。

导出后的 snapshot 结构：

```text
data/<version>/
├── graph/
│   ├── knowledge.nodes.jsonl
│   ├── knowledge.edges.jsonl
│   ├── <book-id>.mentions.jsonl
│   └── <book-id>.evidence.jsonl
├── profiles/
│   └── knowledge.profiles.jsonl
├── node_cards/
├── qa/
└── runs/
    └── <book-id>.pipeline.json
```

另外还有：

- `data/outlines/<book-id>.outline.json`
- `storage/knowledge.sqlite`

## 项目角色

- `@outline-reader`: 提取教材目录
- `@backbone-builder`: 抽取 batch-local backbone 和 runtime artifacts
- `@graph-normalizer`: 做小范围归一化和保守提升
- `@qa-reviewer`: 做只读 QA 复核
- `@node-expander`: 扩展节点卡
- `@kg-pipeline`: 负责编排完整流程

## 低层脚本怎么理解

平时优先用两层入口：

- 编排入口：`@kg-pipeline`
- 单批正式入口：`scripts/run_sqlite_batch_pipeline.py`

这些低层脚本一般只在调试、恢复、或局部重跑时直接使用：

- `scripts/store_batch_runtime.py`
- `scripts/apply_batch_artifacts.py`
- `scripts/finalize_batch_runtime.py`
- `scripts/retrieve_candidates.py`（默认 `--mode hybrid`）
- `scripts/local_subgraph.py`
- `scripts/batch_group_rollup.py`
- `scripts/strict_qa.py`

## 更多规则

更严格的执行约束、preservation policy、output contract 和 schema 约束见 [AGENTS.md](AGENTS.md)。
