# Knowledge Backbone Project

使用 OpenCode 从教材与课标中构建“统一知识主干网络”，并在每个主干节点上继续扩展为结构化说明卡。

这个项目当前采用四层结构：

- `framework`：课标参考框架
- `backbone`：统一知识主干节点与关系
- `node_cards`：单节点详细说明卡
- `provenance`：教材目录、mentions、evidence

## 当前目录

- 项目规则：[AGENTS.md](/Users/titan-frank/Documents/hsd/research/Knowledge/AGENTS.md)
- 项目 agents：[.opencode/agents/](/Users/titan-frank/Documents/hsd/research/Knowledge/.opencode/agents)
- 项目 skills：[.opencode/skills/](/Users/titan-frank/Documents/hsd/research/Knowledge/.opencode/skills)
- schema：[schemas/](/Users/titan-frank/Documents/hsd/research/Knowledge/schemas)
- 输出目录：[data/](/Users/titan-frank/Documents/hsd/research/Knowledge/data)

## 已有输出

- 教材目录骨架：[data/outlines/](/Users/titan-frank/Documents/hsd/research/Knowledge/data/outlines)
- 课标框架：[data/frameworks/junior-chemistry-framework.json](/Users/titan-frank/Documents/hsd/research/Knowledge/data/frameworks/junior-chemistry-framework.json)
- 扩展模式库：[data/patterns/junior-chemistry-patterns.json](/Users/titan-frank/Documents/hsd/research/Knowledge/data/patterns/junior-chemistry-patterns.json)
- 知识主干：[data/graph/knowledge.nodes.jsonl](/Users/titan-frank/Documents/hsd/research/Knowledge/data/graph/knowledge.nodes.jsonl) 和 [data/graph/knowledge.edges.jsonl](/Users/titan-frank/Documents/hsd/research/Knowledge/data/graph/knowledge.edges.jsonl)
- 八年级样例 provenance：[data/graph/chem-sh-8.mentions.jsonl](/Users/titan-frank/Documents/hsd/research/Knowledge/data/graph/chem-sh-8.mentions.jsonl) 和 [data/graph/chem-sh-8.evidence.jsonl](/Users/titan-frank/Documents/hsd/research/Knowledge/data/graph/chem-sh-8.evidence.jsonl)

注意：

- 样例 provenance 已统一整理到 `chem-sh-8.*` 命名。
- 原始教材 PDF 因为体积过大，不会纳入 GitHub 仓库版本管理；请在本地自行保留。

## 环境准备

1. 安装 OpenCode。
2. 配置模型提供商凭据。
3. 在项目根目录运行命令。

常用初始化命令：

```bash
opencode auth login
opencode auth list
opencode models
```

进入项目目录：

```bash
cd /Users/titan-frank/Documents/hsd/research/Knowledge
```

## 两种使用方式

### 方式一：交互式

启动 TUI：

```bash
opencode
```

进入后可直接输入：

```text
@outline-reader 为 chem-sh-8 刷新教材目录骨架
@backbone-builder 基于 chem-sh-8 的 struct:chem-sh-8:lesson:2-1-1 更新知识主干
@node-expander 为 substance:oxygen 生成节点卡
@graph-normalizer 清理和归一化当前知识主干
@qa-reviewer 检查当前输出中的重复节点、缺失证据和不合理关系
```

### 方式二：脚本式

推荐用 `build` 作为主 agent，然后在 prompt 中 `@` 调项目内 subagent。

刷新教材目录骨架：

```bash
opencode run --agent build "@outline-reader 为 chem-sh-8 刷新教材目录骨架"
```

构建一课的知识主干：

```bash
opencode run --agent build "@backbone-builder 基于 chem-sh-8 的 struct:chem-sh-8:lesson:2-1-1 更新知识主干，只抽稳定、可复用的核心知识点与关系"
```

扩展单个节点卡：

```bash
opencode run --agent build "@node-expander 为 substance:oxygen 生成或更新节点卡，要求引用已有 mentions 与 evidence"
```

归一化主干图：

```bash
opencode run --agent build "@graph-normalizer 归一化 data/graph/knowledge.nodes.jsonl 和 data/graph/knowledge.edges.jsonl，保留 provenance"
```

只做审查：

```bash
opencode run --agent build "@qa-reviewer 审查当前知识主干、node cards、mentions、evidence 的一致性"
```

跑整条项目流水线：

```bash
opencode run --agent build "@kg-pipeline 处理 chem-sh-8 的 struct:chem-sh-8:lesson:2-1-1，从主干抽取到 QA 完成"
```

## 可做的操作

### 1. 刷新教材目录骨架

用途：

- 从 PDF 目录中提取 `theme/topic/lesson/activity/review`
- 为后续抽取提供稳定锚点

对应 agent：

- `@outline-reader`

主要输出：

- `data/outlines/<book-id>.outline.json`

### 2. 构建知识主干

用途：

- 从某一课或一小段页码中提取高价值、稳定、可复用的知识节点和关系
- 只保留稀疏主干，不把所有细节都塞进图里

对应 agent：

- `@backbone-builder`

主要输出：

- `data/graph/knowledge.nodes.jsonl`
- `data/graph/knowledge.edges.jsonl`
- `data/graph/<book-id>.mentions.jsonl`
- `data/graph/<book-id>.evidence.jsonl`

### 3. 扩展节点说明卡

用途：

- 把单个 canonical node 展开成结构化说明卡
- 根据 pattern 决定节点卡应该有哪些 section

对应 agent：

- `@node-expander`

主要输出：

- `data/node_cards/<safe-node-id>.json`

命名规则：

- `safe-node-id = node_id` 中所有 `:` 替换为 `__`
- 例如 `substance:oxygen` -> `data/node_cards/substance__oxygen.json`

### 4. 归一化与去重

用途：

- 合并明显重复的 canonical node
- 整理 alias
- 清理重复 edge

对应 agent：

- `@graph-normalizer`

### 5. QA 审查

用途：

- 检查 schema 形状
- 检查缺证据、坏锚点、孤立关系、重复节点
- 检查 node card 是否与 pattern 匹配

对应 agent：

- `@qa-reviewer`

### 6. 跑完整流水线

用途：

- 针对某一课，从 outline -> backbone -> normalize -> QA 串起来

对应 agent：

- `@kg-pipeline`

## 推荐工作流

### A. 新增一本教材

```bash
opencode run --agent build "@outline-reader 为 chem-sh-9 刷新教材目录骨架"
```

### B. 处理一课

```bash
opencode run --agent build "@backbone-builder 基于 chem-sh-8 的 struct:chem-sh-8:lesson:2-1-1 更新知识主干"
```

### C. 选一个重要节点扩展

```bash
opencode run --agent build "@node-expander 为 concept:chemical-change 生成节点卡"
```

### D. 做一次归一化与审查

```bash
opencode run --agent build "@graph-normalizer 归一化当前知识主干"
opencode run --agent build "@qa-reviewer 审查当前知识主干和节点卡"
```

## 可附加的常用 CLI 选项

继续上次 session：

```bash
opencode run -c "继续刚才的主干抽取"
```

指定 session：

```bash
opencode session list
opencode run -s <session-id> "继续处理 oxygen 节点卡"
```

指定模型：

```bash
opencode run --agent build -m anthropic/claude-sonnet-4 "@backbone-builder 基于 chem-sh-8 的 struct:chem-sh-8:lesson:2-1-1 更新知识主干"
```

附加文件：

```bash
opencode run --agent build -f notes.txt "@node-expander 为 concept:chemical-change 生成节点卡"
```

输出 JSON 事件流：

```bash
opencode run --agent build --format json "@qa-reviewer 审查当前知识主干"
```

## 后端服务模式

如果你会频繁运行 `opencode run`，可以先启动一个 headless server，再让后续命令 attach 上去，减少冷启动成本。

启动服务：

```bash
opencode serve --hostname 127.0.0.1 --port 4096
```

附着运行：

```bash
opencode run --attach http://127.0.0.1:4096 --agent build "@backbone-builder 基于 chem-sh-8 的 struct:chem-sh-8:lesson:2-1-1 更新知识主干"
```

## 输出文件在哪里

核心输出位置：

- `data/outlines/`
- `data/frameworks/`
- `data/patterns/`
- `data/graph/`
- `data/node_cards/`

重点文件：

- [data/graph/knowledge.nodes.jsonl](/Users/titan-frank/Documents/hsd/research/Knowledge/data/graph/knowledge.nodes.jsonl)
- [data/graph/knowledge.edges.jsonl](/Users/titan-frank/Documents/hsd/research/Knowledge/data/graph/knowledge.edges.jsonl)
- [data/frameworks/junior-chemistry-framework.json](/Users/titan-frank/Documents/hsd/research/Knowledge/data/frameworks/junior-chemistry-framework.json)
- [data/patterns/junior-chemistry-patterns.json](/Users/titan-frank/Documents/hsd/research/Knowledge/data/patterns/junior-chemistry-patterns.json)

## 小提示

- 当前机器在无网状态下，`opencode --help`、`opencode run --help` 之类命令可能先报 `models.dev` 连接错误。
- 本项目更推荐先做 `backbone-builder`，再做 `node-expander`，不要一开始就试图把全书直接扩成密集图谱。
- 如果你在 `run` 模式里直接指定自定义 subagent 遇到限制，优先使用 `--agent build` 加 `@subagent` 的方式。

## 参考文档

- [CLI | OpenCode](https://opencode.ai/docs/cli/)
- [Agents | OpenCode](https://opencode.ai/docs/agents/)
- [Skills | OpenCode](https://opencode.ai/docs/skills/)
- [Rules | OpenCode](https://opencode.ai/docs/rules/)
