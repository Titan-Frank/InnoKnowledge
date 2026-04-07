# 对话上下文管理方案

针对长流程知识提取的上下文爆炸问题，提供三种解决方案。

## 问题定义

**问题**: 处理 100+ 节课的教材时，如果在一个对话中顺序处理：
- 上下文累积（schemas + 已有 nodes + edges + mentions）
- 50 课后可能达到 token 限制
- 检索和推理质量下降
- 最终无法完成

**根本原因**: AI 对话上下文有限，不能无限累积

**解决方案核心**: 对话无状态，磁盘全状态

---

## 方案对比

| 方案 | 复杂度 | 并行度 | 适用场景 | 推荐度 |
|------|--------|--------|----------|--------|
| A. 手动分批 | 低 | 无 | 实验/调试 | ⭐⭐⭐ |
| B. 批处理器脚本 | 中 | 无 | 生产环境 | ⭐⭐⭐⭐ |
| C. Task 并行 | 高 | 高 | 大规模生产 | ⭐⭐⭐⭐⭐ |

---

## 方案 A：手动分批（最简单）

### 工作原理

用户手动控制对话边界，每 5-10 课后重新开始新对话。

### 使用方式

```bash
# 对话 1：课程 1-5
User: @kg-pipeline 提取 chem-grade8，课程 1-5
AI:  ✓ 完成 5 课，已保存到 SQLite
     当前状态：5/100 课，节点 45，边 67

# [用户结束对话]

# 对话 2：课程 6-10
User: @kg-pipeline 继续提取 chem-grade8，课程 6-10
AI:  ✓ 读取已有状态（5 课已完成）
     ✓ 完成课程 6-10
     当前状态：10/100 课，节点 89，边 134

# 重复直到完成...
```

### 优点
- 简单直观
- 用户完全控制
- 随时可中断和恢复

### 缺点
- 需要用户手动管理
- 无法自动化
- 容易遗漏或重复

---

## 方案 B：批处理器脚本（推荐）

### 工作原理

使用 `scripts/batch_processor.py` 自动管理批次和生成提示。

### 使用方式

```bash
# 第 1 步：生成第一个批次的提示
python scripts/batch_processor.py \
    --book-id chem-grade8 \
    --output-root data/v5 \
    --batch-size 5 \
    --action prompt

# 输出：
# @kg-pipeline Process next batch of lessons for chem-grade8
# 
# **Context:**
# - Book: chem-grade8
# - Progress: 0/30 lessons completed
# - This session: Process 5 lessons
#
# **Lessons to process:**
# - lesson-1-1-1: 课题 1 化学使世界...
# - lesson-1-1-2: 课题 2 化学是一门...
# ...

# 第 2 步：复制提示给 AI 执行
# [AI 执行完成]

# 第 3 步：生成下一个批次的提示
python scripts/batch_processor.py \
    --book-id chem-grade8 \
    --action prompt
# [输出下一个 5 课的提示]

# 重复直到状态显示完成...
```

### 脚本功能

```python
# batch_processor.py 核心功能

class BatchProcessor:
    def load_manifest() -> Dict:
        """读取运行清单，获取已完成/待处理课程"""
    
    def get_next_batch(batch_size: int) -> List[Lesson]:
        """确定下一批次课程"""
    
    def generate_session_prompt(batch: List[Lesson]) -> str:
        """生成包含上下文的完整提示"""
    
    def update_manifest(batch: List[Lesson], stats: Dict):
        """更新清单，标记完成"""

# 状态持久化
- SQLite: 知识图谱数据
- JSON manifest: 进度追踪
- 对话：仅处理当前批次，不累积历史
```

### 优点
- 自动化批次管理
- 状态完全持久化
- 可随时中断和恢复
- 防止重复处理

### 缺点
- 仍需要手动触发每个批次
- 不能真正并行

---

## 方案 C：利用 Task 工具并行处理（最优）

### 工作原理

利用我的 **Task 工具** 异步启动多个子任务，每个任务处理一个独立的课程批次。

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│  主对话（协调者）                                             │
│  ─────────────────                                           │
│  1. 读取大纲，规划批次                                        │
│  2. 启动 N 个并行 Task                                       │
│     ├── Task 1: 课程 1-5                                     │
│     ├── Task 2: 课程 6-10                                    │
│     ├── Task 3: 课程 11-15                                   │
│     └── ...                                                  │
│  3. 等待所有 Task 完成                                        │
│  4. 合并结果，统一 QA                                         │
└─────────────────────────────────────────────────────────────┘
        ↓ ↓ ↓ 每个 Task 是独立对话，无上下文累积 ↓ ↓ ↓
┌─────────────────────────────────────────────────────────────┐
│  Task 1（独立对话）                                           │
│  ─────────────────                                           │
│  1. 读取 SQLite 初始状态                                      │
│  2. 处理课程 1-5（独立上下文）                               │
│  3. 写入 SQLite                                              │
│  4. 返回结果                                                 │
│  [对话结束，上下文丢弃]                                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Task 2（独立对话）                                           │
│  同上，处理课程 6-10                                          │
│  [注意：需要处理并发写入 SQLite 的冲突]                         │
└─────────────────────────────────────────────────────────────┘
```

### 实现方式

```python
# 伪代码展示原理

# 1. 主对话：规划批次
def plan_batches(book_id: str, batch_size: int = 5) -> List[Batch]:
    outline = load_outline(book_id)
    lessons = extract_lessons(outline)
    return chunk(lessons, batch_size)

# 2. 主对话：并行启动 Tasks
for i, batch in enumerate(batches):
    task_prompt = f"""
    Process batch {i+1}/{len(batches)} for {book_id}
    Lessons: {batch.lesson_ids}
    
    Steps:
    1. Read current SQLite state
    2. For each lesson in batch:
       - /chapter-extract
       - /graph-normalize (local only, no cross-batch dedup yet)
    3. Write to SQLite with batch isolation
    4. Return: nodes_created, edges_created, status
    """
    
    launch_task(
        description=f"batch-{i+1}-{book_id}",
        prompt=task_prompt,
        subagent_type="kg-pipeline"
    )

# 3. 等待所有 Tasks 完成
results = await_all_tasks()

# 4. 主对话：统一归一化和 QA
# （这个阶段必须在单一对话完成，需要全局上下文）
/graph-normalize --mode cross-batch
@qa-reviewer --full-book
```

### 并发控制策略

**关键问题**: 多个 Task 同时写入 SQLite 会怎样？

**解决方案**:

```
策略 1: 批次级隔离（推荐）
- 每个 Task 只写入 runtime staging 表
- Task 完成后，主对话统一 apply 到 canonical 表
- 优点：无并发冲突
- 缺点：需要额外 apply 步骤

策略 2: 排他锁
- SQLite 事务锁
- 缺点：并行变串行

策略 3: 分库处理
- 每个 Task 有自己的临时数据库
- 最后合并
- 缺点：复杂度高
```

### 实际使用示例

```
User: @kg-pipeline 并行提取 chem-grade8，每批 5 课

AI:  好的！开始并行处理。
     
     分析大纲：共 30 课
     规划批次：6 批 × 5 课
     
     启动并行任务：
     ├─ Task 1: 课程 1-5 [启动]
     ├─ Task 2: 课程 6-10 [启动]
     ├─ Task 3: 课程 11-15 [启动]
     ├─ Task 4: 课程 16-20 [启动]
     ├─ Task 5: 课程 21-25 [启动]
     └─ Task 6: 课程 26-30 [启动]
     
     [等待所有 Task 完成...]
     
     批次完成状态：
     ✓ Task 1: 45 节点, 67 边
     ✓ Task 2: 38 节点, 52 边
     ✓ Task 3: 42 节点, 61 边
     ✓ Task 4: 35 节点, 48 边
     ✓ Task 5: 41 节点, 59 边
     ✓ Task 6: 29 节点, 38 边
     
     统一归一化（跨批次去重）... 
     统一 QA 检查...
     
     ✓ 完成！
     - 总节点: 230
     - 总边: 325
     - 去重合并: 23 个节点
```

### 优点
- **真正并行**: 多课程同时处理
- **无上下文爆炸**: 每个 Task 独立上下文
- **高效**: 适合大规模教材（100+ 课）
- **可扩展**: 可以增加更多工作节点

### 缺点
- 实现复杂
- 需要处理并发写入
- 跨批次去重延后到最终阶段

---

## 推荐选择

### 小规模（< 30 课）
**推荐方案 A 或 B**
- 手动分批足够
- 或使用批处理器脚本获得更好可追踪性

### 中规模（30-100 课）
**推荐方案 B**
- 使用 `batch_processor.py`
- 每批 5-10 课，手动触发
- 安全可控

### 大规模（> 100 课）或生产环境
**推荐方案 C**
- 利用 Task 工具并行
- 需要额外实现并发控制
- 最高效率

---

## 实现建议

### 立即可做的（零代码）

使用方案 B，手动控制批次：

```bash
# 第一次
python scripts/batch_processor.py --book-id X --action prompt
# [复制输出给 AI]

# 第二次
python scripts/batch_processor.py --book-id X --action prompt
# [复制输出给 AI]

# ...重复直到完成
```

### 短期实现（1-2 天）

完善 `batch_processor.py`：
- 添加 `--auto` 模式，自动生成并执行提示
- 添加进度条和报告
- 添加错误恢复

### 长期实现（1 周）

实现方案 C 的并行处理：
- 修改 `/chapter-extract` 支持批次级隔离
- 实现 Task 协调逻辑
- 添加并发控制
- 测试和优化

---

## 关键原则

无论哪种方案，都遵循：

1. **对话无状态，磁盘全状态**
   - SQLite 是唯一真实数据源
   - 对话上下文可随时丢弃

2. **批次大小控制**
   - 每批 5-10 课（大约 10-20 个 AI 回合）
   - 留足上下文余量

3. **幂等性**
   - 重新处理同一课程不会损坏数据
   - 可安全重试

4. **可观测性**
   - manifest 记录完整进度
   - 随时可以检查和恢复

---

## 下一步行动

**你觉得哪种方案最适合你的场景？**

我可以立即：
1. 使用方案 B 帮你处理一本教材（手动分批）
2. 完善 batch_processor.py 添加更多功能
3. 设计方案 C 的详细实现

或者你有其他想法？
