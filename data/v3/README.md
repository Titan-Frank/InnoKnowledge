# Data V3

这个目录用于承载“重新生成”的下一版统一知识地图输出。

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

- `data/v3/` 复用与 `data/v2/` 相同的 schema 与目录结构。
- 推荐把它当作“重生成版本”使用，而不是继续在旧 `v2` 上叠补丁。
- viewer 已可直接切换到 `v3`。
- 当用户明确要求写入新版本目录时，`data/v3/` 可以作为新的输出根。
