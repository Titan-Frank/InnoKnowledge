# OKM-EduKU-Bench v0.2 标注规范

## 目标

本标注用于评价系统能否从教材中构建证据约束的 Knowledge Object / Knowledge Unit。标注对象不是普通关键词，也不是教材目录标题，而是可被稳定寻址、定义、关联、证据支撑、教学化和服务调用的知识对象。

## 标注单位

每个 held-out section 需要两名标注者独立完成，再由仲裁者合并。

每个知识对象至少包含：

- `id`: 标注者内部临时 ID，例如 `ann1:n001`
- `name`: 标准名称
- `aliases`: 原文中可互指的别名
- `kind`: 仅允许 `entity`, `concept`, `property`, `process`, `event`, `method`, `rule`, `representation`, `resource`
- `definition`: 一句话说明“它是什么”
- `evidence_spans`: 支撑对象存在和定义的原文 span
- `semantic_core`: 核心命题、公式、条件、边界、反例、常见误解
- `pedagogical_profile`: 学习目标、难度、诊断问题、常见错误、评价任务、补救建议

每条关系至少包含：

- `source`: 起点对象临时 ID
- `target`: 终点对象临时 ID
- `type`: 仅允许 `is_a`, `instance_of`, `part_of`, `contains`, `has_property`, `uses`, `produces`, `depends_on`, `prerequisite_for`, `causes`, `affects`, `represents`, `about`, `same_as`, `related_to`
- `evidence_spans`: 支持该关系的原文 span

## 准入原则

- 不因一个词出现就标成知识对象；必须能被定义、引用、连接或教学使用。
- 教材目录标题可以作为候选，但不自动成为知识对象。
- 公式、图示、实验装置、模型和方法可以成为知识对象，只要有稳定教学功能。
- 如果对象只在当前句子中临时出现，且没有独立教学意义，标为证据短语，不标为对象。
- 常见误解只在原文支持、教师经验明确或题目需要诊断时记录。

## 证据 span

证据必须来自当前 section 原文。每个 span 记录：

- `span_id`
- `quote`
- `line_start`
- `line_end`
- `role`: `identity`, `definition`, `relation`, `formula`, `example`, `misconception`, `pedagogy`

证据 span 只需短而足够，不要整段复制。优先选定义句、公式句、实验结论句和图文说明。

## 仲裁输出

仲裁文件需要保留：

- 两名标注者原始输出路径
- 合并后的 objects / relations / evidence_spans
- 冲突记录：名称冲突、粒度冲突、关系类型冲突、证据冲突
- 仲裁决定和理由

## 一致性报告

至少报告：

- 节点匹配 F1
- 关系一致率
- 证据 span overlap
- `kind` Cohen's kappa
- `relation.type` Cohen's kappa
