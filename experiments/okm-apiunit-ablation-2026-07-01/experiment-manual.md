# OKM ApiUnit 消融实验手册

## 目标

本目录独立评测 OKM 的 A0-A7 消融组，不复用正在进行的 `physics-okm-benchmark-2026-07-01` 输出目录，也不修改正式 API、viewer 或 canonical 数据表。

实验回答的问题是：证据锚定、知识正文、领域画像、图关系、关系扩展、质量治理和完整 `ApiUnit` 返回，分别对对象级检索、证据化回答和教学可用性贡献多少。

## 数据

- 默认数据集：`main`
- 默认题目：`data/runtime-cases-ablation.jsonl`
- 题量：72 题
- 题型：`definition`、`fact_relation`、`conceptual_reasoning`、`misconception`、`prerequisite`、`cross_lesson` 各 12 题

## 消融组

| 组别 | 含义 |
| --- | --- |
| A0 | 完整 OKM，上下文包含完整 `ApiUnit`，并允许一跳关系扩展 |
| A1 | 移除证据锚定，不提供 `evidence`、`source_fragments` 和 `source_refs` |
| A2 | 移除 `node_bodies`，只用节点、卡片、证据、画像和关系 |
| A3 | 移除 `domain_profiles` 和 `pedagogical_profile` |
| A4 | 不使用图关系，只用对象向量召回，并从上下文移除关系 |
| A5 | 不做关系扩展，只返回 top-k 种子单元 |
| A6 | 使用 raw staging 结果，不经过 QA、normalize、merge |
| A7 | 只返回节点骨架，不返回完整 `ApiUnit` |

## 运行

只跑检索和结构检查：

```bash
node experiments/okm-apiunit-ablation-2026-07-01/scripts/run-ablation.mjs --smoke
```

跑完整 72 题检索：

```bash
node experiments/okm-apiunit-ablation-2026-07-01/scripts/run-ablation.mjs
```

调用模型生成回答：

```bash
node experiments/okm-apiunit-ablation-2026-07-01/scripts/run-ablation.mjs --generate
```

生成盲评表：

```bash
node experiments/okm-apiunit-ablation-2026-07-01/scripts/build-review-sheet.mjs
```

启动盲评前端：

```bash
node experiments/okm-apiunit-ablation-2026-07-01/scripts/serve-review-app.mjs
```

默认地址为 `http://127.0.0.1:4187/review-app/`。这个本地服务只开放 `blind-review-sheet.jsonl` 和 `human-scores.csv`，不会向评分人暴露 `blind-review-key.json`。

如果要让 A0/A5 使用预先写入的 `world_unit_embeddings`，可以加：

```bash
node experiments/okm-apiunit-ablation-2026-07-01/scripts/run-ablation.mjs --use-db-embeddings
```

默认不启用这个选项，是为了避免 A1-A3 等消融组从完整单元向量里偷看到已移除字段。

A4 本身定义为对象向量召回，因此只要环境里配置了 `EMBEDDING_API_KEY`，运行 A4 时会调用查询向量服务；如果缺少向量服务，A4 会返回空召回并在结果诊断中标记为 unavailable。

## 输出

- `outputs/variant-results.json`：每题每组的检索和生成结果
- `outputs/retrieval-metrics.json`：按方法和题型聚合的辅助指标
- `outputs/ablation-summary.json`：论文表格可读摘要
- `outputs/ablation-report.md`：自动生成的简报
- `outputs/blind-review-sheet.jsonl`：人工盲评输入
- `outputs/human-scores.csv`：人工评分表
- `outputs/blind-review-key.json`：方法匿名映射，不给评分人看
- `outputs/ai-assisted-scores.csv`：AI 辅助预评分，只作为人工评分前的参考和前端看板演示数据
- `review-app/`：盲评前端静态文件
- `scripts/serve-review-app.mjs`：盲评前端本地服务、评分写回接口和评分看板只读汇总接口

## 人工评分

主指标为 3 到 15 分，三项各 1 到 5 分：

- 正确性：答案是否准确回应问题，概念、事实、推理和结论是否无明显错误。
- 证据支撑性：关键结论是否能由引用和上下文支撑，是否避免脱离材料的断言。
- 教学可用性：表达是否清楚、有层次，是否适合学生理解并有助于纠错或迁移。

建议两个评分人独立评分。若总分差异超过 1 分，进入仲裁。论文主表使用人工评分，关键词覆盖率、引用准确率和检索命中率只作为辅助指标。

盲评前端内置评分看板，可在“人工评分”和“AI 辅助预评分”之间切换。看板显示完成度、三项均分、方法均分、题型均分、总分分布和低分复核条目。点击低分复核条目可以跳到对应问题、回答、引用和预评分详情；其中 AI 辅助预评分不能替代人工盲评结果。

每条详情页还提供“召回与模型提示词”折叠调试区，用于实验复核召回模式、embedding 使用情况、召回节点、上下文长度和生成提示词。该区域会暴露 A0-A7 消融组标签，不应在正式盲评时展开或展示给评分人。

## 边界

A6 是构建治理消融，脚本只读取 `world_staging_*`，不读取 canonical 映射，不把 raw 结果写入 `world_*` 正式表。它的构建指标目前是 proxy 指标；如果要正式计算节点 F1 和关系 F1，需要另行提供金标准构建文件。
