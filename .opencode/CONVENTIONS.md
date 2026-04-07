# 编码与文档规范

本文档定义项目中的编码风格、文档格式和最佳实践。所有贡献者应遵循这些规范。

## 1. 文档结构规范

### 1.1 文件头部格式

所有 Markdown 文件应包含 YAML frontmatter：

```yaml
---
name: skill-name          # Skill 使用 name
# 或
description: Brief description of the agent/skill
mode: subagent            # Agent 需要声明 mode
# 可选
tools:
  write: false            # 明确声明工具权限
  edit: false
---
```

### 1.2 文档层级结构

**AGENTS.md** - 项目总纲
- 仅保留高层原则和决策规则
- 不包含详细实现步骤
- 用指向 Skill 的链接替代详细说明

**Agent 文件** - 编排规格
- 描述职责和委托方式
- 不包含业务逻辑细节
- 明确调用哪个 Skill

**Skill 文件** - 能力实现
- 完整的输入/处理/输出流程
- 详细的业务规则和边界情况
- 工具调用示例

**Reference 文件** - 详细规范
- 规则详解、示例、边界情况
- 支持性的深入说明

### 1.3 章节顺序

标准 Skill 文档结构：

```markdown
# Skill Name

## Quick Start（快速开始，可选）

## Workflow（工作流程）
1. Pre-flight
2. Main processing
3. Output

## Input（输入规格）

## Output（输出规格）

## Rules（业务规则）

## Error Handling（错误处理）

## References（参考资料）
```

## 2. 写作风格

### 2.1 语言

- 主要文档使用 **英文**（便于国际化和工具处理）
- 中文术语保留在 `canonical_name`, `aliases` 等字段中
- 代码注释使用英文

### 2.2 语气

- **指令性**：使用祈使句 "Do X", "Run Y"
- **明确性**：避免 "可能", "大概", "应该" 等模糊词汇
- **可测试性**：规则应能转化为自动化测试

**好示例**：
```markdown
Every canonical node must have at least one mention.
Run `scripts/retrieve_candidates.py --mode hybrid` before node creation.
```

**避免**：
```markdown
Nodes should probably have mentions.
You can maybe use retrieval if needed.
```

### 2.3 格式

- 使用 ATX 风格标题（`#` 而非 underlines）
- 列表使用 `-` 无序列表，有序用 `1.` 2.`
- 代码块标明语言：```` ```bash ````, ```` ```json ````
- 表头使用管道符对齐

## 3. 代码规范

### 3.1 脚本规范

所有脚本应支持 `--help`：

```bash
scripts/example_script.py --help
# 输出：描述、参数说明、示例
```

标准参数顺序：
```bash
script.py \
  --output-root data/main/ \
  --batch-anchor struct:book:lesson:1-1-1 \
  --other-params
```

### 3.2 错误处理

脚本退出码：
- `0` - 成功
- `1` - 一般错误
- `2` - 参数错误
- `3` - 数据错误（如缺失必要字段）
- `10` - blocker，需要人工介入

错误输出格式：
```json
{
  "error": true,
  "type": "blocker",
  "stage": "normalize",
  "batch_anchor": "struct:chem:lesson:1-1-1",
  "message": "Cycle detected in is_a relations",
  "details": {...}
}
```

### 3.3 日志规范

使用结构化日志：
```python
{"level": "INFO", "stage": "extract", "batch": "1-1-1", "nodes_created": 5}
{"level": "WARN", "stage": "normalize", "duplicate_nodes": ["A", "B"]}
```

## 4. 引用规范

### 4.1 内部引用

引用其他文档使用相对路径：
- 同目录：`./other-file.md`
- 子目录：`./references/detail.md`
- 父目录：`../other-skill/SKILL.md`
- 根目录：`../../AGENTS.md`

### 4.2 术语引用

首次使用术语应链接到术语表：
```markdown
Use [retrieval-first](#) approach to find candidate nodes.
```

或在术语首次出现时加粗：
```markdown
Use **retrieval-first** approach...
```

### 4.3 外部引用

引用外部资源提供完整 URL：
```markdown
See [LightRAG paper](https://arxiv.org/abs/...)
```

## 5. 版本控制

### 5.1 文件变更

修改现有文件前：
1. 读取现有内容
2. 识别变更点
3. 使用 edit 工具精确修改

### 5.2 破坏性变更

如果修改可能影响正在运行的流程，应：
1. 在 AGENTS.md 的变更日志中记录
2. 提供迁移指南
3. 保持向后兼容至少一个版本

## 6. Blocker 报告格式

所有 blocker 使用统一 JSON 格式：

```json
{
  "blocker_type": "qa_failed | cycle_detected | missing_evidence | schema_error | ...",
  "severity": "blocking | warning",
  "location": {
    "file": "path/to/file",
    "stage": "extract|normalize|qa",
    "batch_anchor": "struct:..."
  },
  "description": "Human-readable description",
  "technical_details": { },
  "suggested_action": "What to do next",
  "timestamp": "2026-01-01T00:00:00Z"
}
```

报告存储位置：`<output-root>/blockers/{timestamp}-{batch-anchor}.json`

## 7. 审核检查清单

新增或修改文档前，检查：

- [ ] YAML frontmatter 完整
- [ ] 术语使用符合 GLOSSARY.md
- [ ] 引用的文件路径正确
- [ ] 代码示例可执行
- [ ] 错误处理描述了 blocker 场景
- [ ] 文档层级符合 CONVENTIONS.md 第1节
