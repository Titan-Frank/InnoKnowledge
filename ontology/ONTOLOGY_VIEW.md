# 高中化学知识本体 - 结构可视化

## 📊 类层次结构（Class Hierarchy）

```
🟦 KnowledgeNode (知识节点) - 根类
│
├── 🟦 Concept (概念)
│   ├── 🟩 ThermodynamicConcept (热力学概念)
│   │   ├── 🔹 焓 (Enthalpy)
│   │   ├── 🔹 熵 (Entropy)
│   │   ├── 🔹 吉布斯自由能 (GibbsFreeEnergy)
│   │   ├── 🔹 焓变 (EnthalpyChange)
│   │   ├── 🔹 反应热 (ReactionHeat)
│   │   └── 🔹 内能 (InternalEnergy)
│   │
│   ├── 🟩 ChemicalEquilibrium (化学平衡)
│   │   ├── 🔹 化学平衡 (ChemicalEquilibrium)
│   │   ├── 🔹 化学平衡常数 (EquilibriumConstant)
│   │   └── 🔹 反应商 (ReactionQuotient)
│   │
│   └── 🟩 ElectrochemicalConcept (电化学)
│       ├── 🔹 原电池 (GalvanicCell)
│       ├── 🔹 电解池 (ElectrolyticCell)
│       └── 🔹 电极电势 (ElectrodePotential)
│
├── 🟦 Entity (实体)
│   ├── 🟩 ChemicalSubstance (化学物质)
│   │   ├── 🔹 弱电解质 (WeakElectrolyte)
│   │   └── 🔹 催化剂 (Catalyst)
│   │
│   └── 🟩 LaboratoryEquipment (实验仪器)
│       ├── 🔹 热量计 (Calorimeter)
│       ├── 🔹 pH计 (pHMeter)
│       └── 🔹 滴定管 (Burette)
│
├── 🟦 Process (过程)
│   ├── 🟩 ChemicalReaction (化学反应)
│   │   ├── 🔹 放热反应 (ExothermicReaction)
│   │   ├── 🔹 吸热反应 (EndothermicReaction)
│   │   ├── 🔹 自发反应 (SpontaneousReaction)
│   │   ├── 🔹 氧化还原反应 (RedoxReaction)
│   │   └── 🔹 离子反应 (IonicReaction)
│   │
│   └── 🟩 PhysicalProcess (物理过程)
│       ├── 🔹 溶解 (Dissolution)
│       └── 🔹 沉淀 (Precipitation)
│
├── 🟦 Principle (原理/定律)
│   ├── 🟩 ThermodynamicLaw (热力学定律)
│   │   ├── 🔹 热力学第一定律 (FirstLawThermodynamics)
│   │   └── 🔹 盖斯定律 (HessLaw)
│   │
│   └── 🟩 ChemicalLaw (化学定律)
│       ├── 🔹 勒夏特列原理 (LeChateliersPrinciple)
│       └── 🔹 质量作用定律 (LawMassAction)
│
├── 🟦 Method (方法)
│   ├── 🟩 ExperimentalMethod (实验方法)
│   │   ├── 🔹 量热法 (Calorimetry)
│   │   ├── 🔹 滴定法 (Titration)
│   │   └── 🔹 电导法 (Conductometry)
│   │
│   └── 🟩 CalculationMethod (计算方法)
│       ├── 🔹 方程式配平 (EquationBalancing)
│       └── 🔹 H计算 (EnthalpyCalculation)
│
└── 🟦 Activity (活动)
    ├── 🟩 LaboratoryExperiment (实验室实验)
    │   ├── 🔹 中和热测定 (NeutralizationHeatExp)
    │   ├── 🔹 沉淀转化实验 (PrecipitationTransformation)
    │   └── 🔹 锌铜原电池 (ZnCuGalvanicCell)
    │
    └── 🟩 Demonstration (演示实验)
        └── 🔹 燃料电池演示 (FuelCellDemo)
```

图例:
- 🟦 蓝色: 抽象类 (Abstract Class)
- 🟩 绿色: 具体子类 (Concrete Subclass)
- 🔹 橙色: 实例 (Instance/Individual)

## 🔗 核心关系（Relations）

### 因果/影响关系
```
EnthalpyChange ──causes──> ReactionHeat
Temperature ──affects──> ReactionRate
Catalyst ──affects──> ReactionRate
Concentration ──affects──> ReactionRate
```

### 解释关系
```
HessLaw ──explains──> EnthalpyCalculation
LeChateliersPrinciple ──explains──> EquilibriumShift
FirstLawThermodynamics ──explains──> EnergyConservation
```

### 层次关系
```
Anode ──partOf──> GalvanicCell
Cathode ──partOf──> GalvanicCell
Electrolyte ──partOf──> ElectrolyticCell
```

### 测量/使用关系
```
Calorimeter ──measures──> ReactionHeat
Titration ──measures──> Concentration
NeutralizationHeatExp ──uses──> Calorimeter
```

## 📈 覆盖章节统计

| 章节 | 类数 | 实例数 | 主要本体类 |
|------|------|--------|-----------|
| 第1章: 化学反应的热效应 | 8 | 12 | ThermodynamicConcept, ThermodynamicLaw |
| 第2章: 方向、限度、速率 | 6 | 10 | ChemicalEquilibrium, ChemicalLaw |
| 第3章: 离子反应与平衡 | 4 | 8 | ChemicalEquilibrium, ChemicalSubstance |
| 第4章: 氧化还原与电化学 | 5 | 15 | ElectrochemicalConcept, ChemicalReaction |

## 🎯 本体规模统计

### 总体统计
- **总类数**: 22
  - 根类: 1 (KnowledgeNode)
  - 一级子类: 6 (Concept, Entity, Process, Principle, Method, Activity)
  - 二级子类: 10
  - 三级子类: 5

- **实例数**: 23
  - 热力学概念: 6个
  - 化学反应: 5个
  - 实验仪器: 3个
  - 化学平衡相关: 3个
  - 电化学设备: 2个
  - 其他: 4个

### 关系统计
- **causes** (引起): 3条
- **affects** (影响): 6条
- **explains** (解释): 4条
- **isPartOf** (部分): 8条 (传递)
- **uses** (使用): 5条
- **measures** (测量): 4条
- **applies** (应用): 3条
- **prerequisiteFor** (先决): 5条 (传递)

## 💡 本体如何映射到现有数据

当前 knowledge graph 中的 149 个节点应该映射到这些本体类:

### 映射示例

| 现有节点ID | node_kind | 映射到本体类 |
|-----------|-----------|-------------|
| chem:concept:enthalpy-change | concept | :EnthalpyChange (instance of :ThermodynamicConcept) |
| chem:entity:calorimeter | entity | :Calorimeter (instance of :LaboratoryEquipment) |
| chem:activity:neutralization-heat | activity | :NeutralizationHeatExp (instance of :LaboratoryExperiment) |
| chem:principle:hess-law | principle | :HessLaw (instance of :ThermodynamicLaw) |
| chem:process:combustion | process | :ExothermicReaction (instance of :ChemicalReaction) |

### 映射脚本（待用）

```python
# 示例: 如何将现有节点映射到本体

mapping_rules = {
    # 基于 node_kind + 名称关键词
    "concept": {
        "enthalpy|entropy|thermo": "ThermodynamicConcept",
        "equilibrium|balance": "ChemicalEquilibrium",
        "electro|cell|battery": "ElectrochemicalConcept",
    },
    "entity": {
        "calorimeter|meter|equipment": "LaboratoryEquipment",
        "acid|base|salt|substance": "ChemicalSubstance",
    },
    "process": {
        "reaction": "ChemicalReaction",
        "dissolution|precipitation": "PhysicalProcess",
    },
    "principle": {
        "law": "ThermodynamicLaw" if "thermo" in name else "ChemicalLaw",
    },
    "activity": {
        "experiment": "LaboratoryExperiment",
        "demo": "Demonstration",
    },
}

def map_node_to_ontology(node_id, node_kind, canonical_name):
    """将现有节点映射到本体类"""
    # 实现映射逻辑
    pass
```

## 🔍 下一步：本体集成计划

### Phase 1: 映射现有节点（1-2天）
- [ ] 创建 `ontology/mappings.ttl`
- [ ] 将 149 个节点映射到本体类
- [ ] 验证映射完整性

### Phase 2: 验证数据一致性（1天）
- [ ] 使用本体验证节点属性
- [ ] 检查缺失的关系
- [ ] 修复不一致

### Phase 3: Viewer 集成（2-3天）
- [ ] 在 Viewer 中显示本体层次
- [ ] 添加"按类别浏览"功能
- [ ] 显示概念的推理关系

### Phase 4: 推理应用（可选）
- [ ] 自动发现隐式关系
- [ ] 跨课程前置知识推荐
- [ ] 基于本体的智能问答

## 📖 如何使用这个本体

### 1. 查看本体文件
打开 `ontology/chemistry-ontology.ttl`

### 2. 使用 Protégé
```bash
# 下载 Protégé: https://protege.stanford.edu/
# 打开 chemistry-ontology.ttl
# 可以图形化查看类层次和关系
```

### 3. 使用 Python 推理
```python
from owlready2 import *

onto = get_ontology("ontology/chemistry-ontology.ttl").load()

# 查询所有热力学概念
for concept in onto.ThermodynamicConcept.instances():
    print(concept.label)

# 推理传递关系
with onto:
    sync_reasoner()
```

### 4. SPARQL 查询
```sparql
PREFIX : <http://example.org/chemistry-ontology#>
SELECT ?concept WHERE {
    ?concept rdf:type/rdfs:subClassOf* :ThermodynamicConcept .
}
```

## ❓ 常见问题

**Q: 本体显示在哪里？**
A: 当前本体是独立的 `.ttl` 文件，尚未集成到 Viewer 中。你可以：
1. 在此 Markdown 文件中查看结构图
2. 使用 Protégé 软件打开可视化
3. 等待 Phase 3 集成到 Web Viewer

**Q: 现有数据如何与本关联？**
A: 需要运行映射脚本（Phase 1），将 node_kind 转换为 OWL 类实例。

**Q: 如何验证数据符合本体？**
A: 运行 OWL 推理器检查一致性和完整性约束。
