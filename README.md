# Knowledge Map Extraction Project

从教材内容构建结构化、证据支撑、跨学科的统一知识图谱。

## 当前标准

项目已经正式切到新的统一世界知识标准，不再使用 `v2`。

- 顶层本体：`entity / concept / property / process / event / method / rule / representation / resource`
- 分类结构：`taxonomy term`
- 事实关系：`world_edges`
- 领域扩展：`world_domain_profiles`
- 证据约束：`world_mentions / world_evidence / world_node_cards`
- `schema` 负责结构规则，`tag` 只负责检索辅助

当前标准版本：`V1.2`

核心依据：

- 本体与形式化表示：BFO / OWL
- 分类组织：SKOS
- 溯源：W3C PROV
- 教育投影：UNESCO / ISCED
- 知识形式：Ryle / Polanyi
- 学习维度：Anderson & Krathwohl

## 运行方式

```bash
docker compose up -d
export DATABASE_URL=postgresql://okm:okm@localhost:5432/knowledge

python3 scripts/run_okm_harness.py \
  --book-id chem-grade8 \
  --pdf-path /abs/path/to/book.pdf
```

切到 OpenAI Responses 课时抽取：

```bash
python3 scripts/run_okm_harness.py \
  --book-id chem-grade8 \
  --pdf-path /abs/path/to/book.pdf \
  --set lesson_backend_kind=openai_responses
```

## 主链路

```bash
python3 scripts/store_lesson_staging.py \
  --root data/main \
  --book-id chem-grade8 \
  --batch-anchor struct:chem-grade8:lesson:1-1-1 \
  --nodes-json '<json>' \
  --edges-json '<json>' \
  --domain-profiles-json '<json>' \
  --mentions-json '<json>' \
  --evidence-json '<json>' \
  --node-cards-json '<json>'

python3 scripts/merge_staged_lessons.py --root data/main --book-id chem-grade8
python3 scripts/normalize.py --dataset-id main
python3 scripts/strict_qa.py --dataset-id main
python3 scripts/check_graph_integrity.py --dataset-id main
```

## 存储

唯一主存储是 PostgreSQL。

核心表：

- `world_datasets`
- `world_nodes`
- `world_edges`
- `world_taxonomy_terms`
- `world_taxonomy_edges`
- `world_domain_profiles`
- `world_mentions`
- `world_evidence`
- `world_node_cards`

运行表：

- `world_lesson_runs`
- `world_staging_nodes`
- `world_staging_edges`
- `world_staging_domain_profiles`
- `world_staging_mentions`
- `world_staging_evidence`
- `world_staging_node_cards`
- `world_merge_runs`
- `world_canonical_node_map`
- `retrieval_candidates`

数据库 schema：`schemas/pg/knowledge_store.sql`

## 主要脚本

- `scripts/extract_lesson_local.py`
- `scripts/extract_lesson_openai.py`
- `scripts/store_lesson_staging.py`
- `scripts/merge_staged_lessons.py`
- `scripts/normalize.py`
- `scripts/strict_qa.py`
- `scripts/check_graph_integrity.py`
- `scripts/retrieve_candidates.py`

## 相关文档

- `schemas/world-knowledge-standard.md`
- `schemas/world-knowledge-architecture.md`
- `schemas/world-knowledge.schema.json`
- `schemas/world-knowledge-edge.schema.json`
- `schemas/world-taxonomy-term.schema.json`
- `schemas/world-domain-profile.schema.json`
