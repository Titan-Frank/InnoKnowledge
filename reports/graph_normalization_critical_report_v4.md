# 图归一化紧急报告 v4数据集

**日期**: 2026-04-04  
**数据集**: v4  
**状态**: 🔴 **严重 - 需要立即修复**

---

## 1. 执行摘要

当前v4知识图谱存在**灾难性的连通性问题**：

| 指标 | 数值 | 状态 |
|------|------|------|
| 总节点数 | 281 | - |
| 总边数 | 185 | 严重不足 |
| **孤立节点数** | **123 (44%)** | 🔴 严重 |
| 孤立backbone节点 | 103 | 🔴 严重 |
| 孤立support节点 | 20 | ⚠️ 警告 |
| 重复节点对 | 9 | ⚠️ 警告 |

**结论**: 提取流程中边关系建立环节完全失败，导致核心概念孤岛化，图谱无法支撑语义检索和知识推理。

---

## 2. 孤立节点详细分析

### 2.1 按类型分布

| 节点类型 | 孤立数量 | 占比 |
|----------|----------|------|
| concept (概念) | 55 | 45% |
| entity (实体) | 34 | 28% |
| activity (活动) | 12 | 10% |
| method (方法) | 12 | 10% |
| issue (议题) | 3 | 2% |
| principle (原理) | 2 | 2% |
| process (过程) | 2 | 2% |
| skill (技能) | 2 | 2% |
| representation (表示法) | 1 | 1% |

### 2.2 按层级分布

| 层级 | 孤立数量 | 状态 |
|------|----------|------|
| backbone (核心层) | 103 | 🔴 不应孤立 |
| support (支持层) | 20 | ⚠️ 可接受少量孤立 |

---

## 3. 核心概念孤立状态 (致命问题)

以下关键backbone概念**完全没有边连接**：

| 概念 | 类型 | 节点ID | 应有关系 |
|------|------|--------|----------|
| **pH** | concept | concept:pH | 与酸、碱、指示剂相关 |
| **酸** | concept | concept:acid | 与碱、pH、中和反应相关 |
| **碱** | concept | concept:base | 与酸、pH、中和反应相关 |
| **中和反应** | concept | concept:neutralization-reaction | 与酸、碱、盐相关 |
| **燃烧** | concept | concept:combustion | 与能源、氧化反应相关 |
| **化学方程式** | concept | concept:chem:chemical_equation | 与化学反应类型相关 |
| **催化剂** | concept | concept:catalysis | 与化学反应相关 |
| **乙醇** | entity | entity/substance:ethanol | 与燃烧、能源相关 |
| **化石燃料** | concept | concept:fossil-fuel | 与能源、燃烧相关 |
| **可再生能源** | concept | concept:renewable-energy | 与能源危机相关 |
| **合金** | concept | concept:alloy | 与金属材料相关 |
| **塑料** | entity | entity/substance:plastic | 与材料相关 |
| **氧化反应** | concept | concept:chem:oxidation_reaction | 与还原反应、燃烧相关 |
| **还原反应** | concept | concept:chem:reduction_reaction | 与氧化反应、金属冶炼相关 |
| **置换反应** | concept | concept:chem:single_displacement_reaction | 与化学反应类型相关 |
| **复分解反应** | concept | concept:chem:double_displacement_reaction | 与化学反应类型相关 |
| **分解反应** | concept | concept:chem:decomposition_reaction | 与化学反应类型相关 |
| **化合反应** | concept | concept:chem:combination_reaction | 与化学反应类型相关 |
| **溶液浓度** | concept | concept:solution-concentration | 与溶解度、溶质质量分数相关 |
| **能源** | concept | concept:energy | 与化石燃料、可再生能源相关 |

---

## 4. 重复节点问题

发现**9对重复节点**，需要合并：

| 概念名称 | 重复节点ID | 问题 |
|----------|------------|------|
| 中和反应 | process:neutralization-reaction 和 concept:neutralization-reaction | 过程vs概念重复 |
| 分解反应 | concept:chemical-reaction-type:decomposition 和 concept:chem:decomposition_reaction | ID命名不一致 |
| 化合反应 | concept:chemical-reaction-type:combination 和 concept:chem:combination_reaction | ID命名不一致 |
| 化学方程式 | representation:chemical-equation 和 concept:chem:chemical_equation | 表示法vs概念重复 |
| 单质 | concept:substance:pure:element 和 concept:simple-substance | 命名不同 |
| 复分解反应 | concept:chem:double_displacement_reaction 和 process:double-decomposition-reaction | 概念vs过程重复 |
| 物理变化 | process:physical-change 和 concept:physical-change | 过程vs概念重复 |
| 碳酸钙 | entity/substance:calcium_carbonate 和 entity/substance:calcium-carbonate | ID下划线vs连字符 |
| 蒸发 | method:evaporation 和 concept:evaporation | 方法vs概念重复 |

---

## 5. 现有边分析

当前边类型分布（仅185条边）：

| 边类型 | 数量 | 说明 |
|--------|------|------|
| uses (使用) | 43 | 操作关系 |
| is_a (是) | 28 | 类型层次 |
| contains (包含) | 16 | 包含关系 |
| explains (解释) | 13 | 解释关系 |
| part_of (部分) | 12 | 部分整体 |
| related_to (相关) | 11 | 一般关联 |
| has_property (有属性) | 9 | 属性关系 |
| produces (产生) | 9 | 产出关系 |
| demonstrates (演示) | 6 | 演示关系 |
| applies_to (应用于) | 5 | 应用关系 |
| instance_of (实例) | 5 | 实例关系 |
| depends_on (依赖) | 4 | 依赖关系 |
| includes (包括) | 3 | 包含关系 |
| prerequisite_for (先决条件) | 2 | 先决关系 |
| measures (测量) | 2 | 测量关系 |
| 其他 | 18 | 少量各种类型 |

**问题**: 边数量严重不足，且分布不合理。对于281个节点，合理的边密度应该至少300-400条边。

---

## 6. 根因分析

### 6.1 直接原因
提取脚本 `extract_lesson_sqlite.py` 或 `/chapter-extract` skill **未能正确建立边关系**：
- 节点被成功创建并插入SQLite
- 边关系没有被识别、提取或保存
- 可能的原因：
  1. 提取prompt未要求识别关系
  2. 边提取逻辑有bug
  3. 边验证失败被丢弃
  4. 数据库写入边时出错

### 6.2 系统原因
- 缺乏边完整性检查机制
- QA流程未能发现连通性问题
- 节点提取和边提取分离，边提取被忽略

---

## 7. 修复建议

### 7.1 立即行动 (阻止进一步恶化)

1. **暂停新课题提取** - 在修复边建立问题前不要再提取新内容
2. **备份当前数据** - 保存当前状态以便对比修复效果

### 7.2 短期修复 (1-2天)

#### A. 合并重复节点

示例SQL（中和反应合并）：
```sql
-- 保留 concept:neutralization-reaction，删除 process:neutralization-reaction
-- 迁移所有边、提及、证据到保留节点
```

#### B. 手动建立核心概念边关系

根据化学知识体系，手动添加以下关键边：

**建议建立的边 (按优先级)**:

| 优先级 | 边 (from到to) | 类型 |
|--------|----------------|------|
| P0 | acid到neutralization-reaction | participates_in |
| P0 | base到neutralization-reaction | participates_in |
| P0 | pH到acid | measures |
| P0 | pH到base | measures |
| P0 | combustion到oxidation-reaction | is_a |
| P0 | ethanol到combustion | undergoes |
| P0 | catalysis到chemical-reaction | accelerates |
| P1 | fossil-fuel到energy | is_a |
| P1 | renewable-energy到energy | is_a |
| P1 | alloy到metal-materials | is_a |
| P1 | plastic到organic-polymer-materials | is_a |
| P1 | decomposition-reaction到chemical-reaction-type | is_a |
| P1 | combination-reaction到chemical-reaction-type | is_a |
| P1 | single-displacement-reaction到chemical-reaction-type | is_a |
| P1 | double-displacement-reaction到chemical-reaction-type | is_a |
| P1 | oxidation-reaction到chemical-reaction-type | is_a |
| P1 | reduction-reaction到chemical-reaction-type | is_a |
| P2 | solution-concentration到solubility | related_to |
| P2 | chemical-equation到stoichiometric-number | represents |

### 7.3 中期修复 (1周)

1. **修复提取脚本** - 检查并修复 `/chapter-extract` skill，确保其正确提取和保存边关系
2. **重提取受影响课题** - 重新提取问题严重的课题（如酸碱、化学反应类型等）
3. **建立连通性检查** - 在QA流程中添加孤立节点检查

### 7.4 长期改进

1. **建立图完整性指标** - 监控：
   - 孤立节点比例低于10%
   - 边密度 (边数/节点数) 大于1.5
   - 最大连通分量占比大于80%

2. **提取流程改进** - 确保节点和边同时提取和验证

---

## 8. 数据质量评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 节点完整性 | ✅ 良好 | 281个节点覆盖主要概念 |
| 边完整性 | 🔴 极差 | 44%节点孤立，边密度0.66 |
| 连通性 | 🔴 极差 | 图谱碎片化，无法支持推理 |
| 重复性 | ⚠️ 较差 | 9对重复节点需要清理 |
| 证据完整性 | ⚠️ 未知 | 需要进一步检查 |

**总体评估**: 🔴 **不可接受** - 当前图谱无法用于生产环境

---

## 9. 下一步行动

1. ✅ **完成** - 执行图归一化检查（已生成此报告）
2. ⏳ **待执行** - 合并重复节点（预计2小时）
3. ⏳ **待执行** - 手动建立核心边关系（预计4小时）
4. ⏳ **待执行** - 重提取关键课题（预计8小时）
5. ⏳ **待执行** - 重新运行QA验证

---

*报告生成时间: 2026-04-04*  
*生成脚本: graph-normalize skill*
