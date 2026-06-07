# World Knowledge Standard V1.2

这是当前项目的统一世界知识分类标准。

它的目标不是“为某一本教材做标注”，而是建立一套能够稳定承载世界知识、同时可先在 K12 范围内完成验证的最小标准。

这套标准只追求三件事：

1. 一个知识对象只能先归入一种顶层类型
2. 分类结构、事实关系、领域教学信息彼此分离
3. 每个结论都可以回到证据

## 一、四层结构

统一知识体系采用四层主结构：

1. 顶层本体
   回答“这个对象到底是什么”
2. 概念分类表
   回答“它属于哪个受控分类体系”
3. 事实关系层
   回答“它和别的对象之间是什么关系”
4. 领域扩展层
   回答“它在特定领域或学段里如何被教学化、课程化”

另外有一个跨层的刚性要求：

- 证据与溯源平面
  它不是新的主分类层，但所有节点、关系、课程画像都应当能回到出处

## 二、顶层本体：9 类

| kind | 含义 | 判断标准 | K12 示例 |
|---|---|---|---|
| `entity` | 具体对象 | 能被稳定指称的对象、实体、系统、器官、器材、地点 | 氧气、细胞、地球、显微镜 |
| `concept` | 抽象概念 | 主要作为理解对象出现的抽象意义单元 | 分数、惯性、民主、递归 |
| `property` | 属性或可测特征 | 用来描述对象或过程的量、性质、状态 | 密度、速度、温度、颜色 |
| `process` | 持续过程 | 具有展开性、阶段性、变化性的运行或变化 | 蒸发、光合作用、推理 |
| `event` | 具体发生 | 可定位到一次发生、一个时段或一次活动 | 辛亥革命、一次实验观察 |
| `method` | 可复用做法 | 可以被重复执行的步骤、方法、算法、策略 | 过滤法、列方程法、归纳法 |
| `rule` | 规则或原理 | 具有约束性、规律性、法则性的稳定命题 | 牛顿第一定律、语法规则 |
| `representation` | 表征形式 | 用于表达知识的符号、图式、模型、图表 | 方程、地图、电路图、句法树 |
| `resource` | 资源载体 | 承载知识的媒介、材料、文献、课程资源 | 教材、论文、课程、视频 |

## 三、9 类的边界规则

为了保证抽取稳定性，以下规则写死：

1. `三角形`、`细胞`、`地球` 这类可被稳定指称的对象，优先判为 `entity`
2. `分数`、`惯性`、`公民权利` 这类主要作为理解对象出现的抽象项，优先判为 `concept`
3. `密度`、`速度`、`温度`、`颜色` 这类属性量，优先判为 `property`
4. `蒸发`、`光合作用`、`人口迁移` 这类持续展开的变化，优先判为 `process`
5. `鸦片战争`、`辛亥革命`、`课堂实验` 这类一次发生，优先判为 `event`
6. `过滤法`、`列方程法`、`归纳法` 这类可复用做法，优先判为 `method`
7. `牛顿第一定律`、`勾股定理`、`行为规范` 这类稳定规则，优先判为 `rule`
8. `方程`、`地图`、`五线谱`、`电路图` 这类表达形式，优先判为 `representation`
9. `教材`、`论文`、`视频` 这类承载知识的东西，优先判为 `resource`

如果一个对象同时像两类，冲突优先顺序如下：

1. 具体发生优先于通用做法
2. 表征形式优先于普通概念
3. 属性量优先于普通概念
4. 稳定规则优先于普通概念
5. 可指称对象优先于抽象描述

## 四、节点字段：只保留最小集合

每个节点只要求这些字段：

- `id`
- `name`
- `kind`
- `definition`
- `domains`
- `status`

可选字段：

- `subkind`
- `aliases`
- `knowledge_form`
- `learning_mode`
- `scope`
- `properties`
- `external_ids`
- `tags`
- `notes`

这里最重要的约束是：

- 顶层类型由 `kind` 决定
- 领域归属由 `domains` 决定
- 教学取向由 `learning_mode` 决定
- 检索辅助由 `tags` 决定

它们不能互相替代。

## 五、关系层：只保留 15 类稳定关系

- `is_a`
- `instance_of`
- `part_of`
- `contains`
- `has_property`
- `uses`
- `produces`
- `depends_on`
- `prerequisite_for`
- `causes`
- `affects`
- `represents`
- `about`
- `same_as`
- `related_to`

其中最核心的五组关系是：

- 分类关系：`is_a`、`instance_of`
- 结构关系：`part_of`、`contains`
- 机制关系：`causes`、`affects`、`depends_on`
- 学习关系：`prerequisite_for`
- 表征关系：`represents`

## 六、`schema` 和 `tag` 的区别

### `schema`

`schema` 是正式结构规则。

它规定：

- 对象类型
- 必填字段
- 合法关系
- 分类表结构
- 领域扩展结构

它回答的是：

- “这个东西到底是什么？”
- “它能和什么建立什么关系？”

### `tag`

`tag` 是检索词，不是主分类结构。

它只负责：

- 帮人找东西
- 做主题聚合
- 做粗粒度索引

它回答的是：

- “这个东西大概和什么有关？”

因此：

- `schema` 决定结构真值
- `tag` 只做检索辅助

## 七、教育学与哲学依据

这套标准不是随意拼出来的，它结合了本体论、知识组织、教育分类、知识哲学四类依据。

### 1. 顶层本体依据：BFO + OWL

采用“先给对象一个稳定本体类型，再谈关系和领域扩展”的思路，主要来自：

- BFO 的上层本体做法：先区分对象、过程等高层存在类型
- OWL 的知识表示做法：先定义类、关系、约束，再做机器可判定表示

这也是为什么本标准先固定 9 个顶层类，而不是直接拿标签堆。

### 2. 分类表依据：SKOS

概念分类表不直接等于节点本体，而是一个受控词表体系。

这对应 SKOS 的基本思想：

- 分类词条要有唯一标识
- 分类词条之间要能表达上下位与相关关系
- 分类词条和知识对象本身要区分

所以本项目里：

- `taxonomy` 是正式分类表
- `tag` 不是正式分类表

### 3. 教育领域划分依据：UNESCO / ISCED

世界知识虽然统一建模，但“学科归属”“学段归属”仍然需要参考教育领域中的标准划分。

这里采用的思路是：

- 顶层本体尽量跨学科稳定
- 领域与学段放在扩展层，而不是塞回节点本体

这与 UNESCO/ISCED 一类教育分类标准的做法一致：对象本身和教育编排层面应分离。

### 4. 知识形式依据：Ryle 与 Polanyi

`knowledge_form` 只保留两类：

- `propositional`
- `practical`

这样设计的依据是：

- Ryle 区分“知道某事”和“知道如何做”
- Polanyi 强调很多能力知识不能完全化成显性命题

因此，世界知识标准不能只收“命题知识”，还必须允许“做法知识”作为正式对象进入图谱。

### 5. 学习方式依据：Anderson 与 Krathwohl

`learning_mode` 采用四类：

- `factual`
- `conceptual`
- `procedural`
- `metacognitive`

原因是这四类直接对应修订版布鲁姆分类中的知识维度。

这里特别做了一个收敛：

- 不再把 `value` 放进 `learning_mode`

因为“价值”更适合作为课程目标、德育目标、领域画像中的扩展信息，而不是知识对象本体上的通用学习维度。

## 八、为什么这套结构更适合做研究

如果目标是发高水平论文，这套结构比单纯标签体系更有研究价值，原因有四个：

1. 它能把“对象是什么”和“对象与什么相关”分开
2. 它能把“世界知识结构”和“教学使用场景”分开
3. 它天然支持证据链和可追溯性
4. 它允许做跨学科、跨教材、跨学段对齐

这意味着它不仅是一个工程格式，还可以支撑下面这些研究问题：

1. 不同教材对同一知识对象的表征差异
2. 不同学科中共享概念的跨域对齐
3. K12 到高教之间知识粒度与先修结构的变化
4. 基于证据约束的教材知识图谱抽取
5. 统一世界知识本体下的课程画像投影

## 九、建议的研究评测指标

如果后续要投稿，建议至少围绕以下五类指标建立实验：

1. 覆盖率
   看 K12 知识点是否都能被映射进 9 类之一
2. 互斥性
   看同一对象是否能被稳定归入单一主类
3. 关系合法性
   看边类型是否符合约束，层级边是否无环
4. 证据完备性
   看节点、关系、课程画像是否都能回到证据
5. 领域投影一致性
   看同一节点在不同学科、学段中的 profile 是否稳定

## 十、当前版本的研究主张

当前 V1.2 的核心主张可以表述为：

1. 世界知识图谱的顶层分类不应直接等同于教材章节或标签体系
2. 统一知识标准至少应把本体分类、受控分类表、事实关系、领域扩展分开
3. 教学属性不应污染对象本体，但应通过扩展层投影回来
4. 证据溯源不应是附属功能，而应是跨层刚性约束
5. K12 可以作为统一知识标准的第一阶段压力测试场景

## 十一、参考链接

- OWL: [https://www.w3.org/OWL/](https://www.w3.org/OWL/)
- SKOS: [https://www.w3.org/TR/skos-reference/](https://www.w3.org/TR/skos-reference/)
- PROV-DM: [https://www.w3.org/TR/prov-dm/](https://www.w3.org/TR/prov-dm/)
- BFO: [https://github.com/BFO-ontology/BFO](https://github.com/BFO-ontology/BFO)
- Ryle（Stanford Encyclopedia of Philosophy）: [https://plato.stanford.edu/entries/ryle/knowing-how.html](https://plato.stanford.edu/entries/ryle/knowing-how.html)
- Polanyi《The Tacit Dimension》: [https://press.uchicago.edu/ucp/books/book/chicago/T/bo6035368.html](https://press.uchicago.edu/ucp/books/book/chicago/T/bo6035368.html)
- Anderson & Krathwohl 样章 PDF: [https://www.pearsonhighered.com/assets/samplechapter/0/1/3/3/0133830268.pdf](https://www.pearsonhighered.com/assets/samplechapter/0/1/3/3/0133830268.pdf)
- UNESCO / ISCED: [https://uis.unesco.org/en/topic/international-standard-classification-education-isced](https://uis.unesco.org/en/topic/international-standard-classification-education-isced)
- OECD Learning Compass 2030: [https://www.oecd.org/en/data/tools/oecd-learning-compass-2030.html](https://www.oecd.org/en/data/tools/oecd-learning-compass-2030.html)
