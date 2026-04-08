# Schema V2

当前使用的知识图谱 schema，支持"全学段、跨学科、统一知识地图"模型。

## 设计目标

- 让 `canonical node` 保持学科中立与跨学段稳定
- 给 `canonical node` 增加 `node_layer`，显式区分主干与支撑
- 给 `canonical edge` 增加 `edge_layer` 与 `backbone_expand`，显式区分主干关系与主干展开关系
- 把学科/年级/掌握要求下沉到 `curriculum profile`
- 把详细展开下沉到 `node card`，并用 `card_layer` 对齐主干/支撑层
- 把出处和教材锚点保留在 `mention` / `evidence`

## 文件说明

- `node.schema.json`
  V2 规范节点 schema，核心字段是 `node_kind`、`node_layer`、`learning_modes`、`bridge_tags`
- `edge.schema.json`
  V2 规范关系 schema，核心字段是 `edge_type`、`edge_layer`、`backbone_expand`
- `curriculum-profile.schema.json`
  课程画像 schema，表示同一 canonical node 在不同学科/学段中的画像
- `node-card.schema.json`
  V2 节点卡 schema，支持按 section type 展开，并用 `card_layer` 标记主干卡/支撑卡
- `mention.schema.json`
  V2 提及记录 schema，从"教材 mention"推广到"来源 mention"
- `evidence.schema.json`
  V2 证据 schema，从"教材页码片段"推广到通用证据记录
- `pattern-library.schema.json`
  V2 模式库 schema，按 `node_kind` 驱动节点卡生成

## 核心设计理念

- **规范节点** - 学科中立，跨学段稳定
- **分层设计** - 主干层（核心概念）+ 支撑层（辅助内容）
- **证据支撑** - 所有节点和关系都有教材出处
- **画像分离** - 学科/学段信息独立于知识本体
