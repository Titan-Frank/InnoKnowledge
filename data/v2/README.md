# Data V2

这个目录用于承载“统一知识地图”模型下的新输出，避免直接覆盖当前兼容旧版 viewer 的数据文件。

## 目录

- `graph/`
  - `knowledge.nodes.jsonl`
  - `knowledge.edges.jsonl`
  - `<book-id>.mentions.jsonl`
  - `<book-id>.evidence.jsonl`
- `profiles/`
  - `knowledge.profiles.jsonl`
- `node_cards/`
  - `<safe-node-id>.json`

## 说明

- `data/graph/` 和 `data/node_cards/` 仍然可以继续保留给旧流程和旧前端使用。
- 新的 OpenCode agent / skills 迁移后默认写入 `data/v2/`。
- 当 V2 数据结构和消费端稳定后，再考虑统一迁移前端和下游工具。
