# Markdown 教材分块抽取方案

## 问题

OCR 后的 markdown 文件：
- 标题层级混乱（大部分都是 #）
- 没有明确的课时边界标记
- 页码标记可能不准确
- 难以准确分割每个课时

## 推荐方案：LLM 辅助分割

### 方案概述

使用 LLM 在生成 outline 时同时识别课时边界，生成带标记的中间文件。

### 实现步骤

#### 1. 增强 @outline-reader Agent

```markdown
## 新增功能：课时边界标记

### Phase 1: 分析文档结构
识别标题、页码、内容特征

### Phase 2: 生成 Outline + 边界标记
- 输出 outline.json（现有格式）
- 同时输出 marked_book.md（带课时标记）

### Phase 3: 边界标记格式
在 markdown 中插入标记：

```markdown
<!-- LESSON_START id="struct:book:lesson:1-1-1" title="课题1：开启化学之门" page="3" -->
... 课时内容 ...
<!-- LESSON_END id="struct:book:lesson:1-1-1" -->
```
```

#### 2. 修改提取脚本

```python
# extract_lesson_sqlite.py 新增策略

def parse_lesson_by_markers(md_content: str, lesson_id: str) -> str:
    """Strategy 0: 使用预处理的课时标记（推荐）"""
    start_marker = f'<!-- LESSON_START id="{lesson_id}"'
    end_marker = f'<!-- LESSON_END id="{lesson_id}"'
    
    start_idx = md_content.find(start_marker)
    if start_idx == -1:
        return None
    
    end_idx = md_content.find(end_marker, start_idx)
    if end_idx == -1:
        return None
    
    # 提取标记之间的内容
    lesson_content = md_content[start_idx:end_idx + len(end_marker)]
    return lesson_content
```

### 优势

✅ **准确性高**: LLM 理解内容语义，比规则匹配更准确  
✅ **容错性强**: 即使标题格式不规范也能识别  
✅ **可复用**: 标记后的文件可多次使用  
✅ **可验证**: 标记位置可以人工检查和修正  

### 实现成本

- 需要增强 @outline-reader Agent
- 需要修改 extract_lesson_sqlite.py
- 初次运行需要额外时间标记

## 快速方案：改进当前策略

如果不想大改，可以改进现有方法：

### 改进 Strategy 2: 标题 + 内容特征

```python
def parse_lesson_improved(md_content, lesson_title, page_start, page_end):
    """改进的标题匹配策略"""
    lines = md_content.split('\n')
    
    # 1. 找到标题可能的多个位置
    title_positions = []
    title_pattern = re.compile(re.escape(lesson_title), re.IGNORECASE)
    for i, line in enumerate(lines):
        if title_pattern.search(line):
            title_positions.append(i)
    
    # 2. 对每个位置评估可能性
    best_match = None
    for pos in title_positions:
        # 提取候选内容块
        candidate = extract_candidate_block(lines, pos)
        
        # 评估特征
        score = 0
        score += check_content_length(candidate, expected_length=3000)  # 合理长度
        score += check_keywords(candidate, ["学习目标", "知识点", "练习"])  # 课时特征
        score += check_page_markers(candidate, page_start, page_end)  # 页码匹配
        
        if best_match is None or score > best_match['score']:
            best_match = {'position': pos, 'content': candidate, 'score': score}
    
    return best_match['content'] if best_match else None
```

### 新增 Strategy: 基于目录结构

```python
def parse_lesson_by_toc(md_content, lesson_id, outline):
    """基于目录结构识别课时"""
    # 1. 从 outline 找到前后课时
    lessons = get_all_lessons(outline)
    current_idx = lessons.index(lesson_id)
    
    prev_lesson = lessons[current_idx - 1] if current_idx > 0 else None
    next_lesson = lessons[current_idx + 1] if current_idx < len(lessons) - 1 else None
    
    # 2. 在 markdown 中找前后课时的标题
    prev_pos = find_lesson_title(md_content, prev_lesson) if prev_lesson else 0
    curr_pos = find_lesson_title(md_content, lesson_id)
    next_pos = find_lesson_title(md_content, next_lesson) if next_lesson else len(md_content)
    
    # 3. 提取当前课时
    if curr_pos >= 0:
        return md_content[curr_pos:next_pos]
    
    return None
```

## 最佳实践推荐

### 方案 A: 快速改进（推荐）

1. 改进 Strategy 2，加入多特征评分
2. 新增基于目录结构的 Strategy
3. 优先级：
   - Strategy 0: 预处理标记（如果有）
   - Strategy 1: 页码标记（如果有）
   - Strategy 2: 改进的标题匹配
   - Strategy 3: 基于目录结构
   - Strategy 4: 兜底

### 方案 B: 长期方案

1. 增强 @outline-reader，生成带标记的 markdown
2. 提取时优先使用标记
3. 标记不准确时，回退到改进的策略

### 方案 C: LLM 实时分割（高成本）

1. 每次提取前，让 LLM 分析完整 markdown
2. LLM 返回当前课时的内容
3. 成本高，但准确性最高

## 实施建议

### 短期（立即可用）

改进现有脚本，添加更智能的分块逻辑：

```bash
# 修改 extract_lesson_sqlite.py
# 添加 parse_lesson_by_toc 和改进的 parse_lesson_improved
```

### 中期（更可靠）

增强 @outline-reader Agent：

```bash
# 修改 .claude/agents/outline-reader.md
# 添加课时边界标记功能
```

### 长期（自动化）

创建专门的预处理工具：

```bash
# 新建 scripts/mark_lesson_boundaries.py
# 自动识别并标记课时边界
```

## 参考代码

见下方实现...
