# OKM Harness

这是项目内生的专用 harness，用来摆脱对外部 Agent runtime 的依赖。

## 固定阶段

- `check_postgres`
- `source_markdown`
- `ensure_outline`
- `plan_lessons`
- `lesson_staging`
- `lesson_quality`
- `canonical_commit`

这些阶段由 workflow YAML 固定下来，不能被课时抽取 backend 绕开。

## 运行

```bash
export MINERU_API_KEY=你的_MinerU_API_令牌

python3 scripts/run_okm_harness.py \
  --book-id chem-grade8 \
  --pdf-path /abs/path/to/book.pdf
```

`source_markdown` 阶段会调用 MinerU，把 PDF 转成 `data/mineru/<book-id>/full.md`。
如果已经有 OCR Markdown，可以改用：

```bash
python3 scripts/run_okm_harness.py \
  --book-id chem-grade8 \
  --source-markdown-path /abs/path/to/full.md
```

## lesson backend

支持三种 backend：

- `local_rule_based`
- `openai_responses`
- `shell`

### `local_rule_based`

内置脚本：

- [extract_lesson_local.py](/Users/titan-frank/Documents/hsd/research/Open-Knowledge-Map/scripts/extract_lesson_local.py)
- [store_lesson_staging.py](/Users/titan-frank/Documents/hsd/research/Open-Knowledge-Map/scripts/store_lesson_staging.py)

它会直接产出：

- `nodes`
- `edges`
- `domain_profiles`
- `mentions`
- `evidence`
- `node_cards`

并写入：

- `world_lesson_runs`
- `world_staging_*`

### `openai_responses`

内置脚本：

- [extract_lesson_openai.py](/Users/titan-frank/Documents/hsd/research/Open-Knowledge-Map/scripts/extract_lesson_openai.py)

它会读取当前 lesson/chunk 的 OCR markdown，用固定 JSON schema 调用 Responses API，再收敛到项目当前世界知识标准。

### `shell`

保留最大自由度。只要求 stdout 最后一行输出 JSON，至少包含：

```json
{"status":"success","lesson_run_id":"lesson-run:abc123","counts":{"nodes":12},"issues":[]}
```
