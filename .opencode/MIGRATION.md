# Agent/Skill 架构迁移指南

本文档验证并展示优化后的 Agent/Skill 架构。

## 迁移概览

| 旧方式 | 新方式 | 状态 |
|--------|--------|------|
| `@backbone-builder` | `$chapter-extract` | ✅ 已迁移 |
| `@graph-normalizer` | `$graph-normalize` | ✅ 已迁移 |
| AGENTS.md (184行详细规则) | AGENTS.md (高层原则) + Skill详细实现 | ✅ 已完成 |

## 推荐调用路径

### 场景 1：提取单个课程

```
推荐：@kg-pipeline 自动处理
├── 步骤 1: $chapter-extract (提取)
├── 步骤 2: $graph-normalize (归一化)
├── 步骤 3: scripts/run_sqlite_batch_pipeline.py (闭包)
└── 步骤 4: @qa-reviewer (审查)

或直接调用 Skill：
$chapter-extract --output-root data/v4/ --batch-anchor struct:chem:lesson:1-1-1
```

### 场景 2：提取整本教材

```
@kg-pipeline (协调多批次)
├── 批次 1: lesson-1-1-1
│   ├── $chapter-extract
│   ├── $graph-normalize
│   └── QA
├── 批次 2: lesson-1-1-2
│   ├── $chapter-extract
│   ├── $graph-normalize
│   └── QA
├── ...
└── 完整输出
```

### 场景 3：生成大纲

```
@outline-reader
└── $textbook-outline --book-md-path <path> --book-id <id>
```

### 场景 4：完整知识模式

```
@kg-pipeline（完成提取后）
├── ...（正常提取流程）
├── scripts/node_card_targets.py (收集目标)
└── @node-expander (展开节点卡片)
```

## 文档层级验证

### 层级 1：项目总纲

**文件**: `AGENTS.md` (146 行)

**内容**: 高层原则、架构图、输出合约、关键约束

**适用场景**: 首次了解项目、快速导航

**验证清单**:
- [x] 包含 Quick Links 表
- [x] 包含架构图
- [x] 包含核心原则
- [x] 包含输出合约

### 层级 2：规范定义

**文件**:
- `GLOSSARY.md` - 术语表
- `CONVENTIONS.md` - 编码规范
- `STYLE_GUIDE.md` - 写作风格

**验证**: 所有术语可在 GLOSSARY 找到定义

### 层级 3：编排层 (Agents)

| Agent | 职责 | 调用 Skill |
|-------|------|-----------|
| `@kg-pipeline` | 主要入口，流程协调 | `$chapter-extract`, `$graph-normalize` |
| `@outline-reader` | 大纲提取 | `$textbook-outline` |
| `@qa-reviewer` | 质量审查 | 读-only，不写入 |
| `@node-expander` | 节点卡片扩展 | `$knowledge-schema` |

**废弃的 Agent**:
- ~~`@backbone-builder`~~ → 使用 `$chapter-extract`
- ~~`@graph-normalizer`~~ → 使用 `$graph-normalize`

### 层级 4：实现层 (Skills)

| Skill | 页数 | 阶段数 | 关键功能 |
|-------|-----|--------|---------|
| `$chapter-extract` | 220 行 | 5 阶段 | 检索优先提取、证据链构建 |
| `$graph-normalize` | 219 行 | 8 阶段 | 去重、别名合并、循环检测 |
| `$knowledge-schema` | 391 行 | - | Schema 验证、ID 生成 |
| `$textbook-outline` | 192 行 | 4 阶段 | Markdown 解析、大纲生成 |

**每个 Skill 包含**:
- Quick Start
- 分阶段 Workflow
- 输入/输出规格
- 关键规则
- 错误处理

## 架构验证测试

### 测试 1：文档完整性

```bash
# 检查所有关键文件存在
ls -1 \
  AGENTS.md \
  .opencode/GLOSSARY.md \
  .opencode/CONVENTIONS.md \
  .opencode/STYLE_GUIDE.md \
  .opencode/agents/kg-pipeline.md \
  .opencode/skills/chapter-extract/SKILL.md \
  .opencode/skills/graph-normalize/SKILL.md

# 预期：所有文件存在
```

### 测试 2：Skill 独立性

每个 Skill 应该能够独立说明完整的执行流程，不依赖 Agent 文件。

**验证方法**: 阅读任意 SKILL.md，确认包含完整工作流

✅ `$chapter-extract/SKILL.md` - 包含 5 个阶段的详细说明
✅ `$graph-normalize/SKILL.md` - 包含 8 个阶段的详细说明

### 测试 3：术语一致性

```bash
# 检查 GLOSSARY 中的术语是否被使用
grep -r "retrieval-first" .opencode/skills/ | head -5
# 预期：多处引用

grep -r "batch-anchor" .opencode/skills/ | head -5
# 预期：多处引用
```

### 测试 4：废弃标记

```bash
# 检查废弃 Agent
head -5 .opencode/agents/backbone-builder.md
# 预期：显示 [DEPRECATED]

head -5 .opencode/agents/graph-normalizer.md
# 预期：显示 [DEPRECATED]
```

## 性能对比

### 文档维护性

| 指标 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| AGENTS.md 行数 | 184 | 146 | -21% |
| Skill 平均文档长度 | 45 行 | 255 行 | +460% (更详细) |
| 重复规则数量 | 多处 | 0 | -100% |
| 架构清晰度 | 低 | 高 | +++ |

### 调用路径

**优化前**:
```
@kg-pipeline → @backbone-builder → $chapter-extract
```

**优化后**:
```
@kg-pipeline → $chapter-extract
```
- 减少一层委托
- 消除职责重叠
- Skill 直接可读

## 迁移完成度

- [x] Phase 1: 创建规范文件 (GLOSSARY, CONVENTIONS, STYLE_GUIDE)
- [x] Phase 2: 精简 AGENTS.md
- [x] Phase 3: 增强 Skill 文档
- [x] Phase 4: 标记旧 Agent 废弃
- [x] Phase 5: 验证文档结构

## 下一步建议

1. **实际应用测试**: 选择一个真实课程运行完整流程
2. **文档迭代**: 根据使用反馈调整 Skill 文档
3. **扩展 GLOSSARY**: 添加更多项目中使用的术语
4. **添加示例**: 在 Skill 文档中添加更多代码示例

## 参考

- [项目架构](../AGENTS.md)
- [术语表](./GLOSSARY.md)
- [编码规范](./CONVENTIONS.md)
- [写作风格](./STYLE_GUIDE.md)

---

**迁移完成**: 2026-04-02
**架构版本**: v2 (统一文档结构)
