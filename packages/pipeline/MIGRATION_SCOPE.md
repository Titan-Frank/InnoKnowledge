# Pipeline Migration Scope

目标是把 Python 流水线逐步迁移到 TypeScript，但业务输出必须和 Python 对齐。TypeScript 可以按系统边界重组，不需要逐行照搬 Python，也不应该继续平铺大量文件。

## 目录方向

当前目标结构：

```text
packages/pipeline/src/
  outline/
  extraction/
  staging/
  merge/
  retrieval/
  normalize/
  qa/
  shared/
```

每个目录按业务阶段放少量文件。测试可以和实现文件放在同一目录，便于做 Python 对齐测试。

## 阶段边界

| 阶段 | Python 参考 | TypeScript 状态 | 是否属于狭义抽取 |
| --- | --- | --- | --- |
| 运行前 PostgreSQL 检查 | 旧 `scripts/check_postgres_ready.py` 已删除 | 已新增 `src/shared/postgres-readiness.ts` 和 `check-postgres` TypeScript 命令行入口；`server-pipeline-run` 开头会记录 `check_postgres` 阶段 | 否，是运行前门禁 |
| 源 Markdown 准备 | 旧 `scripts/mineru_extract_pdf.py` 已删除 | 已新增 `src/outline/mineru-source.ts` 和 `src/outline/source-preparation.ts`；`server-pipeline-run` 可用 TypeScript 调 MinerU 准备 Markdown，也可导入已有 Markdown | 否，只准备模型输入，不做知识抽取 |
| PDF/Markdown outline | 旧 `textbook-outline` 脚本、旧 harness outline 对齐逻辑已删除 | 已新增 `src/outline/pdf-outline.ts`；缺少 outline 时可用 `pdftotext` 从 PDF 目录页生成 theme/lesson outline，并和 MinerU Markdown 对齐 `md_start/md_end` | 是，抽取前准备 |
| 目录分块 | 旧 `scripts/chunk_outline.py` 已删除 | `src/outline/*`；`server-pipeline-run` 会在缺少 chunk 时补齐 chunk outline | 是，抽取前准备 |
| 批次编排 | 旧 `scripts/parallel_batch_runner.py`、`scripts/run_parallel_lesson_pipeline.py` 已删除 | `src/extraction/*` 中已有批次计划、TypeScript 抽取命令计划和批后归并流水线执行入口；批后归并流水线现在直接执行 merge/normalize/QA/integrity 并最终标记 `qa_passed` | 是，负责调度 |
| 单课抽取 | 旧 `scripts/extract_lesson_openai.py` 已删除 | 已新增模型抽取边界、`extract-lesson-openai` TypeScript 命令、检索上下文加载和受控 staging 写入；服务端类型和调试页已收窄为模型抽取选项；旧 Python 单课抽取脚本和旧本地规则抽取脚本均已删除，失败兜底参数只保留拒绝校验 | 是，核心抽取 |
| 写入暂存 | 旧 `scripts/store_lesson_staging.py` 已删除 | `src/staging/*` 中已有纯逻辑、SQL 计划和 PostgreSQL 写入；`extract-lesson-openai --write-staging` 与独立 `store-staging --db` 都会在写入前做 staging 完整性检查；旧暂存写入旁路已删除 | 否，是抽取后的落库阶段 |
| 暂存质量检查 | 旧 `scripts/check_lesson_staging_quality.py` 已删除 | `src/staging/*` 中已有纯逻辑、数据库读取和阻断状态更新；`staging-quality --db` 会在发现阻断项时直接更新 `world_lesson_runs`，已接入 `server-pipeline-run` | 否，是合并前质量门禁 |
| 候选检索 | 旧 `scripts/retrieve_candidates.py` 已删除 | `src/retrieval/*` 中已有查询规划、候选合并、SQL 计划、数据库读取和 PostgreSQL 写入；JSON 版检索预演入口已删除，`retrieve-candidates --db --batch-anchor` 直接写入 `retrieval_candidates` | 否，是抽取辅助能力 |
| 合并入 canonical | 旧 `scripts/merge_staged_lessons.py` 已删除 | `src/merge/*` 中已有合并规划、SQL 计划、数据库读取和受控 PostgreSQL 执行；JSON 版合并预演入口已删除，`merge-staged-lessons --db` 直接执行 canonical 合并并已接入 `server-pipeline-run` | 否，是 reducer 阶段 |
| 归一化 | 旧 `scripts/normalize.py` 已删除 | `src/normalize/*` 中已有纯逻辑、SQL 计划、数据库读取和 PostgreSQL 执行；JSON 版归一化预演入口已删除，`normalize --db` 直接执行并已接入 `server-pipeline-run` | 否，是后处理 |
| 严格质检 | 旧 `scripts/strict_qa.py` 已删除 | `src/qa/*` 中已有纯逻辑和数据库读取；JSON 版严格质检预演入口已删除，`strict-qa --db` 已接入 `server-pipeline-run` | 否，是质量门禁 |
| 图完整性检查 | 旧 `scripts/check_graph_integrity.py` 已删除 | `src/qa/*` 中已有纯逻辑、数据库读取和 `qa_passed` 状态更新；JSON 版图完整性预演入口已删除，`graph-integrity --db --mark-qa-passed` 直接执行状态更新并已接入 `server-pipeline-run` | 否，是完整性门禁 |
| embedding 回填 / 聚类 | 旧 `scripts/backfill_embeddings.py`、`scripts/cluster_nodes.py` 已删除 | 已有 TypeScript 命令行入口 `backfill-embeddings` 和 `cluster-nodes`；命令运行即更新 `embedding` 或 `properties_json` 的聚类布局字段，写入语句仍限制在对应表和字段 | 否，是检索和合并支撑 |

## 迁移规则

1. 每次只迁移一个业务阶段，先跑测试，再进入下一阶段。
2. Python 是业务输出基准，TypeScript 只允许改变内部组织方式。
3. 可以做受控 PostgreSQL 验证，但连接目标、测试数据和写入范围必须明确；写库动作必须有清楚的表边界和外部执行器接口，不保留只服务测试的预演入口。
4. Lesson worker 只能写 `world_lesson_runs` 和 `world_staging_*`。
5. Reducer 才能写 canonical `world_*`、合并重复节点、重映射引用并最终设置 QA 状态。
6. 单课抽取主线必须走模型抽取；旧本地规则抽取脚本已删除，不再作为参考或兜底路径。

## 目录重组进度

当前按目录重组统计：已完成 8 组，剩余 0 组。

| 目标目录 | 当前状态 |
| --- | --- |
| `outline/` | 已完成当前迁移边界：MinerU 源 Markdown 准备、PDF 目录抽取、Markdown 对齐、目录分块、已有 Markdown 导入、缺失 outline 时的 Markdown 标题派生、缺失 chunk 补齐已收拢；目录分块外壳已改为普通运行入口 |
| `extraction/` | 已完成当前迁移边界：批次编排、运行规划、模型抽取边界、模型抽取命令行入口、检索上下文加载、受控 staging 写入、TypeScript 抽取命令计划和批后归并流水线执行入口已收拢；批次计划和批后归并已删除测试型演练分支 |
| `staging/` | 已完成：暂存规范化、写入前完整性检查、SQL 计划、数据库读取、直接写入暂存表和阻断状态更新已收拢；不进入真实业务流的暂存写入预演已删除 |
| `merge/` | 已完成当前迁移边界：节点匹配、canonical 合并规划、SQL 计划、数据库读取、直接执行 canonical 写入和 node terms 重建已收拢；JSON 合并预演入口已删除 |
| `retrieval/` | 已完成：候选检索查询、候选合并、SQL 计划、数据库读取和直接写入 `retrieval_candidates` 已收拢；JSON 检索预演入口已删除 |
| `normalize/` | 已完成当前迁移边界：卡片 section 归一化、domain profile 去重、edge 去重、node terms 重建、数据库读取和直接执行写入已收拢；JSON 归一化预演入口已删除 |
| `qa/` | 已完成当前迁移边界：严格质检、图完整性检查、数据库读取和 `qa_passed` 状态更新已收拢；JSON QA 预演入口已删除 |
| `shared/` | 已完成：路径和 ID 规则、知识常量、PostgreSQL executor 适配、PostgreSQL readiness、embedding 回填、节点聚类、node terms 已收拢；embedding 与节点聚类的 SQL/store 拆分文件已合并回各自主文件，回填和聚类命令已改为数据库主路径 |

## 当前结论

不是所有现有 TypeScript 文件都属于“抽取”。其中一部分是 staging、retrieval、merge、normalize、QA 和 integrity 的替代准备。它们按业务阶段保留，避免把真实流水线压成难维护的大文件。

目录重组已经完成；主流程已经由 TypeScript 的 `server-pipeline-run` 承接。旧 Python 阶段脚本、旧 Python harness 和旧 OpenHarness 上传工具已删除。当前主线已经覆盖：TypeScript MinerU/已有 Markdown 准备 -> PDF outline 或 Markdown 标题派生 outline -> Markdown 对齐 -> 缺失 chunk 补齐 -> 模型抽取 -> staging -> 暂存质量检查 -> TypeScript canonical 合并 -> normalize -> strict QA -> graph integrity -> `qa_passed`。这条主线不包含本地规则抽取；知识抽取仍由模型完成。

## 当前剩余

按业务阶段粗略统计：8 个业务阶段的主流程迁移边界已完成，核心迁移剩余 0 个阻断项。

1. 可选后续整理：如果继续压缩文件数量，优先看 `cli/` 的命令包装入口和重复的薄包装测试；这不再是主流程迁移阻断项。

## 最新验证

2026-06-24 本轮验证：

- `find . ... -name '*.py' -o -name '*.pyc'`：排除 `.codex/`、`output/`、构建目录后无结果。
- `npm test -w packages/pipeline`：220 个测试通过；`staging`、`merge`、`retrieval`、`normalize`、`qa`、`outline`、`extraction` 和 `shared` 中不进入真实业务流的预演分支已删除或改为普通运行路径，数据库阶段测试改为验证读取数据库行后执行写入计划。
- `npm run check -w packages/pipeline`：通过。
- `npm run check`：通过。
- `npm run build`：通过，仅保留 Vite chunk size 警告。
- `shared/` 实现文件从 11 个收拢到 7 个：`embeddings-sql/store` 合并进 `embeddings.ts`，`cluster-nodes-sql/store` 合并进 `cluster-nodes.ts`；`backfill-embeddings` 和 `cluster-nodes` 已删除 `--execute` 分支，命令运行即走数据库写入主路径。
- `staging/` 实现文件保持 6 个：`store-staging` 和 `staging-quality` 已改为数据库主路径，完整性检查和质量门禁仍保留。
- `outline/` 实现文件保持 6 个：目录分块外壳从旧演练命名改为普通运行命名。
- `extraction/` 实现文件保持 4 个：批次计划外壳从旧演练命名改为普通计划命名，`server-pipeline-run` 删除整条流水线计划演练分支。
- `merge/` 实现文件从 7 个收拢到 6 个：旧 JSON 合并预演文件和 store 文件合并为数据库主路径 `merge-staged-lessons-runner.ts`，并删除不进入真实业务流的 JSON 合并预演入口。
- `retrieval/` 实现文件从 5 个收拢到 4 个：删除旧 JSON 检索预演入口，`retrieve-candidates --db --batch-anchor` 现在直接写入 `retrieval_candidates`。
- `normalize/` 实现文件从 5 个收拢到 4 个：删除旧 JSON 归一化预演入口，`normalize --db` 现在直接执行数据库归一化写入计划。
- `qa/` 实现文件从 5 个收拢到 3 个：删除旧 JSON QA 预演入口，严格质检和图完整性检查都改为数据库主路径。
- 旧 Python harness 已删除，不再保留 `run_okm_harness.py` 或 `harness/workflows/knowledge_extraction.yaml`。
- TypeScript 命令拼装用假运行器验证：批次计划调用 `npm run parallel-batch -w packages/pipeline`，课时模型抽取调用 `npm run extract-lesson-openai -w packages/pipeline`。
- 服务端和前端调试入口已移除本地规则抽取选择，`openai_chat_completions` 会映射到流水线实际 `chat_completions` 参数。
- `scripts/extract_lesson_local.py` 和 `scripts/extract_lesson_openai.py` 已删除；单课抽取主线由 TypeScript `extract-lesson-openai` 命令承接。
- `scripts/store_lesson_staging.py` 和 `scripts/psycopg_extras_shim.py` 已删除；暂存写入主线由 TypeScript `store-staging` 命令承接。
- 已删除旧 Python 阶段脚本：`check_postgres_ready.py`、`mineru_extract_pdf.py`、`chunk_outline.py`、`parallel_batch_runner.py`、`run_parallel_lesson_pipeline.py`、`check_lesson_staging_quality.py`、`retrieve_candidates.py`、`merge_staged_lessons.py`、`normalize.py`、`strict_qa.py`、`check_graph_integrity.py`、`backfill_embeddings.py`、`cluster_nodes.py`，以及只服务这些脚本的 `knowledge_store_common.py`、`embedding_client.py`、`okm_pathing.py`。
- `harness/`、`scripts/run_okm_harness.py`、`schemas/harness/workflow.schema.json` 和 `oah_upload.py` 已删除；旧 harness 路线由 TypeScript `server-pipeline-run` 替代。
- MinerU 外部调用路径使用注入依赖做离线验证，覆盖远程 URL、本地 PDF 上传、轮询完成、下载解压、复制 `full.md`；未使用真实 MinerU API key 跑外网任务。
- PDF outline 真实文件烟测写入 `/tmp`，使用 `pdftotext` 从当前化学教材 PDF 抽出 12 个主干 theme/lesson，未修改仓库数据。
- PostgreSQL readiness 使用注入 socket/query 做离线验证；`server-pipeline-run` 已接入 `check_postgres` 阶段，单元测试不连接真实数据库。

## PostgreSQL 验证

2026-06-23 已完成一次受控 PG smoke 验证：

- 目标库：`postgresql://okm:***@localhost:5432/knowledge`
- 临时数据集：`codex_pg_smoke_1782207433233`
- 验证路径：`extract-lesson-openai --write-staging`，模型响应由测试脚本注入，不调用真实模型。
- 写入范围：`world_lesson_runs`、`world_staging_nodes`、`world_staging_domain_profiles`、`world_staging_mentions`、`world_staging_evidence`、`world_staging_node_cards`。
- 结果：lesson run 状态为 `staged`，计数为 `nodes=1, edges=0, domain_profiles=1, mentions=1, evidence=1, node_cards=1`。
- 清理：删除临时 `world_datasets` 行后复查上述 staging 表和 `world_lesson_runs` 均为 0 条残留。
