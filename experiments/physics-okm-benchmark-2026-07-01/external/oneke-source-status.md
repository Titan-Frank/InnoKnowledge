# OneKE 官方基线检查记录

官方仓库：`https://github.com/zjunlp/OneKE`

本轮处理：

- 已克隆官方仓库并检查 `README.md`、`requirements.txt`、`src/run.py`、`src/pipeline.py` 和 `examples/config/Triple2KG.yaml`。
- OneKE 支持 API 模型方式和本地模型方式，官方文档推荐 Python 3.9，完整本地链路推荐 GPU。
- OneKE requirements 需要 `torch==2.4.0`、`transformers==4.44.0`、`openai==1.55.3`、`vllm==0.6.0` 等依赖。
- 这些依赖与 DeepKE 可运行环境中的 `torch==1.11.0`、`transformers==4.26.0`、`openai==0.28.0` 冲突。
- 为避免破坏已经修复好的 DeepKE 环境，本轮没有把 OneKE 强行装入同一个知识对象构建环境，也没有把 OneKE 计入正式指标。

后续正式 baseline 接入建议：

1. 单独创建 `okm-kg-oneke-benchmark-20260701` 环境。
2. 对 `requirements.txt` 做 macOS arm64 兼容裁剪，API 模型路径可先跳过 `vllm` 和本地大模型依赖。
3. 写统一 wrapper，把 OKM 金标准段落输入为 OneKE `Triple` 任务，并把输出归一化成 `{nodes, edges, evidence}`。
4. 再使用 `construction-metrics.json` 的同一套指标计算正式结果。
