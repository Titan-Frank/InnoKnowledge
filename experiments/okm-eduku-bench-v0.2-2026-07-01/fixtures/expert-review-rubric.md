# 专家盲评 Rubric

## 盲评对象

每条记录包含同一个问题下不同系统生成的回答。评审者只能看到匿名 `method_code`，不能看到系统名称。

## 评分维度

每项 1-5 分：

- `accuracy`: 概念、事实、公式和推理是否正确
- `evidence_traceability`: 是否能追溯到教材证据，引用是否具体
- `stage_alignment`: 是否适合高中学段和当前教材语境
- `prerequisite_coverage`: 是否覆盖必要前置知识
- `misconception_diagnosis`: 是否能发现或纠正常见误解
- `diagnostic_question_quality`: 若生成诊断题，题目是否有教学价值
- `teacher_editability`: 教师是否容易审核、修改、用于课堂

## 备注要求

评审者至少在以下情况写备注：

- 回答含明显错误
- 引用不支持结论
- 缺少关键前置知识
- 解释过度超纲
- 诊断题不能检测真实理解

## 偏好选择

每个问题评完所有匿名回答后，评审者需选择一个最适合教师使用的回答；允许选择 `none`，但必须写原因。
