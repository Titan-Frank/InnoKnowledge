# 知识图谱归一化报告

**日期**: 2026-03-24

## 执行摘要

知识图谱归一化已完成，所有数据符合 schema 规范。

## 归一化前后统计

| 指标 | 归一化前 | 归一化后 | 变化 |
|------|---------|---------|------|
| 节点数 | 127 | 127 | 无变化 |
| 边数 | 122 | 126 | +4（新增连接孤立节点） |
| 八年级 mentions | 171 | 171 | 无变化 |
| 九年级 mentions | 45 | 45 | 无变化 |

## 修复的问题

### 1. Schema 错误修复 (8个)

**问题描述**: ID 包含大写字母 `pH`，不符合 schema 要求 `^[a-z0-9:-]+$`

**修复内容**:
- `concept:pH` → `concept:ph`
- `method:pH-test` → `method:ph-test`
- `edge:pH-test-uses-indicator` → `edge:ph-test-uses-indicator`
- `edge:pH-measures-acidity` → `edge:ph-measures-acidity`
- `edge:pH-measures-basicity` → `edge:ph-measures-basicity`
- `mention:chem-grade9-all-in-one:lesson-1-2-3:pH` → `mention:chem-grade9-all-in-one:lesson-1-2-3:ph`
- `mention:chem-grade9-all-in-one:lesson-1-2-3:pH-test` → `mention:chem-grade9-all-in-one:lesson-1-2-3:ph-test`

### 2. 重复边合并 (1组)

**合并内容**:
- `edge:water-is-solvent` 与 `edge:water-is-common-solvent` 合并
- 保留 `edge:water-is-common-solvent` 作为主边
- 合并了 framework_refs
- 更新了八年级 mention 引用

### 3. 边类型语义调整 (2条)

| 边 ID | 原类型 | 新类型 | 原因 |
|-------|--------|--------|------|
| `edge:air-is-mixture` | part_of | related_to | 空气"是一种"混合物，非"一部分" |
| `edge:water-is-solvent` | part_of | related_to | 水"是一种"溶剂，非"一部分" |

### 4. 孤立节点连接 (5个)

为以下孤立节点添加了边：
- `concept:composite-material` → `concept:polymer-material`
- `concept:fertilizer` → `concept:salt-properties`
- `concept:silicate-material` → `concept:composite-material`
- `concept:unsaturated-solution` → `concept:saturated-solution`
- `substance:sodium-bicarbonate` → `concept:salt-properties`

### 5. 别名补充 (10个节点)

为以下节点添加了常用别名：

| 节点 ID | 新增别名 |
|---------|---------|
| `concept:ph` | hydrogen ion concentration |
| `method:ph-test` | 酸碱度测定, ph test |
| `concept:lab-safety` | lab safety, 化学实验室安全, 实验室安全规则 |
| `concept:scientific-inquiry` | scientific inquiry, 探究学习, 科学方法 |
| `substance:hydrogen-peroxide` | H2O2, hydrogen peroxide, 双氧水 |
| `substance:manganese-dioxide` | MnO2, manganese dioxide, 催化剂 |
| `substance:potassium-permanganate` | KMnO4, potassium permanganate, PP粉 |
| `substance:water` | H2O, water, 氧化氢 |
| `concept:water-properties` | properties of water, 水的性质 |
| `concept:solvent` | solvent, 溶解剂 |
| `concept:water-cycle` | water cycle, 自然界水循环, 水文循环 |
| `concept:hard-water` | hard water and soft water, 水的硬度, 硬水软化 |

## 数据质量指标

| 指标 | 数值 |
|------|------|
| Schema 合规率 | 100% |
| 节点 framework 覆盖率 | 81.9% (104/127) |
| 边 framework 覆盖率 | 59.5% (75/126) |
| 孤立节点数 | 0 |
| 重复节点数 | 0 |
| 重复边数 | 0 |

## 边类型分布

| 边类型 | 数量 |
|--------|------|
| related_to | 52 |
| uses | 19 |
| explains | 18 |
| produces | 15 |
| contains | 13 |
| measures | 4 |
| part_of | 2 |
| consumes | 2 |
| prerequisite_for | 1 |

## 节点类型分布

| 节点类型 | 数量 |
|----------|------|
| concept | 69 |
| substance | 27 |
| method | 13 |
| experiment | 10 |
| skill | 5 |
| symbol | 3 |

## 共享节点

八年级和九年级共享的节点（3个）：
- `concept:energy-in-reaction` - 化学反应中的能量变化
- `concept:solvent` - 溶剂
- `substance:calcium-carbonate` - 碳酸钙

## 后续建议

1. **别名补充**: 还有 19 个重要节点可能需要补充别名
2. **Framework 覆盖**: 边的 framework 覆盖率较低 (59.5%)，可考虑补充
3. **节点卡片**: 可为高优先级节点创建详细的节点卡片

## 结论

知识图谱归一化成功完成。所有数据符合 schema 规范，无重复节点和边，无孤立节点，provenance 链完整保留。
