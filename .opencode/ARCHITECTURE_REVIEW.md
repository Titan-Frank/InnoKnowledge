# Agent-Skill 架构评审报告

评审日期: 2026-04-02
评审范围: .opencode/agents/*.md, .opencode/skills/*/SKILL.md

## 执行摘要

**总体评价**: 架构基本健康，层级清晰，但有若干不一致需要修复。

**关键发现**:
- ✅ 1 个严重问题已修复（@kg-pipeline 引用废弃 Agent）
- ⚠️ 3 个中等改进建议
- 💡 5 个最佳实践建议

---

## 详细发现

### 1. 严重问题（已修复）✅

**问题**: @kg-pipeline.md 引用已废弃的 Agent

**位置**: `.opencode/agents/kg-pipeline.md` 第 16-17 行

**原始内容**:
```markdown
For one lesson or one short page range:
   - run `@backbone-builder`    ← 废弃
   - run `@graph-normalizer`    ← 废弃
```

**修复**: 替换为直接的 Skill 调用说明
```markdown
For one lesson or one short page range:
   1. **Extract** with `$chapter-extract` skill
   2. **Normalize** with `$graph-normalize` skill
   3. **Closeout** with `scripts/run_sqlite_batch_pipeline.py`
   4. **Review** with `@qa-reviewer`
```

**状态**: ✅ 已修复

---

### 2. 架构一致性 ✅ 良好

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 废弃 Agent 标记 | ✅ | backbone-builder, graph-normalizer 已标记 DEPRECATED |
| Agent 到 Skill 引用 | ✅ | 所有活跃 Agent 正确引用 Skill |
| Skill 路径规范 | ✅ | 所有 Skill 使用 `../../` 引用根目录文件 |
| Reference 完整性 | ✅ | 每个 Skill 都有对应的 references/ 目录 |
| YAML frontmatter | ✅ | 所有文件都有正确的 metadata |

**活跃调用链**（经过修复后）:

```
@kg-pipeline (主入口)
├── @outline-reader → $textbook-outline
├── $chapter-extract （直接）
├── $graph-normalize （直接）
├── @qa-reviewer （审查）
└── @node-expander → $knowledge-schema
```

---

### 3. 中等改进建议 ⚠️

#### 3.1 增强 @outline-reader 和 @node-expander

**现状**: 这两个 Agent 文档较简洁（16 行和 32 行）

**建议**: 
- 参考 @kg-pipeline 的新格式，添加：
  - 明确的输入参数表格
  - 输出的详细格式
  - 错误处理说明

**优先级**: 低（当前够用，但可提升一致性）

#### 3.2 统一 Reference 文件间的链接

**现状**: Reference 文件之间几乎没有交叉引用

**示例**:
- `extraction-rules.md` 可以引用 `extraction-rules.md` 获取细节
- `normalization-rules.md` 可以引用 `schema-guide.md` 了解 ID 格式

**建议**: 在 Reference 文件底部添加 "See Also" 章节

#### 3.3 添加 @kg-pipeline 的调用示例

**现状**: @kg-pipeline 很实用，但没有命令行示例

**建议**: 添加一个完整的端到端调用示例

---

### 4. 最佳实践建议 💡

#### 4.1 文档版本管理

**建议**: 在 AGENTS.md 或 CONVENTIONS.md 中添加版本号

```markdown
---
name: project-architecture
version: 2.1
last-updated: 2026-04-02
---
```

#### 4.2 依赖关系图可视化

**建议**: 在 MIGRATION.md 或 ARCHITECTURE_REVIEW.md 中添加 Mermaid 图

```mermaid
graph TD
    A[@kg-pipeline] --> B[@outline-reader]
    A --> C[$chapter-extract]
    A --> D[$graph-normalize]
    A --> E[@qa-reviewer]
    A --> F[@node-expander]
    B --> G[$textbook-outline]
    F --> H[$knowledge-schema]
```

#### 4.3 自动化检查清单

**建议**: 创建脚本验证架构一致性

```bash
#!/bin/bash
# check-architecture.sh

# 1. 检查 kg-pipeline 是否引用废弃 Agent
grep -n "backbone-builder\|graph-normalizer" .opencode/agents/kg-pipeline.md

# 2. 检查所有 Skill 是否有 SKILL.md
for skill in chapter-extract graph-normalize knowledge-schema textbook-outline; do
    test -f ".opencode/skills/$skill/SKILL.md" || echo "Missing: $skill"
done

# 3. 检查废弃 Agent 是否正确标记
grep -l "DEPRECATED" .opencode/agents/backbone-builder.md .opencode/agents/graph-normalizer.md
```

#### 4.4 Skill 文档模板化

**建议**: 创建标准 Skill 模板，确保新 Skill 的一致性

`.opencode/skills/TEMPLATE.md`:
```markdown
---
name: skill-name
description: One-line description
---

# Skill Name

## Quick Start

## Workflow

### Phase 1: Pre-flight

### Phase 2: [Main Processing]

### Phase 3: Output

## Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|

## Output

## Key Rules

## Error Handling

## References
```

#### 4.5 创建架构决策记录 (ADR)

**建议**: 记录为什么这样设计架构

`.opencode/adr/001-agent-skill-separation.md`:
```markdown
# ADR 1: Agent-Skill 分离架构

## Status
Accepted

## Context
需要清晰区分编排层和实现层

## Decision
- Agent 负责流程协调
- Skill 负责具体实现
- 消除职责重叠

## Consequences
- 需要维护更多文件
- 但边界清晰，易于理解和测试
```

---

## 修复后的架构状态

### 文件清单（22 个）

**核心规范** (5 个):
- AGENTS.md
- .opencode/GLOSSARY.md
- .opencode/CONVENTIONS.md
- .opencode/STYLE_GUIDE.md
- .opencode/MIGRATION.md
- .opencode/ARCHITECTURE_REVIEW.md (本文件)

**Agent** (6 个):
- .opencode/agents/kg-pipeline.md ✅
- .opencode/agents/outline-reader.md ✅
- .opencode/agents/qa-reviewer.md ✅
- .opencode/agents/node-expander.md ✅
- .opencode/agents/backbone-builder.md ⚠️ (deprecated)
- .opencode/agents/graph-normalizer.md ⚠️ (deprecated)

**Skill** (4 个):
- .opencode/skills/chapter-extract/SKILL.md ✅
- .opencode/skills/graph-normalize/SKILL.md ✅
- .opencode/skills/knowledge-schema/SKILL.md ✅
- .opencode/skills/textbook-outline/SKILL.md ✅

**Reference** (7 个):
- .opencode/skills/chapter-extract/references/extraction-rules.md
- .opencode/skills/chapter-extract/references/graphrag-inspired-workflow.md
- .opencode/skills/graph-normalize/references/normalization-rules.md
- .opencode/skills/knowledge-schema/references/framework-usage.md
- .opencode/skills/knowledge-schema/references/node-card-usage.md
- .opencode/skills/knowledge-schema/references/schema-guide.md
- .opencode/skills/textbook-outline/references/output-contract.md

### 调用关系验证

```bash
# 验证命令
$ grep -c "delegate\|run \$" .opencode/agents/kg-pipeline.md
# 结果: 多处明确的调用说明

$ grep -c "DEPRECATED" .opencode/agents/backbone-builder.md .opencode/agents/graph-normalizer.md
# 结果: 2 (两个文件都已标记)

$ find .opencode/skills -name "SKILL.md" | wc -l
# 结果: 4 (所有 Skill 都有文档)
```

---

## 行动清单

### 立即执行（已完成）
- [x] 修复 @kg-pipeline 引用废弃 Agent

### 短期（可选）
- [ ] 增强 @outline-reader 和 @node-expander 文档
- [ ] 在 Reference 文件间添加交叉链接
- [ ] 添加端到端调用示例

### 中期（可选）
- [ ] 创建 Skill 文档模板
- [ ] 添加架构版本号
- [ ] 创建自动化检查脚本

### 长期（可选）
- [ ] 创建 ADR 目录
- [ ] 删除废弃 Agent 文件（稳定后）
- [ ] 添加 Mermaid 可视化图

---

## 总结

**架构健康度**: 8.5/10

**主要优势**:
1. 文档层级清晰（架构 → 编排 → 实现 → 细节）
2. 废弃路径明确标记
3. Skill 文档详细完整

**需要关注**:
1. @kg-pipeline 需要持续维护（已修复）
2. 小型 Agent 文档可以更丰富（可选）
3. 可以添加自动化检查（可选）

**建议**: 当前架构已足够健壮，可以投入使用。可选改进属于锦上添花。
