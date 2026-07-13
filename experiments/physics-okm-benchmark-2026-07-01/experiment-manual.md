# 物理书 OKM 基准实验手册

## 目标

本实验用于支持 `docs/open_knowledge_map_technical_report.tex` 的实证部分。实验分两组：

1. 知识对象构建实验：比较 OKM、OpenIE、DeepKE、OneKE、LLM-only 在教材知识对象抽取上的表现。
2. 知识运行时实验：比较 OKM ApiUnit-RAG、普通文本块 RAG、GraphRAG、LightRAG 在问答生成上的表现。

## 数据

- 教材 Markdown：`data/mineru/physics-hukj-compulsory-3/full.md`
- 数据库数据集：`main`
- 教材编号：`physics-hukj-compulsory-3`
- 金标准：`fixtures/gold-construction.json`
- 运行时问题集：`fixtures/runtime-cases.jsonl`

金标准覆盖 9 个教材段落，跨静电、场、电势、电容、电路、磁场、电磁感应、电磁波和核裂变。当前版本包含 38 个金标准知识对象、33 条金标准关系和 12 个运行时问题。它适合作为单本教材上的受控基准实验；若要写成顶会正式实验，还应扩展到多教材、多学科和多人标注一致性验证。

## 环境

需要 PostgreSQL 已启动，并且根目录 `.env` 至少包含：

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `EMBEDDING_API_KEY`
- `EMBEDDING_URL`
- `EMBEDDING_MODEL`

运行检查：

```bash
npm run build -w packages/types
docker compose ps postgres
node experiments/physics-okm-benchmark-2026-07-01/scripts/run-local-experiments.mjs --env-check
```

如果需要 Python 官方基线，本实验使用两个独立 conda 环境，避免污染仓库或全局 Python：

- `okm-kg-benchmark-20260701`：用于知识对象构建基线，例如 DeepKE、OneKE、Stanford OpenIE 辅助脚本。
- `okm-runtime-benchmark-20260701`：用于知识运行时基线，例如 GraphRAG、LightRAG。

环境创建命令：

```bash
conda create -y -n okm-kg-benchmark-20260701 python=3.8 pip
conda create -y -n okm-runtime-benchmark-20260701 python=3.11 pip
```

DeepKE 当前依赖较旧的 `scikit-learn` 和 `matplotlib`。在 macOS arm64 上需要先通过 conda-forge 安装二进制依赖，再安装 DeepKE：

```bash
conda install -y -n okm-kg-benchmark-20260701 -c conda-forge scikit-learn=0.24.1 matplotlib=3.4.1 libtiff=4.4.0
conda activate okm-kg-benchmark-20260701
uv pip install --python "$(command -v python)" deepke==2.2.7
```

## 一键运行

```bash
node experiments/physics-okm-benchmark-2026-07-01/scripts/run-local-experiments.mjs
```

脚本会生成：

- `outputs/construction-okm.json`
- `outputs/construction-llm-only.json`
- `outputs/construction-openie-lite-local.json`
- `outputs/construction-external-status.json`
- `outputs/construction-metrics.json`
- `outputs/runtime-apiunit-rag.json`
- `outputs/runtime-local-baselines.json`
- `outputs/runtime-metrics.json`
- `outputs/experiment-summary.json`

## 指标

知识对象构建：

- 节点准确率：预测节点中能匹配金标准节点的比例。
- 节点召回率：金标准节点被预测命中的比例。
- 关系准确率：预测关系中能匹配金标准关系的比例。
- 关系召回率：金标准关系被预测命中的比例。
- 证据命中率：命中的金标准节点或关系是否带有能覆盖支持词的证据。
- 重复率：预测节点归一化名称重复比例。
- 虚构率：预测对象没有证据，或证据片段无法在教材样本中找到的比例。
- schema 违规率：节点类型或关系类型不在当前 `world-v1.3` 允许集合中的比例。关系集合由 `schemas/world-knowledge-edge.schema.json` 读取，不在实验脚本中另存旧副本。
- 人工审核成本：需要人工检查的节点、关系、重复项和无证据项的估计数量。

知识运行时：

- 回答正确率：用期望关键词覆盖率近似。
- 证据引用准确率：引用编号是否来自提供给模型的上下文。
- 无依据断言数：模型主动报告的 unsupported claims 数量。
- 跨课时综合能力：跨主题问题的平均关键词覆盖率。
- 先修关系问题：先修关系题的关键词覆盖率。
- 误区诊断问题：误区诊断题的关键词覆盖率。
- 教学生成可用性：模型按统一 rubric 给出的 1 到 5 分。
- 构建成本：索引单元数量、图节点边数量、上下文字符量和模型调用次数。
- 增量更新成本：一段教材变化时估计需要重建的索引单元数量。

## 外部基线说明

本仓库没有内置官方 OpenIE、DeepKE、OneKE、GraphRAG、LightRAG。脚本会检查它们是否已安装或是否通过环境变量提供命令：

- `STANFORD_OPENIE_CMD`
- `DEEPKE_CMD`
- `ONEKE_CMD`
- `GRAPHRAG_CMD`
- `LIGHTRAG_CMD`

若没有配置，脚本会把这些官方基线标记为 `not_run`，并在报告中明确说明。为了让流程先跑通，本实验同时提供：

- `openie-lite-local`：本地规则式开放信息抽取近似基线。
- `graphrag-style-local`：受 GraphRAG 启发的章节社群检索基线，不等同于官方 GraphRAG。
- `lightrag-style-local`：受 LightRAG 启发的低层文本块加高层术语检索基线，不等同于官方 LightRAG。

论文中必须区分官方基线和方法启发版基线，不能混写。

GraphRAG 和 LightRAG 属于第二组“知识运行时实验”。它们主要比较检索、索引、图增强上下文和生成回答的效果，不直接作为第一组“知识对象构建实验”的主要 baseline。第一组更适合比较 OpenIE、DeepKE、OneKE、LLM-only 和 OKM 的对象、关系、证据、重复、虚构与 schema 表现。
