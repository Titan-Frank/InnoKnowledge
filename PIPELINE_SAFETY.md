# Pipeline 安全操作指南

## ⚠️ 关键原则：SQLite 是唯一真实来源

**永远记住**: `storage/knowledge.sqlite` 是唯一真实来源，JSONL 只是导出副本。

## ❌ 禁止操作

### 1. 永远不要直接运行这些脚本

```bash
# ❌ 这些脚本直接写 JSONL，绕过 SQLite!
python extract_chemistry_complete.py      # 直接写 JSONL
python extract_chemistry_v4.py            # 直接写 JSONL

# ❌ 不要手动编辑 JSONL 文件!
vi data/v4/graph/knowledge.nodes.jsonl    # 直接修改导出文件
```

### 2. 永远不要直接写 JSONL

```python
# ❌ 错误的写入方式:
with open("data/v4/graph/knowledge.edges.jsonl", "w") as f:
    f.write(json.dumps(edge) + "\n")

# ✅ 正确的写入方式:
connection.execute(
    "INSERT INTO edges (id, from_node, to_node, edge_type, ...) VALUES (?, ?, ?, ?)",
    (edge_id, from_node, to_node, edge_type, ...)
)
connection.commit()
```

## ✅ 正确流程

### 单课提取（推荐）

```bash
# 1. 获取课程 prompt
python scripts/run_single_lesson.py --book-id chem-highschool-selective-compulsory-1 --output-root data/v4

# 2. 复制生成的 prompt，在新对话中执行:
#    - /chapter-extract (写入 SQLite)
#    - /graph-normalize
#    - scripts/run_sqlite_batch_pipeline.py (finalize)
#    - @qa-reviewer

# 3. 验证写入成功
curl http://localhost:8765/api/meta
```

### 批量提取（并行 Task）

```bash
# 生成 Task 调用
python scripts/parallel_batch_runner.py \
    --book-id chem-highschool-selective-compulsory-1 \
    --output-root data/v4 \
    --parallel 2 \
    --batch-size 4 \
    --generate-tasks

# 执行时确保每个 Task:
# 1. 使用 /chapter-extract (写入 SQLite)
# 2. 使用 run_sqlite_batch_pipeline.py closeout
# 3. 不使用 extract_chemistry_*.py
```

## 🔍 验证检查点

### 检查 1: 数据一致性

```bash
# SQLite 中的数量
sqlite3 storage/knowledge.sqlite "SELECT COUNT(*) FROM nodes; SELECT COUNT(*) FROM edges;"

# JSONL 中的数量  
wc -l data/v4/graph/knowledge.nodes.jsonl
wc -l data/v4/graph/knowledge.edges.jsonl

# 必须相等！如果不相等，说明有数据绕过 SQLite 写入
```

### 检查 2: Viewer API 同步

```bash
# 启动 API 服务器
python3 scripts/viewer_sqlite_api.py --db storage/knowledge.sqlite --port 8765

# 检查 API 返回的数量
curl -s http://127.0.0.1:8765/api/source/v4/bundle | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'API Nodes: {len(d[\"nodes\"])}')
print(f'API Edges: {len(d[\"edges\"])}')
"

# 应该与 SQLite 一致
```

## 🚨 发现问题后的修复流程

### 场景 1: JSONL 比 SQLite 新（我们遇到的情况）

```bash
# 1. 备份现有数据
cp -r data/v4 data/v4.backup.$(date +%Y%m%d_%H%M%S)

# 2. 清理数据文件（去除重复、修复 schema）
# 手动或使用脚本来修复

# 3. 停止使用旧导入链
#    当前仓库不再支持 JSONL → SQLite 反向导入。
#    应该以 SQLite 为准，删除旧导出，并在需要时从 SQLite 重新导出派生文件。

# 4. 验证
sqlite3 storage/knowledge.sqlite "SELECT COUNT(*) FROM nodes; SELECT COUNT(*) FROM edges;"
```

### 场景 2: 需要重新提取（数据混乱）

```bash
# 1. 备份 manifest
cp data/v4/runs/*.pipeline.json data/v4/runs/*.pipeline.json.backup

# 2. 清空 SQLite（谨慎操作!）
sqlite3 storage/knowledge.sqlite "DELETE FROM nodes; DELETE FROM edges; DELETE FROM mentions; DELETE FROM evidence; DELETE FROM profiles;"

# 3. 重置 manifest 中的课程状态
# 手动编辑 manifest 将所有课程标记为 pending

# 4. 重新执行提取（严格按正确流程）
python scripts/run_single_lesson.py ...
```

## ⚙️ 配置强化

### 1. 让提取强制写入 SQLite

在 `/chapter-extract` skill 配置中添加检查:
```python
# 在 skill 执行前检查
assert Path("storage/knowledge.sqlite").exists(), "SQLite not found!"

# 在 skill 执行后验证
conn = sqlite3.connect("storage/knowledge.sqlite")
count_after = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
assert count_after > count_before, "No data written to SQLite!"
```

### 2. 防止直接文件写入

可以设置文件系统权限:
```bash
chmod 444 data/v4/graph/*.jsonl  # 设为只读
# 只有受控的 SQLite 导出流程可以重建这些派生文件
```

## 📊 监控清单

每次提取后检查:

- [ ] SQLite 有新节点 (`SELECT COUNT(*) FROM nodes` 增加)
- [ ] SQLite 有新边 (`SELECT COUNT(*) FROM edges` 增加)
- [ ] Manifest 标记课程为 completed
- [ ] JSONL 文件时间戳比 SQLite 修改时间晚（这是正常的，因为 JSONL 是导出的）
- [ ] SQLite 和 JSONL 数量一致（导入后）
- [ ] Viewer API 能看到新数据

## 📝 此次事故的教训

### 发生了什么
1. Task workers 声称"完成"但数据绕过 SQLite 写入了 JSONL
2. SQLite 保持旧数据（85 nodes），JSONL 累积新数据（166 edges）
3. Viewer API 读 SQLite，所以看不到新数据
4. 修复需要大量手动清理（6 重复 edges, 34 无效 profiles, 34 无效 mentions, 95 缺失字段）

### 根本原因
- 系统中存在直接写 JSONL 的废弃脚本
- 没有强制检查 SQLite-first 原则
- Task 返回结果没有验证真实写入位置

### 预防措施
- ✅ 删除或标记废弃的 `extract_chemistry_*.py` 脚本
- ✅ 添加写入验证检查
- ✅ 每次提取后运行数据一致性检查
- ✅ 使用 API 方式查看数据（而不是直接看 JSONL）

---

**记住：如果 SQLite 和 JSONL 不一致，信任 SQLite！**
JSONL 只是导出，不应再作为回写 SQLite 的输入链路。
