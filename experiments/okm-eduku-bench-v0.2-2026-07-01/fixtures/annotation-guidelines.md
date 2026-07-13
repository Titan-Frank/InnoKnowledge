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

学科语义和课程教学位置必须分开标注：

- `domain_profiles`: 记录学科、学科模式版本、该对象在本学科中的角色和专业属性。例如导数在数学中可标为“定义”，不能在这里写年级或教学任务。
- `curriculum_projections`: 记录课程、学段、年级、课程角色和该投影下的 `pedagogical_profile`。教学画像可包含学习目标、难度、诊断问题、常见错误、评价任务和补救建议。

每条关系至少包含：

- `source`: 起点对象临时 ID
- `target`: 终点对象临时 ID
- `type_zh`: 标注界面和人工文件使用中文关系名，只能从下表选择
- `type_code`: 系统交换时使用的稳定代码，由工具根据中文关系名填写，人工不得自造代码
- `evidence_spans`: 支持该关系的原文 span

| 中文关系名 | 稳定代码 |
| --- | --- |
| 是一种 | `is_a` |
| 是实例 | `instance_of` |
| 是组成部分 | `part_of` |
| 包含 | `contains` |
| 具有属性 | `has_property` |
| 使用 | `uses` |
| 产生 | `produces` |
| 依赖 | `depends_on` |
| 是前置知识 | `prerequisite_for` |
| 导致 | `causes` |
| 影响 | `affects` |
| 表示 | `represents` |
| 形式化表达 | `formalizes` |
| 应用于 | `applies_to` |
| 类似于 | `analogous_to` |
| 建模描述 | `models` |
| 主题是 | `about` |
| 相关 | `related_to` |

“同一对象”不是关系。若两个标注对象实际是同一知识身份，应在仲裁阶段合并对象并重映射引用，不能保留一条等同边。

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
- `relation.type_zh` Cohen's kappa
