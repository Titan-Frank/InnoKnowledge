---
name: graph-normalize
description: 对知识图谱去重、规范化、清理，同时保留教材来源和 schema 合规性。用于抽取后归一化知识图谱。
user-invocable: true
---

# 图归一化

在抽取之后对 canonical 图做归一化处理。包括节点去重、别名合并、环路检测、无连接节点的处理、以及关系整理。

## 快速开始

```bash
# 由 @kg-pipeline 在抽取后调用
# 需要：
#   --output-root（活跃版本）
#   --batch-anchor 或 --batch-group（用于范围）
```

## 工作流程

### 阶段一：预处理

1. 读取 `../../AGENTS.md` 了解原则
2. 读取 `../../GLOSSARY.md` 了解术语
3. 读取 `references/normalization-rules.md`
4. 验证 `--output-root` 存在且包含 PostgreSQL 数据集
5. 确定范围：
   - 单批次：`--batch-anchor struct:book:lesson:X-Y-Z`
   - 批次组：`--batch-group lesson-X-Y-Z,lesson-X-Y-Z+1,`

### 阶段二：加载当前状态

1. 连接 PostgreSQL 数据集
2. 加载 canonical 表：`nodes`、`edges`、`profiles`、`mentions`、`evidence`
3. 识别当前范围内创建的节点/边，用于潜在去重

### 阶段三：节点去重

**合并候选**（保守策略）：

1. 相同 `node_kind` + 相同 `canonical_name`
2. 相同 `node_kind` + 一个名称在另一个的 `aliases` 中
3. 相同 `node_kind` + 仅空格/标点差异
4. 相同 `node_kind` + 遗留名称与 v2 名称差异

**绝不跨类合并**：
- 不同 `node_kind` 或 `node_subkind`
- 没有明确证据或用户批准

**合并过程**：

```
对每个候选对：
  ├─ 验证语义相同
  ├─ 选择保留节点（优先稳定 ID）
  ├─ 合并别名
  ├─ 合并画像（仅相同上下文）
  ├─ 更新提及指向保留节点
  ├─ 将 ID 变更传播到边
  └─ 删除重复节点
```

### 阶段四：边整合

1. **完全重复**：相同 `(from, to, edge_type)`
   - 保留置信度最高的一条
   - 合并证据引用

2. **冲突关系**：新提议 vs 已有边
   - 不要自动覆盖
   - 选项：
     - 保留旧的，将新的排队审查
     - 语义不冲突时两者都保留
     - 请求用户解决

3. **更新 `edge_layer` 和 `backbone_expand`**
   - 节点层级变更时重新计算
   - backbone→backbone：`edge_layer=backbone, backbone_expand=false`
   - backbone↔support：`edge_layer=support, backbone_expand=true`

### 阶段五：环路检测

**检查层级/依赖边**

以下类型不得形成环路：
- `is_a`、`instance_of`、`contains`、`part_of`
- `prerequisite_for`、`depends_on`、`extends`

```
算法：
1. 用限制边类型构建图
2. 运行环路检测（DFS 或 Tarjan）
3. 对每个发现的环：
   ├─ 识别有问题的边
   ├─ 记录环路供审查
   └─ 环路包含 backbone 边时停止
```

**可接受的环路**（关联边）：
- `related_to`、`explains`、`uses`、`produces`

### 阶段六：孤立节点检测与解决

**定义**：孤立节点是指没有任何边与之相连的节点。

**检测算法**：
```sql
-- 查找没有入边或出边的节点
SELECT node_id, canonical_name, node_kind, node_layer
FROM nodes n
WHERE NOT EXISTS (
    SELECT 1 FROM edges e 
    WHERE e.source = n.node_id OR e.target = n.node_id
);
```

**解决流程**：

```
对每个孤立节点：
  ├─ 判断孤立是否是合理的
  │   ├─ 检查 node_kind（某些类型天然没有连接）
  │   ├─ 检查 node_layer（backbone 节点很少应有意图立）
  │   └─ 检查课题上下文（引言性概念可能是独立的）
  │
  ├─ 如果孤立是有问题的：
  │   ├─ 在当前批次中搜索语义相关节点
  │   ├─ 验证关系有教材证据支撑
  │   ├─ 如有证据：
  │   │   └─ 添加适当的边（弱关系优先用 `related_to`）
  │   └─ 如无证据：
  │       └─ 标记供人工审查，不要自动添加边
  │
  └─ 如果孤立是合理的：
      └─ 在 node.notes 字段中记录原因
```

**解决时的边类型选择**：

| 节点类型 | 首选边类型 | 说明 |
|---------|-----------|------|
| `concept/*` | `is_a`、`related_to` | 先检查父概念 |
| `entity/*` | `contains`、`related_to`、`uses` | 检查包含或使用关系 |
| `activity/*` | `uses`、`produces`、`measures` | 链接到器材或物质 |
| `method/*` | `applies`、`extends` | 链接到父方法 |
| `representation/*` | `represented_by`、`explains` | 链接到其表示的对象 |

**孤立可接受条件**：

以下情况孤立是可接受的：
- 节点在当前课题中显式引入但尚未连接（教材早期）
- 节点是占位符或交叉引用条目
- 节点 `node_layer=support`，仅作辅助参考
- 课题上下文表明有意独立呈现

以下情况孤立是有问题的：
- 节点 `node_layer=backbone`（核心概念应有连接）
- 节点出现在中期/后期课题（应已建立关系）
- 节点类型通常需要上下文（`activity/experiment` 需要器材等）
- 多个孤立节点暗示系统性抽取缺陷

**输出**：
- 更新 edges 表（新增连接）
- 更新 nodes.notes（有意孤立的节点）
- 报告：已解决节点、已标记节点、有意孤立

### 阶段七：别名与画像管理

**别名策略**：
- 每个节点优先一个中文标准名称
- 公式/缩写放入 `aliases`
- `aliases` 保持唯一且有序

**画像策略**：
- 不要跨不同学科/学段/年级合并
- 相同上下文的画像保守合并
- 保留所有 `framework_refs`、`textbook_refs`、`source_refs`
- 初中和高中画像共存

### 阶段八：ID 传播

当 canonical ID 变更时：

1. 更新 `profiles.node_id`
2. 更新 `mentions.target_id`
3. 更新 `edges.source` / `edges.target`
4. 更新 `node_cards` 引用
5. 如适用，更新 `evidence` 引用

```sql
-- ID 传播模式示例
UPDATE edges SET source = ? WHERE source = ?;
UPDATE edges SET target = ? WHERE target = ?;
UPDATE mentions SET target_id = ? WHERE target_id = ?;
```

### 阶段九：收尾

1. 运行 `scripts/normalize.py --dataset-id <id>`
   - 去重节点和边
   - 解决孤立节点
   - 检测层级边中的环路

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `--output-root` | 路径 | 是 | 活跃输出目录 |
| `--batch-anchor` | 字符串 | 否* | 单批次 ID |
| `--batch-group` | 字符串 | 否* | 逗号分隔的批次 ID |

*`--batch-anchor` 或 `--batch-group` 至少需要一个。

## 输出

**主要**：PostgreSQL canonical 表（已更新）

**次要**：可选 JSON/JSONL 快照

**状态**：PostgreSQL runtime 记录已更新

## 关键规则

### 合并策略
- 保守：仅处理明确的重复
- 语义安全：避免纯领域名的合并
- 宁可使用 `related_to`，不要强行合并

### 保留原则
- 合并时不要丢弃证据
- 不要断开来源链
- 保持 `card_layer` 与节点层级对齐

### 画像处理
- 添加新画像时保留旧覆盖
- 缺少当前批次覆盖 ≠ 可以删除
- 删除画像需要用户明确指示

### 边安全
- 不自动覆盖冲突边
- 候选接受 ≠ 重复清理
- 保持边语义明确

### 环路预防
**必须无环**：`is_a`、`instance_of`、`contains`、`part_of`、`prerequisite_for`、`depends_on`、`extends`

**检测到环路时的解决**：
1. 识别导致环路的边
2. 审查语义
3. 通过删除、改类型或人工审查来解决

### 孤立节点解决
- **证据优先**：只添加有教材证据支撑的边
- **保守连接**：不确定的关系优先用 `related_to`
- **Backbone 优先**：backbone 节点必须有连接；support 节点可以孤立
- **文档化**：合理的孤立节点必须在 `notes` 字段中说明原因
- **系统性问题**：高孤立率说明是抽取环节的问题，不是归一化能解决的

## 错误处理

### 阻塞场景

| 场景 | 操作 |
|------|------|
| 层级边中有环路 | 停止，报告阻塞 |
| canonical 边冲突 | 停止（或根据配置排队审查） |
| 边的目标节点缺失 | 停止，报告阻塞 |
| ID 传播失败 | 停止，回滚变更 |
| 孤立 backbone 节点过多（>10%） | 停止，报告系统性抽取缺陷 |

### 警告场景

| 场景 | 操作 |
|------|------|
| 检测到近似重复但不确定 | 记录，保持分开 |
| 画像合并冲突 | 两者都保留，标记审查 |
| 孤立 backbone 节点（单个） | 有证据时自动解决，否则标记 |
| 孤立 support 节点 | 在 notes 中记录，继续 |

## 参考

- `references/normalization-rules.md` — 详细归一化规则（99 行）
- `../knowledge-schema/references/schema-guide.md` — schema 语义
- `../../GLOSSARY.md` — 术语
- `../../CONVENTIONS.md` — 标准
