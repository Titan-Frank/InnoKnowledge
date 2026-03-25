# Schema V2

这套 `schemas/v2/` 用于支持“全学段、跨学科、统一知识地图”模型，不替换当前根目录下的旧版 schema，而是作为渐进迁移目标。

## 设计目标

- 让 `canonical node` 保持学科中立与跨学段稳定
- 把学科/年级/掌握要求下沉到 `curriculum profile`
- 把详细展开下沉到 `node card`
- 把出处和教材锚点保留在 `mention` / `evidence`

## 文件说明

- `node.schema.json`
  V2 主干节点 schema，核心字段是 `node_kind`、`learning_modes`、`bridge_tags`
- `edge.schema.json`
  V2 主干关系 schema，扩展了分类、依赖、因果、表征等关系类型
- `curriculum-profile.schema.json`
  新增，表示同一 canonical node 在不同学科/学段中的画像
- `node-card.schema.json`
  V2 节点卡 schema，支持按 section type 展开
- `mention.schema.json`
  V2 提及记录 schema，从“教材 mention”推广到“来源 mention”
- `evidence.schema.json`
  V2 证据 schema，从“教材页码片段”推广到通用证据记录
- `pattern-library.schema.json`
  V2 模式库 schema，按 `node_kind` 驱动节点卡生成

## 建议迁移顺序

1. 先继续沿用旧版 `node` / `edge` 产出，保证当前流程不断。
2. 新增 `curriculum profile` 作为中间层。
3. 在 agent 输出中逐步把旧 `node_type` 迁移为 `node_kind + node_subkind`。
4. 扩展 edge 类型，再把 node card 和 pattern library 切到 v2。

## 与旧版最大的差异

- 旧版更偏“教材知识抽取”
- V2 更偏“统一知识地图本体”

可以理解为：

- 旧版先解决“能抽出来”
- V2 再解决“能统一、能扩展、能跨学科生长”
