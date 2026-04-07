# 知识提取指南

本指南说明如何正确提取沪科技版化学7本教材的知识节点。

## ⚠️ 重要变更

**`extract_lesson_sqlite.py` 占位符脚本已被删除**

原因：该脚本只是个占位符，没有实现真正的LLM提取逻辑（参见第217行 `# TODO: Add LLM extraction logic here`）。

## ✅ 正确提取方式

### 使用 $chapter-extract skill

每个课题需要使用 `$chapter-extract` skill 单独提取。

**参数说明：**
- `batch-anchor`: 课题锚点ID，格式为 `struct:{book-id}:lesson:{x-y-z}`
- `book-md-path`: 教材markdown文件的完整路径
- `dataset-id`: 数据集版本，默认为 `v4`
- `db`: SQLite数据库路径，默认为 `storage/knowledge.sqlite`

### 7本教材清单

| 教材ID | 教材名称 | 课题数 | Markdown路径 |
|--------|----------|--------|--------------|
| chem-grade8-all-in-one | 八年级全一册 | 15 | ocr/八年级/... |
| chem-grade9-all-in-one | 九年级全一册 | 12 | ocr/九年级/... |
| chem-senior-required-1 | 高中必修第一册 | 13 | ocr/高中年级/... |
| chem-senior-required-2 | 高中必修第二册 | 10 | ocr/高中年级/... |
| chem-senior-elective-1 | 选择性必修1 | 12 | ocr/高中年级/... |
| chem-senior-elective-2 | 选择性必修2 | 9 | ocr/高中年级/... |
| chem-senior-elective-3 | 选择性必修3 | 10 | ocr/高中年级/... |

**总计：81个课题**

### 提取流程

```bash
# 1. 生成课题清单（可选）
python scripts/streaming_extraction.py --book chem-grade8-all-in-one

# 2. 对每个课题使用 $chapter-extract skill 提取
# （通过 Task 工具调用）
```

### Task调用示例

```python
task(
    description="提取课题内容",
    prompt="""
使用 $chapter-extract skill 提取以下课题：

- batch-anchor: struct:chem-grade8-all-in-one:lesson:1-1-1
- book-md-path: /Users/titan-frank/Documents/hsd/research/Knowledge/ocr/八年级/初中（五•四学制）_化学_沪科技版_全一册_八年级/hybrid_auto/初中（五•四学制）_化学_沪科技版_全一册_八年级.md
- dataset-id: v4
- db: /Users/titan-frank/Documents/hsd/research/Knowledge/storage/knowledge.sqlite

完成后请验证数据是否写入所有相关表。
""",
    subagent_type="general",
    command="$chapter-extract"
)
```

## 📁 相关文件

- **大纲文件**: `data/outlines/{book-id}.outline.json`
- **标记文件**: `data/outlines/{book-id}.marked.md`（包含LESSON边界标记）
- **数据库**: `storage/knowledge.sqlite`
- **调度脚本**: `scripts/streaming_extraction.py`（仅用于生成清单）

## 🔍 验证提取结果

```bash
# 检查节点数
sqlite3 storage/knowledge.sqlite "SELECT COUNT(*) FROM nodes;"

# 检查边数
sqlite3 storage/knowledge.sqlite "SELECT COUNT(*) FROM edges;"

# 检查课程画像数
sqlite3 storage/knowledge.sqlite "SELECT COUNT(*) FROM profiles;"

# 检查提及记录数
sqlite3 storage/knowledge.sqlite "SELECT COUNT(*) FROM mentions;"

# 检查证据数
sqlite3 storage/knowledge.sqlite "SELECT COUNT(*) FROM evidence;"

# 检查节点卡片数
sqlite3 storage/knowledge.sqlite "SELECT COUNT(*) FROM node_cards;"
```

## 📊 前端查看

启动Viewer服务：
```bash
python scripts/viewer_sqlite_api.py --db storage/knowledge.sqlite --port 8765
```

访问地址：
- Viewer: http://localhost:8765/viewer/
- Meta API: http://localhost:8765/api/meta
- Bundle API: http://localhost:8765/api/source/v4/bundle

## 📝 注意事项

1. **Task-Per-Lesson**: 每个课题必须单独处理，禁止在一个上下文中连续处理多个课题
2. **串行处理**: 同一本教材的课题建议串行处理，避免重复节点冲突
3. **并行处理**: 不同教材可以并行处理（无冲突）
4. **立即扩展**: 每个新backbone节点应立即使用 @node-expander 生成node_card
5. **及时归一化**: 每完成一本教材应调用 `$graph-normalize` 进行去重

## ✅ 当前状态

- [x] 删除占位符脚本 `extract_lesson_sqlite.py`
- [x] 更新 `streaming_extraction.py` 说明
- [x] 创建本提取指南
- [ ] 完成所有81个课题的提取
