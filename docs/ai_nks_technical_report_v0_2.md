# AI-Native Knowledge System (AI-NKS)

## Technical Report

### Version 0.2 — Conceptual and Technical Architecture

**Subtitle**

**Towards a Computable Knowledge Infrastructure for Human-AI Collaborative Learning, Reasoning, and Education**

---

**Version:** 0.2

**Status:** Historical Conceptual Draft

**Category:** Research Technical Report

**Primary Audience:** 智能教育博士生、教育技术研究者、知识工程研究者、AI Tutor 与教育智能体系统开发者

**Keywords:** AI-Native Knowledge System, AI-NKS, Knowledge Object, Knowledge Network, Knowledge Runtime, Knowledge Engineering, AI Tutor, Learning Analytics, Knowledge Graph, RAG, Agent, Human-AI Collaboration

---

> **Document role, reviewed 2026-07-13:** This Version 0.2 report preserves the project's early conceptual proposal. It is not the current executable contract, implementation status report, or roadmap. For current terminology use `docs/theory-decision-record.md` and `docs/ai-nks-v0.1.md`; for executable schema boundaries use `schemas/world-knowledge-standard.md`; for the implemented system use `docs/current-system-architecture.md`; for governed cross-domain discovery use `docs/interdisciplinary-knowledge-network.md`; and for the actively maintained engineering report use `docs/open_knowledge_map_technical_report.tex`.

---

# Abstract

人工智能正在改变知识体系的基本假设。传统知识体系主要面向人类阅读、学科分工和课程传递，其基本组织单位是教材、章节、课程和知识点；而在大语言模型、智能体和多模态 AI 参与知识活动之后，知识不仅需要被人理解，还需要能够被机器检索、解释、推理、组合、验证和调用。由此，知识体系正在从静态内容系统转向支持人机协同认知的动态基础设施。

本报告提出 **AI-Native Knowledge System (AI-NKS)**，即一种面向 AI 时代的可计算知识基础设施。AI-NKS 以 **Knowledge Object** 为基本管理单元，以 **Knowledge Network** 组织语义、学习和应用关系，以 **Knowledge Runtime** 支持对象级检索、知识组合、推理、工具调用和反馈写回，并通过持续演化机制实现知识版本管理、质量治理和人机协同维护。与传统知识图谱、数字教材和 RAG 知识库不同，AI-NKS 不仅关注知识如何存储和检索，还关注知识如何服务学习、如何被 AI 系统可靠调用、如何在教育实践中持续更新。

作为 Version 0.2，本报告在原有概念框架基础上进一步完善 AI-NKS 的核心定义、系统架构、Knowledge Object 数据模型、知识构建流水线、Knowledge Runtime 运行机制、智能教育应用场景、评价框架和治理风险。报告旨在回答四个问题：为什么 AI 时代知识体系必须重构，应该重构成什么样子，如何从技术上实现，以及智能教育研究者如何围绕这一体系开展理论、系统和实证研究。

---

# Executive Summary

AI 时代的教育变革并不仅仅是把大语言模型接入课堂，也不是让 AI Tutor 替代教师。更深层的变化在于：知识本身的组织方式正在发生变化。

过去，知识主要以教材、论文、课程和文档的形式存在。它们对人类阅读友好，却不一定适合 AI 系统稳定调用。大语言模型可以生成流畅回答，但如果缺乏可验证、可追溯、可组合的知识底座，就容易出现幻觉、过度泛化、来源不清和难以更新的问题。智能教育如果只依赖模型参数和文本检索，很难形成可持续、可治理、可复用的教育基础设施。

AI-NKS 的核心主张是：未来的知识体系应该以“可计算、可运行、可教学、可演化”的知识对象网络为基础，让人类学习和 AI 推理共享同一套知识基础设施。

AI-NKS 包含四个核心构件：

1. **Knowledge Object。** 知识不再只依附于教材章节，而是被建模为带有语义核心、教学属性、计算接口、证据来源和版本治理的对象。
2. **Knowledge Network。** 知识对象之间通过先修、组成、因果、支持、反驳、应用和跨学科映射等关系形成动态网络。
3. **Knowledge Runtime。** AI Tutor、Agent 和工具系统不再只检索文本片段，而是在运行时调用知识对象、组合对象、执行推理、生成解释并记录反馈。
4. **Continuous Evolution。** 知识体系通过人类专家审核、学习行为反馈、新研究监测和版本控制持续演化。

在教育场景中，AI-NKS 可以支持三类关键应用：

1. **AI-Native Digital Textbook。** 教材不再是固定内容，而是由 Knowledge Object 动态生成的多版本 Knowledge Realization。
2. **Grounded AI Tutor。** AI Tutor 的回答、提示、例题和评价必须绑定知识对象、学习目标、证据来源和推理链。
3. **Dynamic Learning Path and Assessment。** 学习路径和评价任务由 Knowledge Network、学习者画像和掌握度模型共同驱动。

AI-NKS 的技术实现不是单一模型或单一平台，而是一个知识基础设施栈，包括源资源层、知识对象层、本体与图谱层、检索索引层、运行时层、学习智能层和治理评价层。Version 0.2 建议先通过一个最小可行原型验证：选择一个边界清晰的领域，构建 100 到 300 个 Knowledge Object，建立对象级检索和 grounded AI Tutor，对比普通文本块 RAG 在准确性、可解释性、可追溯性和学习效果上的差异。

---

# Chapter 1. Why AI-Native Knowledge System?

## 1.1 问题的提出

知识体系是教育、科研和社会创新的基础设施。人类文明中的典籍分类、图书馆目录、学科体系、教材体系、数据库和互联网搜索，本质上都在回答同一个问题：如何组织不断增长的人类知识，并使知识能够被学习、传播、验证和应用。

在工业时代，现代知识体系主要围绕学科、课程和教材展开。学科负责划分知识边界，课程负责组织学习路径，教材负责呈现系统内容，教师负责解释、评价和情境化。这个体系非常有效地支撑了现代学校制度、专业人才培养和科学研究分工。

但大语言模型、智能体、多模态 AI 和工具调用技术正在改变知识活动的结构。AI 不只是新的教学工具，更是知识检索、知识解释、知识组织、知识推理和知识应用过程中的新参与者。这使传统知识体系面临一个更基础的问题：它们主要是为人类阅读和教学管理设计的，而不是为人机共同使用知识而设计的。

因此，AI 时代需要重新思考知识体系的基本单位、组织结构、运行方式和治理机制。

## 1.2 传统知识体系的历史合理性

传统学科体系并不是落后的体系。它有明确的历史合理性。

首先，人类个体认知能力有限。将复杂世界划分为相对稳定的学科，可以降低学习复杂度，使学习者按照由浅入深、由基础到应用的路径掌握知识。

其次，工业社会需要专业化人才。学科、专业和课程体系能够支持大规模标准化培养，使学校、考试、教材和职业资格形成稳定衔接。

再次，过去的信息检索和传播能力有限。图书馆分类、课程目录和教材章节能够降低寻找知识的成本，也能帮助教师在有限课时中组织教学。

因此，传统知识体系在“知识相对稀缺、更新周期较长、学习路径相对稳定、知识使用者主要是人类”的条件下非常有效。

问题并不在于传统体系没有价值，而在于 AI 时代的知识条件发生了改变。

## 1.3 AI 时代的四个断裂

AI 时代知识体系面临的挑战，可以概括为四个断裂。

### 1.3.1 从知识稀缺到知识过载

传统教材和课程的主要功能之一是选择知识。在知识获取困难的时代，教材提供了一个权威、压缩、可学习的知识版本。

今天，学习者面对的是论文、开源课程、视频、百科、问答系统、代码库和大模型生成内容的混合环境。知识不再稀缺，稀缺的是可靠组织、可信来源、学习顺序和质量判断。

因此，新知识体系不仅要“提供内容”，还要回答：哪些知识可信，哪些知识过时，哪些知识适合当前学习者，哪些知识可以支持特定任务。

### 1.3.2 从人类阅读到人机共用

传统知识表达主要面向人类。自然语言可以容纳语境、隐喻、省略和多义性，人类读者可以依靠背景知识进行补全。

AI 系统使用知识时则需要更明确的结构。一个 AI Tutor 要解释某个概念，需要知道定义、前置知识、适用范围、常见误解、例题和评价任务；一个 Agent 要完成复杂任务，需要知道可以调用哪些知识、哪些工具、哪些约束和哪些证据。

因此，知识不再只是 human-readable content，还需要成为 machine-actionable knowledge。

### 1.3.3 从学科目录到问题网络

现代重大问题越来越跨学科。智能教育涉及教育学、心理测量、学习科学、人工智能、数据伦理和平台治理；气候问题涉及物理、经济、政策和社会行为；AI 安全涉及机器学习、认知科学、法律、伦理和组织治理。

传统学科目录能够保存知识，却不擅长表达跨学科依赖、迁移和组合关系。AI-NKS 要支持的不是取消学科，而是在学科之上建立可计算的知识网络，使知识能够围绕问题、能力和任务重新组织。

### 1.3.4 从知识传递到知识运行

传统教育强调知识传递。AI 时代，知识还需要参与运行。

AI Tutor 需要动态解释知识，Agent 需要调用知识完成任务，学习分析系统需要根据学习行为更新学习者画像，课程设计系统需要自动组合知识对象形成学习路径。知识从“被阅读的内容”变为“被调用的资源”和“驱动智能行为的基础”。

这正是 AI-NKS 提出 Knowledge Runtime 的原因。

## 1.4 AI-NKS 的研究问题

AI-NKS 希望回答以下研究问题：

1. **知识体系为什么要变？** 传统以学科、课程和教材为中心的知识体系，在 AI 参与知识活动后出现了哪些结构性不足？
2. **知识体系应该变成什么样？** AI 时代的知识应如何被建模为可计算、可验证、可组合、可运行和可演化的对象网络？
3. **如何从技术上实现？** 如何构建 Knowledge Object、Knowledge Network、Knowledge Runtime、质量治理和持续演化流水线？
4. **如何在教育中验证？** AI-NKS 如何支持 AI-native 教材、grounded AI Tutor、动态学习路径和知识驱动评价？

## 1.5 本报告的贡献

本报告的贡献包括：

1. 提出 AI-Native Knowledge System 的概念定义和研究边界。
2. 将知识体系的基本单位从教材章节和知识点重构为 Knowledge Object。
3. 提出 Knowledge Object、Knowledge Network、Knowledge Runtime 和 Continuous Evolution 的整体架构。
4. 给出 Knowledge Object 的最小数据模型和技术实现建议。
5. 将 AI-NKS 与知识图谱、RAG、数字教材、LMS 和传统 AI Tutor 进行区分。
6. 提出面向智能教育的应用场景、评价指标和博士研究议题。

---

# Chapter 2. Related Work and Positioning

## 2.1 与知识图谱的关系

知识图谱通过实体、关系和属性表达知识结构，能够支持语义查询、关系推理和跨数据源整合。AI-NKS 继承了知识图谱的网络化思想，但并不等同于知识图谱。

传统知识图谱通常关注实体和关系，而 AI-NKS 关注“知识对象”作为学习、推理和运行的基本单位。一个 Knowledge Object 不只是一个实体节点，还包括定义、公式、适用条件、前置知识、常见误解、学习目标、评价任务、来源证据、版本信息和工具接口。

因此，AI-NKS 可以使用知识图谱作为底层表示之一，但其目标更宽：它要同时服务人类学习、AI 推理、Agent 执行和知识演化。

## 2.2 与 RAG 的关系

Retrieval-Augmented Generation (RAG) 通过检索外部文档或文本片段来增强大模型回答。RAG 是当前构建知识增强 AI 系统的重要方法，但普通 RAG 往往以文档 chunk 为基本检索单位。

文档 chunk 的问题在于：粒度不稳定，语义边界不清，关系表达弱，来源和版本治理不足，也很难直接表达教学语义。AI-NKS 可以被视为对象级 RAG 的知识底座：检索单位从文本片段升级为 Knowledge Object，检索结果不仅包含文本，还包含结构化关系、学习目标、证据来源、适用条件和可调用工具。

因此，AI-NKS 不排斥 RAG，而是希望将 RAG 从“文本块检索”推进到“知识对象检索与运行”。

## 2.3 与数字教材和课程平台的关系

数字教材把纸质教材转化为电子内容，课程平台负责组织课程、作业、讨论和学习记录。它们主要服务教学资源呈现和教学管理。

AI-NKS 则把教材和课程视为 Knowledge Realization，即知识对象在特定学习目标、学习者群体和媒介环境中的呈现形式。教材不再是知识体系的基础单位，而是由 Knowledge Object 生成、组合和适配的一种表达。

这意味着同一个知识对象可以生成高中版、大学版、工程应用版、AI Tutor 对话版、仿真实验版和评价任务版。知识维护一次，可以服务多个教育场景。

## 2.4 与 Intelligent Tutoring Systems 的关系

Intelligent Tutoring Systems (ITS) 长期关注学习者模型、领域模型、教学策略和反馈机制。AI-NKS 与 ITS 的关系非常密切，但关注层次不同。

ITS 通常是一个具体教学系统，AI-NKS 则是支撑多个教学系统的知识基础设施。AI-NKS 可以为 AI Tutor 提供领域知识对象、先修关系、常见误解、评价任务和解释依据，使 AI Tutor 的回答更加可追溯、可控制和可更新。

## 2.5 与学习技术标准的关系

AI-NKS 应尽量与已有开放标准兼容，而不是重新发明所有数据格式。

在知识表示层，可以参考 W3C RDF、OWL、SHACL、JSON-LD、SPARQL 和 PROV-O。RDF 提供资源和关系的图模型，OWL 支持本体表达，SHACL 可用于图数据约束验证，JSON-LD 适合在 Web 和 API 中表达 linked data，PROV-O 可用于来源和生成过程追踪。

在学习技术层，可以参考 1EdTech CASE、Caliper、Open Badges，以及 ADL xAPI。CASE 可用于能力与课程标准交换，Caliper 和 xAPI 可用于学习行为记录，Open Badges 可用于能力凭证表达。

AI-NKS 的关键不是替代这些标准，而是在知识对象、学习路径、AI Tutor 和学习数据之间建立可互操作的桥梁。

## 2.6 AI-NKS 的定位表

| 类型 | 基本单位 | 核心能力 | 主要局限 | AI-NKS 的增量 |
|---|---|---|---|---|
| 数字教材 | 页面、章节、资源 | 阅读、检索、展示 | 结构线性，难以动态重组 | 将教材变为 Knowledge Realization |
| 知识图谱 | 实体、关系、三元组 | 语义关联、查询、推理 | 教学语义和运行机制不足 | 引入 Knowledge Object、Runtime 和学习者模型 |
| RAG 知识库 | 文档块、向量 | 检索增强生成 | 粒度粗，关系弱，治理难 | 从 chunk 检索升级为对象级检索 |
| LMS | 课程、作业、用户数据 | 教学管理 | 不直接建模知识本体 | 课程引用统一知识对象 |
| ITS/AI Tutor | 学习者、任务、反馈 | 个性化教学 | 知识底座常封闭且难复用 | 以开放知识基础设施支撑多 Tutor |
| AI-NKS | 知识对象、关系、证据、运行接口 | 组织、推理、生成、执行、演化 | 初期建设成本高 | 形成跨教材、跨课程、跨 Agent 的知识基础设施 |

---

# Chapter 3. Definition and Core Principles of AI-NKS

## 3.1 AI-NKS 的定义

本报告将 AI-NKS 定义为：

> **AI-Native Knowledge System (AI-NKS) 是一种面向人机协同认知的可计算知识基础设施。它将知识建模为带有语义核心、教学属性、计算接口、证据来源和版本治理的 Knowledge Object，通过 Knowledge Network 表达对象之间的语义、学习和应用关系，通过 Knowledge Runtime 支持 AI 系统对知识对象的检索、组合、推理、解释、工具调用和反馈更新，并在人类专家与 AI 协同中持续演化。**

这个定义包含五个关键词。

1. **Object-based。** 知识不再只依附于教材章节，而是成为可独立引用、维护和运行的对象。
2. **Machine-actionable。** 知识不仅能被人阅读，还能被 AI 系统检索、验证、组合和调用。
3. **Pedagogically aware。** 知识对象包含学习目标、难度、前置知识、常见误解和评价任务。
4. **Runtime-enabled。** 知识进入 AI Tutor、Agent、推理引擎和工具调用流程。
5. **Governed and evolutionary。** 知识有来源、版本、审核、反馈和治理机制。

## 3.2 四个基本命题

### 命题一：知识是可计算对象

知识不应只被视为自然语言段落，而应被建模为具有结构、语义、关系、约束、证据和接口的计算对象。一个知识对象可以被检索、组合、验证、解释和调用。

### 命题二：知识是网络化存在

知识的意义来自关系。任何概念都与前置知识、相邻概念、应用场景、推导路径、反例和跨学科映射相关。AI-NKS 的组织结构不是树状目录，而是动态知识网络。

### 命题三：知识具有运行能力

AI 时代的知识不仅用于阅读，还用于运行。AI Tutor 使用知识生成解释，Agent 使用知识规划任务，工具系统根据知识执行计算，学习分析系统根据反馈更新掌握状态。

### 命题四：知识体系持续演化

知识并非一次性发布的静态库。新研究、新课程、新教材、学习反馈和专家审查都应进入演化机制。AI-NKS 需要版本管理、质量评价、影响分析和回滚机制。

## 3.3 八项设计原则

1. **Knowledge First。** 知识对象独立于教材、课程和平台而存在。
2. **AI Native。** 从设计之初就考虑 AI 调用、推理、解释和工具协同。
3. **Human-Centered。** AI-NKS 支持人类学习和判断，不把教育价值让渡给自动化系统。
4. **Problem Driven。** 支持围绕真实问题、能力和项目重组知识。
5. **Composable。** 知识对象可以被组合成教材、课程、解释、任务和项目。
6. **Computable。** 知识对象支持结构化检索、规则检查、图推理、向量检索和工具调用。
7. **Traceable。** 每个对象、关系、解释和更新都应能追溯来源和版本。
8. **Continuously Evolving。** 知识体系在人机协同中持续修订和优化。

## 3.4 研究边界

AI-NKS 不是一个具体教育产品，也不是单一知识图谱项目。它是一种面向 AI 时代的知识基础设施框架。

AI-NKS 关注：

1. 知识对象如何定义和建模。
2. 知识对象之间如何形成网络。
3. 知识如何被 AI 系统调用和运行。
4. 知识质量、来源、版本和治理如何管理。
5. AI-NKS 如何支撑教育场景中的教材、Tutor、路径和评价。

AI-NKS 不直接等同于：

1. 某个具体 AI Tutor 产品。
2. 某个课程平台或 LMS。
3. 某个大模型训练方法。
4. 某个单一领域知识库。

---

# Chapter 4. Knowledge Object Model

## 4.1 为什么 Knowledge Object 是基本单位

传统教材中的“知识点”通常依附于章节结构，边界由教材作者决定。不同教材对同一知识可能采用不同名称、顺序和解释方式。对于人类学习者而言，这种差异可以通过教师解释和个人理解弥合；但对于 AI 系统而言，边界不清会导致检索不稳定、解释不一致、来源不可追踪和跨教材对齐困难。

AI-NKS 将 Knowledge Object 作为基本单位，目的是把知识从教材章节中解耦出来。一个 Knowledge Object 应该能够被唯一标识、独立引用、版本管理、关系连接、教学适配和运行调用。

## 4.2 Knowledge Object 的六类字段

一个最小可用 Knowledge Object 至少包含六类字段。

### 4.2.1 Identity

Identity 描述知识对象的身份。

核心字段包括：

1. ID 或 URI。
2. 标题和别名。
3. 学科领域。
4. 语言。
5. 版本。
6. 状态，例如 draft、reviewed、deprecated。
7. 授权和使用条件。

### 4.2.2 Semantic Core

Semantic Core 是知识对象的语义核心，也可以称为 Knowledge Skeleton。

核心字段包括：

1. 定义。
2. 核心命题。
3. 公式或形式化表达。
4. 前提条件。
5. 适用范围。
6. 边界条件。
7. 反例。
8. 常见误解。

### 4.2.3 Relational Profile

Relational Profile 描述知识对象在知识网络中的位置。

核心关系包括：

1. prerequisite，前置知识。
2. successor，后续知识。
3. part-of，组成关系。
4. is-a，类型关系。
5. causes，因果关系。
6. supports，支持关系。
7. contradicts，反驳或冲突关系。
8. applies-to，应用关系。
9. analogous-to，类比关系。
10. aligned-with，跨教材或跨标准映射关系。

### 4.2.4 Pedagogical Profile

Pedagogical Profile 使 Knowledge Object 能够服务教育，而不是只服务知识存储。

核心字段包括：

1. 学习目标。
2. 认知层级，例如理解、应用、分析、创造。
3. 难度等级。
4. 推荐学习对象。
5. 前置诊断问题。
6. 常见错误和迷思。
7. 例题和案例。
8. 练习和评价任务。
9. 补救学习建议。
10. 拓展学习建议。

### 4.2.5 Computational Affordance

Computational Affordance 描述知识对象如何被 AI 系统调用。

核心字段包括：

1. 检索文本。
2. 向量表示。
3. 图表示。
4. 规则或约束。
5. 可执行代码。
6. 工具绑定。
7. 仿真接口。
8. 结构化输出模板。

### 4.2.6 Governance Metadata

Governance Metadata 描述知识对象的来源、质量和演化。

核心字段包括：

1. 来源证据。
2. 作者。
3. 审核者。
4. 生成方式。
5. 置信度。
6. 最近更新时间。
7. 版本差异。
8. 影响范围。
9. 风险标注。
10. 回滚记录。

## 4.3 Knowledge Object 示例

以下示例展示一个简化的 JSON-LD 风格 Knowledge Object。

```json
{
  "@context": "https://ai-nks.example.org/context/v0.2",
  "@id": "urn:ainks:physics:newton-second-law:v1",
  "@type": "KnowledgeObject",
  "title": "Newton's Second Law",
  "aliases": ["F = ma", "牛顿第二定律"],
  "domain": ["Physics", "Mechanics"],
  "language": ["en", "zh"],
  "version": "1.0.0",
  "status": "reviewed",
  "semanticCore": {
    "definition": "Force equals the rate of change of momentum; under constant mass, F = ma.",
    "formalExpression": "F = m * a",
    "conditions": ["inertial reference frame", "constant mass for F = ma form"],
    "scope": ["classical mechanics", "macroscopic low-speed motion"],
    "misconceptions": ["force is required to maintain constant velocity"]
  },
  "relations": {
    "prerequisite": [
      "urn:ainks:math:vector:v1",
      "urn:ainks:math:derivative:v1"
    ],
    "appliesTo": [
      "urn:ainks:engineering:robotics-control:v1",
      "urn:ainks:engineering:vehicle-dynamics:v1"
    ],
    "extendsTo": [
      "urn:ainks:physics:lagrangian-mechanics:v1"
    ]
  },
  "pedagogy": {
    "learningObjectives": [
      "explain the relationship between force, mass, and acceleration",
      "solve simple motion problems using F = ma"
    ],
    "difficulty": "secondary-to-undergraduate",
    "commonErrors": [
      "confusing velocity with acceleration",
      "ignoring net force"
    ],
    "assessmentItems": [
      "conceptual-question-001",
      "simulation-task-004"
    ]
  },
  "computationalAffordance": {
    "retrievalText": "Newton's second law relates net force, mass, and acceleration...",
    "toolBindings": ["physics_simulator.newtonian_motion"],
    "embeddingProfile": "text-formula-v1"
  },
  "provenance": {
    "sources": ["textbook:isbn:...", "expert-review:2026-06-26"],
    "generatedBy": "llm-assisted-extraction",
    "reviewedBy": ["domain-expert", "education-expert"],
    "confidence": 0.93
  }
}
```

## 4.4 Knowledge Object、Skeleton、Graph 与 Realization 的关系

为了避免概念混淆，本报告将四者关系定义如下：

1. **Knowledge Object** 是 AI-NKS 的基本管理单元。
2. **Knowledge Skeleton** 是 Knowledge Object 中相对稳定的语义核心。
3. **Knowledge Realization** 是 Knowledge Object 面向特定学习者、任务、语言和媒介的表达实例。
4. **Knowledge Graph / Knowledge Network** 组织不同 Knowledge Object 之间的关系。

可以用如下结构表示：

```text
Knowledge Network
  connects Knowledge Objects

Knowledge Object
  contains Semantic Core / Knowledge Skeleton
  contains Pedagogical Profile
  contains Computational Affordance
  contains Governance Metadata
  links to multiple Knowledge Realizations
```

## 4.5 Knowledge Object 的粒度问题

Knowledge Object 的粒度是 AI-NKS 的关键研究问题。对象粒度过粗，会退化为文档 chunk；对象粒度过细，会导致网络复杂、维护成本高、教学意义弱。

建议在教育场景中采用多粒度策略：

1. **Concept Object。** 概念，例如“加速度”“监督学习”。
2. **Proposition Object。** 命题或定理，例如“牛顿第二定律”。
3. **Procedure Object。** 方法或步骤，例如“梯度下降算法”。
4. **Skill Object。** 能力，例如“解释混淆矩阵”。
5. **Task Object。** 任务，例如“用线性回归预测房价”。
6. **Misconception Object。** 常见误解，例如“训练集准确率高就代表模型泛化好”。

不同对象类型可以共存，并通过关系连接。

---

# Chapter 5. Knowledge Network and Representation Model

## 5.1 从树状目录到知识网络

传统教材通常采用树状目录。树状结构适合线性阅读，却不适合表达知识之间的多重依赖。一个概念可能同时依赖数学、物理和工程背景，也可能在多个应用领域中出现。

AI-NKS 采用 Knowledge Network 作为知识组织结构。网络不是取消课程顺序，而是让课程顺序成为网络上的一种可生成路径。

## 5.2 关系类型

AI-NKS 至少需要表达五类关系。

### 5.2.1 语义关系

语义关系描述知识本身的概念结构，包括 is-a、part-of、same-as、related-to、contradicts 等。

### 5.2.2 学习关系

学习关系描述学习顺序和认知依赖，包括 prerequisite、successor、easier-than、harder-than、remediate-by 等。

### 5.2.3 证据关系

证据关系描述知识对象与来源、数据、实验和文献之间的支持关系，包括 supported-by、derived-from、reviewed-by、contested-by 等。

### 5.2.4 应用关系

应用关系描述知识在任务中的使用方式，包括 applies-to、used-in、solves、requires-tool 等。

### 5.2.5 演化关系

演化关系描述版本和变更，包括 replaces、updates、deprecated-by、forked-from、merged-with 等。

## 5.3 三层知识表示模型

AI-NKS 的知识表示可以分为三层。

```text
Knowledge Network
        |
Knowledge Object / Skeleton
        |
Knowledge Realization
```

### 5.3.1 Knowledge Network

Knowledge Network 回答“知识在哪里”和“知识如何关联”。它负责导航、路径生成、跨学科连接和影响范围分析。

### 5.3.2 Knowledge Object / Skeleton

Knowledge Object 回答“知识是什么”。其中的 Skeleton 表达定义、命题、公式、前提、条件和边界，是知识对象最稳定的部分。

### 5.3.3 Knowledge Realization

Knowledge Realization 回答“知识如何被学习、解释和使用”。同一对象可以生成不同表达：

1. 教材段落。
2. AI Tutor 对话解释。
3. 例题和解析。
4. 视频脚本。
5. 交互式仿真。
6. 编程案例。
7. 评价任务。

## 5.4 多模态知识表示

AI-NKS 不应把所有知识强行压缩成文本。许多知识依赖公式、图像、三维模型、代码、实验数据、仿真和交互行为。

多模态 Knowledge Object 可以包含：

1. 文本。
2. 数学公式。
3. 图示。
4. 视频片段。
5. 音频。
6. 数据集。
7. 代码。
8. 仿真实验。
9. 交互式任务。

多模态资源属于 Realization 或 Evidence，不应与知识对象的语义核心混为一谈。这样才能保持知识对象的稳定，同时允许表达方式不断更新。

## 5.5 与开放标准的兼容

AI-NKS 可以采用分层技术标准：

1. **JSON-LD** 用于 Web API 和对象交换。
2. **RDF / OWL** 用于语义关系和本体表达。
3. **SHACL** 用于对象和关系的结构约束验证。
4. **SPARQL** 用于图查询。
5. **PROV-O** 用于知识来源和生成过程追踪。
6. **CASE** 用于课程标准和能力框架对齐。
7. **xAPI / Caliper** 用于学习行为记录。

这些标准不必全部在 MVP 中实现，但它们提供了 AI-NKS 向开放生态演化的接口方向。

---

# Chapter 6. Knowledge Construction and Evolution Pipeline

## 6.1 从知识资源到知识对象

AI-NKS 的构建不是简单把资料放入数据库，也不是把文档切成 chunk 后做向量检索。它需要将资源转化为可验证、可治理、可运行的 Knowledge Object。

整体流程如下：

```text
Source Ingestion
  -> Segmentation and Evidence Anchoring
  -> LLM-Assisted Extraction
  -> Knowledge Object Generation
  -> Schema Validation
  -> Ontology Alignment
  -> Expert Review
  -> Publication
  -> Runtime Use
  -> Feedback and Evolution
```

## 6.2 Source Ingestion

知识来源可以包括：

1. 教材。
2. 学术论文。
3. 课程大纲。
4. 教学视频和字幕。
5. 实验数据。
6. 代码库。
7. 专家笔记。
8. 学习者常见问题。

进入系统的每个来源都需要记录元数据，包括作者、版本、出版时间、授权状态、来源位置和可信等级。

## 6.3 Segmentation and Evidence Anchoring

在抽取知识之前，系统需要对资源进行切分，并保留证据锚点。例如：

1. 教材页码和段落 ID。
2. 论文 DOI、章节和页码。
3. 视频时间戳。
4. 代码文件和行号。
5. 数据集版本。

证据锚点是 AI-NKS 可信性的基础。没有证据锚点，知识对象就会变成无法追溯的生成内容。

## 6.4 LLM-Assisted Extraction

大语言模型可以辅助抽取：

1. 概念。
2. 定义。
3. 公式。
4. 条件。
5. 关系。
6. 例题。
7. 学习目标。
8. 常见误解。
9. 评价任务。

但 LLM 抽取不能直接进入正式知识库。每个抽取结果都需要保留来源、置信度和待审核状态。

## 6.5 Knowledge Object Generation

系统根据标准 Schema 生成 Knowledge Object。这个阶段的目标是把抽取结果转换为统一对象格式。

对象生成要处理三个问题：

1. **去重。** 不同教材可能表达同一知识。
2. **归一化。** 同一概念可能有不同名称。
3. **结构化。** 将自然语言解释拆分为定义、条件、边界、例题和误解。

## 6.6 Schema Validation Gate

对象生成后必须经过结构验证。验证内容包括：

1. 必填字段是否完整。
2. ID 是否唯一。
3. 关系类型是否合法。
4. 前置知识是否存在。
5. 版本格式是否正确。
6. 来源证据是否绑定。
7. 教学属性是否符合目标对象类型。

可以使用 JSON Schema、SHACL 或自定义规则进行验证。

## 6.7 Ontology Alignment Gate

本体对齐是 AI-NKS 的关键难点。系统需要判断不同来源中的概念是否相同、相近、上下位或冲突。

例如：

1. “速度变化率”和“加速度”可能是同一概念。
2. “模型准确率”和“分类准确率”可能是上下文相关概念。
3. “AI literacy”和“AI competency”可能部分重叠但不完全等同。

对齐结果不应只有 same-as，还应包括：

1. exact-match。
2. close-match。
3. broader-than。
4. narrower-than。
5. related-but-distinct。
6. conflict。
7. uncertain。

## 6.8 Expert Review Gate

高质量 AI-NKS 必须有人类专家参与。专家审核的重点包括：

1. 语义核心是否准确。
2. 关系是否合理。
3. 学习目标是否合适。
4. 常见误解是否真实。
5. 评价任务是否有效。
6. 来源证据是否充分。
7. 对齐关系是否可靠。

AI 负责提高知识工程效率，人类专家负责价值判断、学术判断和教育判断。

## 6.9 Publication and Versioning

审核通过后，Knowledge Object 进入发布状态，并同步生成：

1. 对象库。
2. 图索引。
3. 向量索引。
4. API。
5. 版本记录。
6. 变更日志。

版本管理应支持：

1. major 更新，语义核心发生重要变化。
2. minor 更新，新增关系、例题、表达或评价任务。
3. patch 更新，修正文字、来源或小错误。

## 6.10 Feedback and Evolution

Knowledge Runtime 使用知识对象时会产生反馈。反馈来源包括：

1. 学习者提问。
2. AI Tutor 回答错误。
3. 教师修改。
4. 学习评价结果。
5. 新论文或新教材。
6. 运行时工具输出。

这些反馈进入演化队列，由 AI 初步聚类和建议更新，人类专家审核后发布新版本。

---

# Chapter 7. Knowledge Runtime

## 7.1 从知识存储到知识运行

传统知识库主要解决存储和查询问题。AI-NKS 更进一步，要求知识能够进入任务执行过程。

Knowledge Runtime 是 AI-NKS 的运行机制。它负责根据任务目标、学习者状态和上下文约束，动态检索、组合、验证和调用 Knowledge Object，并将运行过程产生的反馈写回知识体系。

## 7.2 Runtime 的六步流程

### 7.2.1 Task Interpretation

Runtime 首先识别任务类型。例如：

1. 学习者要求解释概念。
2. 教师要求生成课堂活动。
3. Agent 要解决工程问题。
4. 系统要诊断学习者误解。

任务解释需要读取学习目标、学习者画像、领域范围、输出形式和约束条件。

### 7.2.2 Object-Level Retrieval

Runtime 从 Knowledge Network 中检索相关对象，而不是只检索文本片段。

检索策略可以组合：

1. 关键词检索。
2. 向量检索。
3. 图邻域扩展。
4. 规则过滤。
5. 学习者状态过滤。

检索结果必须包含对象 ID、版本、来源、置信度和适用条件。

### 7.2.3 Knowledge Composition

复杂任务往往需要多个对象组合。例如，一个“为什么神经网络会过拟合”的解释，可能需要组合：

1. 训练集和测试集。
2. 模型容量。
3. 泛化误差。
4. 正则化。
5. 数据分布。
6. 交叉验证。

Runtime 根据关系类型组织解释顺序，并根据学习者水平决定展开深度。

### 7.2.4 Reasoning and Tool Use

当任务需要计算或验证时，Runtime 可以调用工具。例如：

1. 公式计算器。
2. 代码执行环境。
3. 仿真平台。
4. 数据库查询。
5. 可视化工具。
6. 规则推理引擎。

知识对象可以声明 toolBindings，使 Runtime 知道何时调用哪个工具。

### 7.2.5 Grounded Generation

生成面向学习者或教师的表达时，Runtime 需要明确绑定使用的 Knowledge Object。一个 grounded AI Tutor 回答应包含：

1. 使用了哪些知识对象。
2. 每个对象的来源和版本。
3. 解释中的关键推理步骤。
4. 哪些内容是事实，哪些是教学类比。
5. 哪些内容是推测或建议。

### 7.2.6 Feedback and Update

Runtime 记录：

1. 学习者是否理解。
2. 哪些解释有效。
3. 哪些题目暴露误解。
4. 哪些回答被教师修改。
5. 哪些对象可能存在错误。

这些信息进入演化机制，用于改进知识对象、学习路径和教学表达。

## 7.3 Runtime 架构

AI-NKS 的系统架构可以表示为：

```text
Application Layer
  AI Tutor | AI-native Textbook | Curriculum Design | Research Assistant

Learning Intelligence Layer
  Learner Model | Mastery Estimation | Learning Path Planning | Assessment

Knowledge Runtime Layer
  Object Retrieval | Knowledge Composition | Reasoning | Tool Calling | Explanation

Indexing and Retrieval Layer
  Graph Index | Vector Index | Symbolic Rules | Hybrid Retrieval

Knowledge Object Layer
  Semantic Core | Pedagogical Profile | Computational Affordance | Provenance

Ontology and Governance Layer
  Ontologies | Schemas | Alignment | Validation | Versioning | Review

Source and Evidence Layer
  Textbooks | Papers | Videos | Simulations | Expert Notes | Learning Logs
```

## 7.4 Runtime 与 Agent 的分工

Agent 和 Runtime 的关系可以理解为：

1. Agent 负责“做什么”，即任务理解、计划和交互。
2. Runtime 负责“知道什么”，即提供可靠、结构化、可追溯的知识。
3. Tool 负责“如何执行”，即计算、仿真、查询和生成外部结果。

这种分工可以降低幻觉，提高可解释性，并使知识更新不依赖重新训练模型。

## 7.5 AI-NKS 与普通 RAG 的差异

| 维度 | 普通 RAG | AI-NKS Runtime |
|---|---|---|
| 检索单位 | 文档 chunk | Knowledge Object |
| 关系表达 | 通常较弱 | 显式 Knowledge Network |
| 教学语义 | 通常缺失 | 学习目标、难度、误解、评价任务 |
| 来源治理 | 文档级或片段级 | 对象级来源、版本、审核 |
| 工具调用 | 依赖 prompt 编排 | 对象声明 toolBindings |
| 反馈演化 | 常不闭环 | 运行反馈进入演化队列 |

---

# Chapter 8. AI-Native Education Applications

## 8.1 为什么教育是 AI-NKS 的首个验证场景

教育既是知识传播体系，也是知识组织体系。教材、课程、课堂活动、评价、学习路径和教师专业判断都依赖对知识的组织。

当前数字教育资源已经丰富，但仍主要围绕课程和教材章节组织。AI Tutor 也常依赖文本检索或模型参数回答问题，缺少统一知识对象、来源追踪和可更新机制。

AI-NKS 为智能教育提供了一种新底座：教材、课程、习题、实验、AI Tutor 和学习分析系统共同引用同一套 Knowledge Object。

## 8.2 AI-Native Digital Textbook

在 AI-NKS 中，教材不再是知识体系的基础单位，而是 Knowledge Realization 的一种形式。

同一个 Knowledge Object 可以生成：

1. 面向初学者的直观解释。
2. 面向大学生的理论推导。
3. 面向工程师的应用案例。
4. 面向教师的课堂活动设计。
5. 面向 AI Tutor 的对话脚本。
6. 面向评价系统的题目和 rubric。

AI-native 数字教材的特点是：

1. **动态生成。** 根据学习者背景、目标和语境生成不同版本。
2. **对象引用。** 每段内容都绑定知识对象。
3. **可更新。** 知识对象更新后，相关教材表达可以同步更新。
4. **可追踪。** 教师和学习者可以追溯内容来源。
5. **可组合。** 教材可以围绕项目、问题或能力重新组织。

## 8.3 Grounded AI Tutor

传统 AI Tutor 主要依赖大模型对话。AI-NKS 中的 AI Tutor 则建立在 Knowledge Runtime 之上。

一个 grounded AI Tutor 的回答流程如下：

1. 识别学习者问题和学习状态。
2. 检索相关 Knowledge Object。
3. 判断前置知识是否缺失。
4. 组合解释路径。
5. 调用必要工具或例题。
6. 生成适合当前学习者的解释。
7. 提供练习或诊断问题。
8. 记录学习反馈。

这种 Tutor 的价值不在于“回答更像人”，而在于回答更可追溯、可验证、可更新、可教学。

## 8.4 Dynamic Learning Path

传统课程路径通常固定。AI-NKS 可以根据 Knowledge Network 和学习者画像生成动态路径。

路径生成需要考虑：

1. 学习目标。
2. 前置知识掌握状态。
3. 知识对象难度。
4. 学习者兴趣和任务。
5. 常见误解。
6. 评价结果。
7. 时间约束。

例如，如果学习者在“导数”上存在缺口，系统可以在学习“梯度下降”前插入补救对象；如果学习者已掌握基础数学，则可以直接进入机器学习应用任务。

## 8.5 Knowledge-Driven Assessment

AI-NKS 可以支持知识驱动评价。每个评价任务都应绑定：

1. 目标 Knowledge Object。
2. 对应学习目标。
3. 认知层级。
4. 评分标准。
5. 常见错误模式。
6. 反馈建议。

这种评价不只是判断对错，还能诊断学习者在哪些知识对象或关系上存在缺口。

## 8.6 教师角色的变化

AI-NKS 不应削弱教师，而应增强教师的专业判断。

教师在 AI-NKS 中可以承担：

1. 知识对象审核者。
2. 学习路径设计者。
3. 教学表达选择者。
4. 评价任务改编者。
5. AI Tutor 行为监督者。
6. 学习者发展支持者。

AI 负责提高资源生成和组织效率，教师负责教育价值、课堂情境和学生发展。

---

# Chapter 9. Evaluation, Governance, and Risks

## 9.1 为什么需要评价框架

AI-NKS 不是只要能运行就算成功。作为教育基础设施，它必须回答质量、效果、安全、公平和治理问题。

评价应覆盖六个层级。

| 层级 | 评价问题 | 指标示例 |
|---|---|---|
| Knowledge Object | 对象是否准确、完整、可复用 | 字段完整率、专家准确率、来源覆盖、版本稳定性 |
| Knowledge Network | 关系是否正确、可导航 | 关系 precision/recall、先修关系准确率、路径质量 |
| Runtime | 调用知识是否可靠 | object grounding rate、引用准确率、幻觉率、工具调用成功率 |
| AI Tutor | 是否促进学习 | 前后测、迁移任务、迷思纠正率、解释满意度 |
| 教师工作流 | 是否真正减负增效 | 备课时间、资源复用率、审核成本、教师可控性 |
| 治理 | 是否安全可信 | 隐私合规、偏见检测、错误修复时间、回滚能力 |

## 9.2 Knowledge Object 质量评价

对象级评价可以包括：

1. 语义准确性。
2. 字段完整性。
3. 来源充分性。
4. 关系合理性。
5. 教学适配性。
6. 版本稳定性。
7. 可复用性。

核心对象应采用专家双审或多审机制。

## 9.3 Runtime 评价

Runtime 评价重点包括：

1. 是否检索到正确对象。
2. 是否遗漏关键前置对象。
3. 是否使用过时对象。
4. 是否生成未被对象支持的内容。
5. 是否正确调用工具。
6. 是否记录反馈和来源。

可以设置 groundedness 指标：回答中有多少关键声明可以追溯到知识对象和证据来源。

## 9.4 教育效果评价

教育场景中，AI-NKS 需要通过学习实证验证。

可能的研究设计包括：

1. AI-NKS Tutor 与普通 LLM Tutor 对比。
2. 对象级 RAG 与 chunk RAG 对比。
3. AI-native 教材与传统数字教材对比。
4. 动态学习路径与固定课程路径对比。
5. 教师使用 AI-NKS 备课前后的工作流分析。

指标包括前后测、迁移任务、长期保持、学习动机、认知负荷、教师满意度和系统可控性。

## 9.5 治理风险

AI-NKS 作为教育基础设施，必须处理以下风险。

### 9.5.1 知识准确性风险

LLM 抽取可能错误，本体对齐可能误合并概念，自动生成的解释可能过度简化。因此，核心对象必须经过验证和审核。

### 9.5.2 自动化权威风险

如果 AI-NKS 的输出被误认为不可质疑的标准答案，会削弱批判性思维。系统应显示来源、置信度、争议状态和替代表达。

### 9.5.3 学习者隐私风险

个性化学习路径依赖学习行为数据。系统应遵循数据最小化、用途限制、访问控制、可撤回和可删除原则。

### 9.5.4 偏见与公平风险

知识对象、案例和评价任务可能反映特定文化、语言或群体偏见。系统需要公平性审查和多样化来源。

### 9.5.5 版权与来源风险

教材、论文、视频和课程资源进入 AI-NKS 时必须处理授权、引用和可再利用边界。

### 9.5.6 教育价值风险

过度个性化可能让学习者只接触舒适内容，缺少共同知识、挑战性任务和社会互动。AI-NKS 应支持个性化，但不能把学习简化为效率最大化。

---

# Chapter 10. Implementation Roadmap and Research Agenda

## 10.1 最小可行原型

建议 AI-NKS 的第一个原型选择一个边界清晰、知识结构稳定、评价容易设计的领域，例如：

1. 高中到大学基础力学。
2. 人工智能导论。
3. 统计学基础。
4. 程序设计基础。

MVP 目标不是覆盖所有知识，而是验证核心闭环。

最小原型可以包括：

1. 100 到 300 个 Knowledge Object。
2. 3 到 5 类关系：prerequisite、part-of、applies-to、contradicts、example-of。
3. 2 类 Realization：教材解释和 Tutor 回答。
4. 对象级检索 API。
5. grounded AI Tutor。
6. 专家审核面板。
7. 学习行为日志与反馈回写机制。

## 10.2 推荐技术栈

| 模块 | 推荐实现 |
|---|---|
| 对象 Schema | JSON Schema + JSON-LD |
| 语义网络 | RDF/OWL/SKOS 或 Neo4j 属性图 |
| 约束验证 | SHACL、JSON Schema、自定义质量规则 |
| 检索 | BM25 + 向量检索 + 图邻域扩展 |
| LLM 编排 | RAG、tool calling、structured output |
| 运行时服务 | Python/FastAPI 或 Node 服务 |
| 学习行为 | xAPI 或 Caliper 风格日志 |
| 版本与溯源 | Git-like versioning + PROV-O 风格 provenance |
| 审核工作流 | review queue、diff、approval、rollback |

## 10.3 博士研究议题

AI-NKS 可以支撑一组智能教育博士研究方向。

### 10.3.1 Knowledge Object 粒度研究

研究问题：知识对象应该按概念、命题、技能、任务还是误解切分？不同粒度如何影响检索质量、学习路径和 AI Tutor 效果？

### 10.3.2 Knowledge Skeleton 自动抽取

研究问题：如何从教材、论文和课堂材料中抽取稳定语义核心，并区分定义、条件、边界、推理和误解？

### 10.3.3 对象级 RAG 与文本块 RAG 对比

研究问题：Knowledge Object 检索是否比普通 chunk 检索在准确性、可解释性、幻觉率和学习效果上更优？

### 10.3.4 Grounded AI Tutor

研究问题：如何让 AI Tutor 的每个解释绑定知识对象、学习目标、证据来源和诊断任务？

### 10.3.5 学习路径规划

研究问题：如何结合先修关系、学习者画像、掌握度估计和目标任务生成个性化路径？

### 10.3.6 知识演化与质量治理

研究问题：当新研究成果、教材修订或学习反馈出现时，如何评估其对已有知识对象和学习资源的影响？

### 10.3.7 多模态 Knowledge Realization

研究问题：如何从同一 Knowledge Skeleton 自动生成文本、图示、代码、仿真、实验活动和评价任务？

### 10.3.8 教师参与的人机协同知识工程

研究问题：教师如何审核、修订和采纳 AI 生成的知识对象？审核成本、信任机制和专业发展如何设计？

## 10.4 阶段路线图

### Phase 1: Concept and Schema

目标是定义 Knowledge Object schema、关系类型、本体边界和最小对象集。

输出包括：

1. 对象 Schema。
2. 关系类型表。
3. 示例对象。
4. 质量规则。

### Phase 2: Prototype

目标是构建小规模对象库和 Runtime。

输出包括：

1. 100 到 300 个对象。
2. 图索引和向量索引。
3. 对象级检索 API。
4. 简单 AI Tutor。

### Phase 3: Educational Validation

目标是通过真实学习任务验证效果。

输出包括：

1. 对照实验。
2. 教师工作流研究。
3. 学习效果分析。
4. Tutor 质量评估。

### Phase 4: Governance and Ecosystem

目标是建立开放标准、审核机制和跨平台互操作。

输出包括：

1. 版本治理机制。
2. 隐私和伦理规范。
3. 与 CASE、xAPI、Caliper 等标准的映射。
4. 开放 API 和开发者文档。

---

# Conclusion

AI 时代不仅需要新的模型和算法，也需要新的知识基础设施。传统知识体系以学科、课程和教材为中心，曾经有效支撑了现代教育和科学发展；但当 AI 系统开始参与知识检索、解释、推理、生成和执行时，知识体系必须从 human-readable content 进一步发展为 machine-actionable、pedagogically aware、runtime-enabled 和 continuously evolving 的知识对象网络。

AI-NKS 的核心思想可以概括为四点。

第一，知识体系的基本单位从教材章节转变为 Knowledge Object。知识对象具有语义核心、教学属性、计算接口、证据来源和版本治理。

第二，知识体系的组织方式从树状目录转变为 Knowledge Network。知识对象通过语义、学习、证据、应用和演化关系形成动态网络。

第三，知识体系从静态存储转变为 Knowledge Runtime。AI Tutor、Agent 和工具系统可以在运行时检索、组合、推理、解释和更新知识对象。

第四，知识体系从周期性修订转变为持续演化。人类专家、AI 系统、学习者反馈和新研究成果共同推动知识质量提升。

对于智能教育研究而言，AI-NKS 的价值不在于提出一个新的技术名词，而在于提供一个可研究、可实现、可验证的基础框架。它让研究者能够系统回答：AI 时代知识为什么要变，应该变成什么样，如何技术实现，以及如何通过教育场景验证其价值。

AI-NKS 的最终愿景是：让人类学习和 AI 推理共享同一套可验证、可组合、可运行、可教学、可演化的知识基础设施。

---

# References and Standards

本报告为概念与技术架构草稿，以下外部标准和框架建议作为后续正式版本的文献与技术参照。

## AI and Education

1. UNESCO. Guidance for generative AI in education and research. 2023. https://www.unesco.org/en/articles/guidance-generative-ai-education-and-research
2. UNESCO. AI competency framework for teachers. 2024. https://www.unesco.org/en/articles/ai-competency-framework-teachers
3. UNESCO. AI competency framework for students. 2024. https://www.unesco.org/en/articles/ai-competency-framework-students

## Knowledge Representation and Semantic Web

1. W3C. RDF 1.1 Primer. https://www.w3.org/TR/rdf11-primer/
2. W3C. OWL 2 Web Ontology Language Document Overview. https://www.w3.org/TR/owl2-overview/
3. W3C. Shapes Constraint Language (SHACL). https://www.w3.org/TR/shacl/
4. W3C. JSON-LD 1.1. https://www.w3.org/TR/json-ld11/
5. W3C. SPARQL 1.1 Overview. https://www.w3.org/TR/sparql11-overview/
6. W3C. PROV-O: The PROV Ontology. https://www.w3.org/TR/prov-o/

## Learning Technology Interoperability

1. ADL. Experience API (xAPI) Standard. https://www.adlnet.gov/projects/xapi/
2. 1EdTech. Competencies and Academic Standards Exchange (CASE). https://www.imsglobal.org/spec/case/v1p0
3. 1EdTech. Caliper Analytics Specification. https://www.imsglobal.org/spec/caliper/v1p2
4. 1EdTech. Open Badges Specification. https://www.imsglobal.org/spec/ob/v3p0

---

# Appendix A. Suggested Revision Priorities for the Next Version

下面的清单是 Version 0.2 写作时提出的历史计划，不应再当作当前路线图。到 2026 年 7 月，仓库中的落实情况如下：

1. 已在 `main` 数据集中形成 182 个知识对象，并发布只读检查成果；教材来源的精确授权信息仍待确认。
2. 已形成可执行的 JSON Schema 和 PostgreSQL 约束；SHACL shapes 尚未实现。
3. 已实现返回完整 `ApiUnit` 的对象级检索接口。
4. 已实现带证据标识校验的早期同步与流式生成，但尚不是完整的 AI Tutor。
5. 已纳入小型运行时评测、物理试验与消融脚手架；独立人工评审和论文级公平对照仍未完成。
6. 已具备图片、节点合并和跨学科候选复核，以及流水线调试和质量状态接口；多专家裁决与正式版本治理仍未完成。
7. CASE、xAPI、Caliper 与当前对象模型的正式映射尚未完成。
8. 当前 LaTeX 技术报告已扩展相关工作与引用，但投稿前仍需系统复核。
9. 已实现跨领域同一对象和关系候选扫描、教材证据复核与受事务保护的应用步骤；共享标签只用于发现候选，尚无多学科、多人裁决金标准证明准确率和召回率。

Version 0.2 当时提出的原始建议保留如下：

1. 选择一个具体学科领域，构建 100 个真实 Knowledge Object。
2. 制定正式 JSON Schema 和 SHACL shapes。
3. 设计对象级检索 API。
4. 构建一个可演示的 grounded AI Tutor。
5. 设计对象级 RAG 与 chunk RAG 对照实验。
6. 形成教师审核工作流和质量评价量表。
7. 将 CASE、xAPI、Caliper 与 AI-NKS 对象模型建立映射。
8. 增加正式文献综述和引用格式。
