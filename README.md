# Knowledge Map Extraction Project

这个项目现在的目标是：用 OpenCode 的本地 `agents + skills`，把教材内容抽成一个“全学段、跨学科、统一知识地图”的主干网络，再在单个节点上继续扩展节点卡。

当前默认抽取目标已经迁移到 V2：

- 主干节点与关系写入 `data/v2/graph/`
- 学段/学科画像写入 `data/v2/profiles/`
- 节点卡写入 `data/v2/node_cards/`
- 教材 provenance 写入 `data/v2/graph/<book-id>.mentions.jsonl` 和 `data/v2/graph/<book-id>.evidence.jsonl`

`data/graph/`、`data/node_cards/` 仍然保留给旧 viewer 和兼容流程使用，但不再是新的默认抽取目标。

## 现在到底是不是用 OpenCode agents + skills 抽取

是。

现在推荐的抽取方式是：

- 用 `.opencode/agents/` 里的项目 agent 作为任务入口
- 用 `.opencode/skills/` 里的项目 skill 作为底层执行规范
- 用 `AGENTS.md` 约束整个项目的输出契约、证据规则和 V2 路径

对应关系大致如下：

- `@outline-reader`
  内部使用 `$textbook-outline`
- `@backbone-builder`
  内部使用 `$chapter-extract` + `$knowledge-schema`
- `@graph-normalizer`
  内部使用 `$graph-normalize` + `$knowledge-schema`
- `@node-expander`
  内部使用 `$knowledge-schema`
- `@qa-reviewer`
  只读检查，不写文件
- `@kg-pipeline`
  串起 outline -> backbone -> normalize -> optional node card -> QA

也就是说，现在不是“手工按 schema 硬写 JSON”，而是应该通过 OpenCode 的 agent/skill 流水线来驱动抽取。

## 关键文件

- 项目规则：[AGENTS.md](/Users/titan-frank/Documents/hsd/research/Knowledge/AGENTS.md)
- 项目 agents：[.opencode/agents/](/Users/titan-frank/Documents/hsd/research/Knowledge/.opencode/agents)
- 项目 skills：[.opencode/skills/](/Users/titan-frank/Documents/hsd/research/Knowledge/.opencode/skills)
- V2 schema：[schemas/v2/](/Users/titan-frank/Documents/hsd/research/Knowledge/schemas/v2)
- V2 pattern library：[data/patterns/unified-knowledge-patterns.v2.json](/Users/titan-frank/Documents/hsd/research/Knowledge/data/patterns/unified-knowledge-patterns.v2.json)
- V2 输出目录：[data/v2/](/Users/titan-frank/Documents/hsd/research/Knowledge/data/v2)

## 从零开始的正确流程

建议严格按这个顺序跑，而且一次只处理一本教材里的“一课”或“一小段页码”。

1. 准备教材 PDF，并给它稳定的 `book-id`
2. 先抽目录骨架，生成 `data/outlines/<book-id>.outline.json`
3. 再按某一课或某个 outline anchor 抽知识主干
4. 对主干做保守归一化
5. 做一次只读 QA
6. 只给真正稳定、重要的节点生成 node card

不要一开始就整本书全量抽图谱，也不要先按章节树做知识树。教材章节现在只作为 provenance anchor，不再作为主知识结构。

## 推荐命令

先进入项目根目录：

```bash
cd /Users/titan-frank/Documents/hsd/research/Knowledge
```

### 1. 交互式运行

```bash
opencode
```

进入后直接输入：

```text
@outline-reader 为 chem-grade8-all-in-one 刷新教材目录骨架，PDF 在 references/books/chem-grade8-all-in-one.pdf
@backbone-builder 基于 chem-grade8-all-in-one 的 struct:chem-grade8-all-in-one:lesson:2-1-1 更新 V2 知识主干，只抽稳定、可复用的核心节点与关系
@graph-normalizer 归一化当前 V2 主干图，保留 profiles、mentions、evidence
@qa-reviewer 检查当前 V2 输出中的重复节点、缺失证据、坏锚点和不合理关系
@node-expander 为 entity/substance:oxygen 生成或更新 V2 节点卡
```

### 2. 非交互式运行

最稳妥的方式仍然是用外层执行 agent `build`，然后在 prompt 里调用项目 subagent：

```bash
opencode run --agent build "@outline-reader 为 chem-grade8-all-in-one 刷新教材目录骨架，PDF 在 references/books/chem-grade8-all-in-one.pdf"
```

```bash
opencode run --agent build "@backbone-builder 基于 chem-grade8-all-in-one 的 struct:chem-grade8-all-in-one:lesson:2-1-1 更新 V2 知识主干，只抽稳定、可复用的核心节点与关系"
```

```bash
opencode run --agent build "@graph-normalizer 归一化当前 data/v2/graph/knowledge.nodes.jsonl、data/v2/graph/knowledge.edges.jsonl 与 data/v2/profiles/knowledge.profiles.jsonl，保留 provenance"
```

```bash
opencode run --agent build "@qa-reviewer 审查当前 V2 主干、profiles、node cards、mentions、evidence 的一致性"
```

```bash
opencode run --agent build "@node-expander 为 entity/substance:oxygen 生成或更新 V2 节点卡，要求引用已有 mentions 与 evidence"
```

### 3. 跑整条流水线

如果目录骨架已存在，最推荐直接这样跑：

```bash
opencode run --agent build "@kg-pipeline 处理 chem-grade8-all-in-one 的 struct:chem-grade8-all-in-one:lesson:2-1-1，默认写入 data/v2，从主干抽取到 QA 完成"
```

如果目录骨架还不存在，可以直接把要求写进去：

```bash
opencode run --agent build "@kg-pipeline 处理 chem-grade8-all-in-one，先根据 references/books/chem-grade8-all-in-one.pdf 生成 outline，再处理 struct:chem-grade8-all-in-one:lesson:2-1-1，默认写入 data/v2"
```

## 输出文件在哪里

新的默认输出都在 `data/v2/`：

- outline：[data/outlines/](/Users/titan-frank/Documents/hsd/research/Knowledge/data/outlines)
- canonical nodes：[data/v2/graph/knowledge.nodes.jsonl](/Users/titan-frank/Documents/hsd/research/Knowledge/data/v2/graph/knowledge.nodes.jsonl)
  其中每个节点现在都包含 `node_kind + node_subkind + node_layer`
- canonical edges：[data/v2/graph/knowledge.edges.jsonl](/Users/titan-frank/Documents/hsd/research/Knowledge/data/v2/graph/knowledge.edges.jsonl)
- curriculum profiles：[data/v2/profiles/knowledge.profiles.jsonl](/Users/titan-frank/Documents/hsd/research/Knowledge/data/v2/profiles/knowledge.profiles.jsonl)
- mentions：[data/v2/graph/](/Users/titan-frank/Documents/hsd/research/Knowledge/data/v2/graph)
- node cards：[data/v2/node_cards/](/Users/titan-frank/Documents/hsd/research/Knowledge/data/v2/node_cards)

命名规则：

- `mentions` 和 `evidence` 文件名是 `data/v2/graph/<book-id>.mentions.jsonl` 与 `data/v2/graph/<book-id>.evidence.jsonl`
- `node card` 文件名是 `safe-node-id = node_id.replace(\":\", \"__\").replace(\"/\", \"__\")`
- 例如 `entity/substance:oxygen` -> `data/v2/node_cards/entity__substance__oxygen.json`

## 当前 viewer 的关系

当前前端查看器已经支持切换数据源：

- `v1`：legacy `data/graph/` + `data/node_cards/`
- `v2`：`data/v2/graph/` + `data/v2/profiles/` + `data/v2/node_cards/`
- `vx`：自定义实验版本

也就是说：

- 新抽取流程默认写 `data/v2/`
- viewer 可以直接切到 `v2` 看结果
- `v2` 节点里的 `node_layer` 会驱动“主干 / 支撑”分层展示

## 常用辅助命令

继续上次 session：

```bash
opencode run -c "继续刚才的 V2 主干抽取"
```

指定 session：

```bash
opencode session list
opencode run -s <session-id> "继续处理 entity/substance:oxygen 的节点卡"
```

指定模型：

```bash
opencode run --agent build -m anthropic/claude-sonnet-4 "@backbone-builder 基于 chem-grade8-all-in-one 的 struct:chem-grade8-all-in-one:lesson:2-1-1 更新 V2 知识主干"
```

附加文件：

```bash
opencode run --agent build -f notes.txt "@qa-reviewer 审查当前 V2 输出并结合附件说明问题"
```

输出 JSON 事件流：

```bash
opencode run --agent build --format json "@qa-reviewer 审查当前 V2 主干"
```

## 后端服务模式

如果你会频繁运行 `opencode run`，可以先启动一个本地 server，再让后续命令 attach 上去：

```bash
opencode serve --hostname 127.0.0.1 --port 4096
```

然后：

```bash
opencode run --attach http://127.0.0.1:4096 --agent build "@kg-pipeline 处理 chem-grade8-all-in-one 的 struct:chem-grade8-all-in-one:lesson:2-1-1，默认写入 data/v2"
```

## 注意事项

- 当前机器如果离线，`opencode --help` 一类命令可能先打印一条 `models.dev` 连接错误，但 `opencode run --help` 本身仍可正常显示参数。
- 新流程默认是 V2 抽取，不会主动覆盖 `data/graph/` 和 `data/node_cards/`。
- 如果你确实还要兼容旧 viewer，需要明确告诉 agent 输出 legacy 兼容文件。
- 最推荐的工作粒度仍然是“一课一抽”，不要整本书一次性抽。

## 参考

- [AGENTS.md](/Users/titan-frank/Documents/hsd/research/Knowledge/AGENTS.md)
- [schemas/v2/README.md](/Users/titan-frank/Documents/hsd/research/Knowledge/schemas/v2/README.md)
- [data/v2/README.md](/Users/titan-frank/Documents/hsd/research/Knowledge/data/v2/README.md)
