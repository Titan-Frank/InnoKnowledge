# 实验目录

本目录只把可复现实验所需的源码、结构约束和说明文档纳入版本管理。运行产生的 `outputs/`、第三方依赖缓存、临时工作目录，以及尚未完成权利审核的教材衍生测试数据不会提交到仓库。

## 当前实验

- [`okm-eduku-bench-v0.2-2026-07-01`](okm-eduku-bench-v0.2-2026-07-01/README.md)：面向论文的双教材基准设计、标注规范、统一输出结构和评分脚手架。
- [`okm-apiunit-ablation-2026-07-01`](okm-apiunit-ablation-2026-07-01/experiment-manual.md)：评测证据、知识正文、领域画像、图关系和治理步骤贡献的 A0-A7 消融实验。
- [`physics-okm-benchmark-2026-07-01`](physics-okm-benchmark-2026-07-01/experiment-manual.md)：单本物理教材上的受控小样本构建与知识运行时实验。

## 公共工具

- `app/`：实验结果和人工评分工作台前端。
- `scripts/serve-experiment-app.mjs`：本地实验工作台服务，默认监听 `http://127.0.0.1:4187/app/`。
- `runtime-apiunit-grounding-small.jsonl`：服务端知识运行时评测的轻量固定样例。

启动实验工作台：

```bash
node experiments/scripts/serve-experiment-app.mjs
```

## 版本管理边界

应提交：

- 实验脚本、结构约束、评分模板和实验说明。
- 已确认可公开的输入样例和金标准；教材衍生数据必须先完成单独的来源与权利审核。
- 记录实验设计与结论的 Markdown 文档。

默认不提交：

- `outputs/` 下的可再生成结果。
- `external/cache/` 下的第三方源码、模型和工具缓存。
- `external/work/` 下的临时运行目录。
- `data/` 和 `fixtures/` 下尚未完成权利审核的 JSON、JSONL 与 CSV 数据。
- 压缩包、模型权重和本地数据库文件。

如果人工评分表已经填写，不要继续留在被忽略的 `outputs/` 中；应移入单独的受控标注目录，检查隐私和数据权利后再提交。
