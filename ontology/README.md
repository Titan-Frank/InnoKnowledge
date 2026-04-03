# 化学知识本体 (Ontology)

## 什么是 Ontology？

**Ontology（本体）** 是对特定领域知识的正式、明确的规范：

- **概念** (Concepts): 领域中的实体类别（如：化学物质、反应、定律）
- **关系** (Relations): 概念之间的语义关系（如：引起、解释、包含）
- **属性** (Properties): 概念的特征（如：数值、单位、公式）
- **公理** (Axioms): 领域内始终为真的陈述
- **推理规则** (Rules): 可以推导出新知识的逻辑

## 为什么需要 Ontology？

### 当前系统的局限

```
当前: 有 Schema，但没有形式本体
      - node_kind: "concept", "entity", "process" (标记)
      - edge_type: "causes", "explains" (标签)
      - 缺少: 类层次结构、推理规则、属性约束
```

### Ontology 带来的能力

| 能力 | 当前 | 有 Ontology |
|------|------|-------------|
| **概念分类** | 手动标记 | 自动分类、层次推理 |
| **关系推理** | 无 | "A causes B + B causes C → A causes C" |
| **一致性检查** | 基础 schema | 语义级验证 |
| **知识发现** | 无 | 发现隐式关系 |
| **跨领域整合** | 困难 | 通过上位概念连接 |

## 本项目的 Ontology

### 文件位置

```
ontology/
├── chemistry-ontology.ttl    # Turtle 格式的 OWL 本体
├── README.md                 # 本文件
└── mappings/                 # 与现有数据的映射 (计划中)
    ├── schema-to-owl.json    # JSON Schema → OWL 映射
    └── node-kind-classes.ttl # 节点类型 → OWL 类
```

### 本体结构

#### 1. 基础类层次 (Class Hierarchy)

```
KnowledgeNode
├── Concept (概念)
│   ├── ThermodynamicConcept (热力学概念)
│   │   ├── 焓、熵、吉布斯自由能
│   ├── ChemicalEquilibrium (化学平衡)
│   │   ├── 平衡常数、反应商
│   └── ElectrochemicalConcept (电化学)
│       ├── 原电池、电解池
├── Entity (实体)
│   ├── ChemicalSubstance (化学物质)
│   └── LaboratoryEquipment (实验仪器)
├── Process (过程)
│   ├── ChemicalReaction (化学反应)
│   │   ├── 放热反应、吸热反应
│   │   ├── 氧化还原反应
│   │   └── 自发反应
│   └── PhysicalProcess (物理过程)
├── Principle (原理)
│   ├── ThermodynamicLaw (热力学定律)
│   │   └── 盖斯定律
│   └── ChemicalLaw (化学定律)
│       └── 勒夏特列原理
├── Method (方法)
│   ├── ExperimentalMethod (实验方法)
│   └── CalculationMethod (计算方法)
└── Activity (活动)
    ├── LaboratoryExperiment (实验室实验)
    └── Demonstration (演示实验)
```

#### 2. 关系定义 (Object Properties)

```
causes (引起)
├── domain: Process
├── range: Concept
└── example: 焓变 causes 反应热

affects (影响)  
├── domain: Concept
├── range: Concept
└── example: 温度 affects 反应速率

explains (解释)
├── domain: Principle  
├── range: Concept
└── example: 勒夏特列原理 explains 平衡移动

hasProperty (具有属性)
├── domain: Entity
├── range: Concept
└── example: 碳酸 hasProperty 酸性

isPartOf (是...的部分)
├── transitive: true
└── example: 阳极 isPartOf 原电池

uses (使用)
├── domain: Activity
├── range: Entity
└── example: 中和热测定 uses 热量计

measures (测量)
├── domain: Method/Equipment
├── range: Concept
└── example: 滴定 measures 浓度

prerequisiteFor (是...的先决条件)
├── transitive: true
└── example: 化学平衡 prerequisiteFor 电离平衡
```

#### 3. 数据属性 (Data Properties)

```
hasFormula: 化学式 → xsd:string
  example: "NaHCO3", "H2SO4"

hasValue: 数值 → xsd:decimal
  example:  Kw = 1.0E-14

hasUnit: 单位 → xsd:string
  example: "kJ/mol", "mol/L"

hasSymbol: 符号 → xsd:string
  example: "ΔH", "Ksp"
```

#### 4. 推理规则 (SWRL Rules)

```prolog
# 示例规则：如果 A 引起 B，B 引起 C，则 A 间接引起 C
Rule: transitive_causes
IF:   ?a causes ?b AND ?b causes ?c
THEN: ?a indirectlyCauses ?c

# 示例规则：强电解质 = 电解质 AND 完全电离
Rule: strong_electrolyte
IF:   ?x rdf:type :Electrolyte 
      AND ?x hasProperty :CompleteDissociation
THEN: ?x rdf:type :StrongElectrolyte

# 示例规则：放热反应的焓变为负
Rule: exothermic_negative_deltaH
IF:   ?x rdf:type :ExothermicReaction
THEN: ?x hasProperty :NegativeEnthalpyChange
```

## 与现有数据集成

### 映射策略

#### Scheme 1: 双重标注

保持现有 JSON Schema + 添加 OWL 类标注：

```json
{
  "id": "chem:concept:enthalpy-change",
  "canonical_name": "焓变",
  "node_kind": "concept",                    // Schema 标记
  "node_layer": "backbone",
  "owl:Class": "http://example.org/chemistry-ontology#ThermodynamicConcept",
  "owl:subClassOf": [
    "http://example.org/chemistry-ontology#ThermodynamicConcept"
  ]
}
```

#### Scheme 2: 外部映射表

```turtle
# mappings/nodes-to-ontology.ttl
:chem__concept__enthalpy rdf:type :EnthalpyChange ;
    :hasNodeId "chem:concept:enthalpy-change" ;
    :derivedFrom :ThermodynamicConcept .
```

#### Scheme 3: ID 约定

通过 ID 命名约定隐含本体类：

```
chem:{node_kind}:{name} → owl:Class
                          ↓
chem:concept:enthalpy → :ThermodynamicConcept
chem:principle:hess-law → :ThermodynamicLaw
chem:activity:experiment → :LaboratoryExperiment
```

### 使用 Ontology 进行数据验证

```python
# 示例: 使用本体验证节点类型一致性
from rdflib import Graph, Namespace, RDF, RDFS

CHEMA = Namespace("http://example.org/chemistry-ontology#")
g = Graph()
g.parse("ontology/chemistry-ontology.ttl", format="turtle")

def validate_node_type(node_id, node_kind):
    """验证节点类型是否符合本体"""
    # 检查 node_kind 是否对应有效的 OWL 类
    owl_class = CHEMA[node_kind.capitalize()]
    
    # 验证是否是 KnowledgeNode 的子类
    return (owl_class, RDFS.subClassOf, CHEMA.KnowledgeNode) in g
```

### 使用 Ontology 进行推理

```python
# 示例: 使用 OWL 推理器
from owlready2 import *

onto = get_ontology("ontology/chemistry-ontology.ttl").load()

# 推理: 找出所有 ThermodynamicConcept 的实例
with onto:
    sync_reasoner()  # 执行 OWL 推理

# 查询: 哪些概念影响反应速率？
for concept in onto.search(affects=onto.ReactionRate):
    print(concept.name)
    # 输出: Catalyst, Temperature, Concentration...
```

## 本体演进路线图

### Phase 1: 基础本体 (当前) ✅
- [x] 定义主要概念类
- [x] 定义关系类型
- [x] 添加核心实例

### Phase 2: 完善与映射 (计划中)
- [ ] 完成 149 个节点到本体的映射
- [ ] 添加属性约束
- [ ] 定义等价类和互斥类
- [ ] 与 JSON Schema 同步

### Phase 3: 推理集成 (计划中)
- [ ] 集成 OWL 推理器
- [ ] 添加 SWRL 规则
- [ ] 自动发现隐式关系
- [ ] 一致性验证

### Phase 4: 应用 (计划中)
- [ ] 智能问答 (基于本体推理)
- [ ] 学习路径推荐
- [ ] 知识点缺失检测
- [ ] 跨学科知识连接

## 技术栈

### 本体语言
- **Turtle**: 人类可读的 RDF 格式
- **OWL 2**: Web本体语言
- **SKOS**: 知识组织系统
- **SWRL**: 语义Web规则语言

### 工具推荐

#### 查看和编辑
- **Protégé**: 免费本体编辑器 (https://protege.stanford.edu/)
- **WebVOWL**: Web可视化 (http://vowl.visualdataweb.org/webvowl/)

#### 推理
- **HermiT**: OWL 推理器
- **Pellet**: OWL 2 推理器
- **OWLReady2**: Python 本体库

#### 查询
- **SPARQL**: RDF 查询语言
- **rdflib**: Python RDF 库

## 使用示例

### 1. 加载和查询本体

```python
from rdflib import Graph, Namespace

g = Graph()
g.parse("ontology/chemistry-ontology.ttl", format="turtle")

CHEMA = Namespace("http://example.org/chemistry-ontology#")

# 查询: 所有热力学概念
query = """
SELECT ?concept ?label
WHERE {
    ?concept rdf:type/rdfs:subClassOf* :ThermodynamicConcept ;
             rdfs:label ?label .
}
"""
for row in g.query(query, initNs={'': CHEMA}):
    print(f"{row.concept}: {row.label}")
```

### 2. 验证新提取的节点

```python
def validate_concept_hierarchy(node_kind, parent_class):
    """验证 node_kind 是否符合本体层次"""
    # 检查 node_kind 是否是 parent_class 的子类
    return validate_subclass(node_kind, parent_class)
```

### 3. 推理新关系

```python
# 基于本体推理：如果 A 是 B 的部分，B 是 C 的部分，则 A 是 C 的部分
def infer_part_of_transitive(graph):
    """推理 isPartOf 的传递性"""
    new_relations = []
    for a, b in graph.query("SELECT ?a ?b WHERE {?a :isPartOf ?b}"):
        for c in graph.query("SELECT ?c WHERE {?b :isPartOf ?c}"):
            new_relations.append((a, c))
    return new_relations
```

## 与现有 Viewer 集成

### 在 Viewer 中显示本体信息

```javascript
// app.js 中添加本体层
function showOntologyInfo(nodeId) {
    const ontologyClass = getOWLClass(nodeId);
    const superClasses = getSuperClasses(ontologyClass);
    const relatedConcepts = queryRelated(ontologyClass);
    
    // 在侧边栏显示
    renderOntologyPanel({
        class: ontologyClass,
        hierarchy: superClasses,
        relations: relatedConcepts
    });
}
```

## 参考资源

- [OWL 2 Primer](https://www.w3.org/TR/owl2-primer/)
- [SKOS Simple Knowledge Organization System](https://www.w3.org/TR/skos-reference/)
- [SWRL: Semantic Web Rule Language](https://www.w3.org/Submission/SWRL/)
- [SPARQL 1.1 Query Language](https://www.w3.org/TR/sparql11-query/)

## 贡献

要扩展本体：
1. 编辑 `chemistry-ontology.ttl`
2. 添加新类/属性/实例
3. 更新映射文档
4. 运行一致性检查
5. 提交 Pull Request

## 许可证

与项目主许可证相同。
