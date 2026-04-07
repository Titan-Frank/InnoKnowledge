# 本体集成实施方案

## 概述

目标：将独立的 `chemistry-ontology.ttl` 深度集成到提取 workflow 中，从"数据记录"升级到"语义知识"。

## 阶段一：数据映射（1-2天）

### 1.1 创建节点→本体映射表

**文件**: `ontology/node-to-owl-mappings.json`

```json
{
  "mappings": [
    {
      "node_id": "chem:concept:enthalpy-change",
      "node_kind": "concept",
      "canonical_name": "焓变",
      "owl_class": ":EnthalpyChange",
      "owl_parent": ":ThermodynamicConcept",
      "certainty": 1.0
    },
    {
      "node_id": "chem:entity:calorimeter",
      "node_kind": "entity",
      "canonical_name": "热量计",
      "owl_class": ":Calorimeter",
      "owl_parent": ":LaboratoryEquipment",
      "certainty": 1.0
    }
  ]
}
```

### 1.2 自动映射生成器

**脚本**: `scripts/auto_map_to_ontology.py`

```python
#!/usr/bin/env python3
"""自动将现有节点映射到本体"""

AUTO_MAPPING_RULES = {
    "concept": {
        r"焓|熵|吉布斯|内能|热容": "ThermodynamicConcept",
        r"平衡|化学平衡|电离平衡": "ChemicalEquilibrium",
        r"原电池|电解池|电化学|腐蚀": "ElectrochemicalConcept",
        r"反应速率|反应热|氧化还原": "Concept",
    },
    "entity": {
        r"热量计|pH计|滴定管|电极": "LaboratoryEquipment",
        r"酸|碱|盐|氧化物": "ChemicalSubstance",
    },
    "process": {
        r"反应|氧化还原|中和": "ChemicalReaction",
        r"溶解|沉淀|蒸发": "PhysicalProcess",
    },
    "principle": {
        r"定律|原理|规则": "ThermodynamicLaw"  # 或 ChemicalLaw
    },
    "method": {
        r"实验|测定|滴定": "ExperimentalMethod",
        r"计算|求算|测定": "CalculationMethod",
    },
    "activity": {
        r"实验|探究|演示": "LaboratoryExperiment",
    }
}

def auto_classify_node(node):
    """基于名称和类型自动分类"""
    kind = node['node_kind']
    name = node['canonical_name']
    
    for pattern, owl_class in AUTO_MAPPING_RULES.get(kind, {}).items():
        if re.search(pattern, name):
            return owl_class
    
    return f":{kind.capitalize()}"  # 默认映射
```

### 1.3 SQLite → RDF 转换器

**脚本**: `scripts/export_to_rdf.py`

```python
#!/usr/bin/env python3
"""将 SQLite 数据导出为 RDF 格式（.ttl）"""

def export_nodes_to_rdf(connection, mappings):
    """导出带本体标注的节点"""
    triples = []
    
    for node in export_nodes(connection):
        node_id = node['id']
        mapping = mappings.get(node_id, {})
        owl_class = mapping.get('owl_class', ':KnowledgeNode')
        
        # 生成 RDF 三元组
        triples.append(f":{node_id.replace(':', '__')} rdf:type {owl_class} ;")
        triples.append(f'    rdfs:label "{node["canonical_name"]}"@zh ;')
        triples.append(f'    skos:definition "{node["definition"]}"@zh .')
        triples.append("")
    
    return "\n".join(triples)

# 输出: knowledge-graph.rdf (带本体标注的 RDF 文件)
```

**使用方法**:
```bash
python scripts/auto_map_to_ontology.py
python scripts/export_to_rdf.py > data/v4/knowledge-graph.rdf
```

---

## 阶段二：Workflow 集成（2-3天）

### 2.1 修改提取 Skill

**文件**: `.claude/skills/chapter-extract/SKILL.md`

在现有流程中添加本体标注步骤：

```yaml
新增步骤: Phase X: Ontology Annotation

执行:
  1. 提取节点后，运行自动分类:
     ```bash
     python scripts/auto_classify_node.py \
       --node-id <node_id> \
       --node-name <name> \
       --output-owl-class
     ```
  
  2. 将 OWL 类写入 nodes 表的新字段:
     ```sql
     ALTER TABLE nodes ADD COLUMN owl_class TEXT;
     ALTER TABLE nodes ADD COLUMN owl_parent TEXT;
     
     UPDATE nodes SET 
       owl_class = ':EnthalpyChange',
       owl_parent = ':ThermodynamicConcept'
     WHERE id = 'chem:concept:enthalpy-change';
     ```
  
  3. 导出 RDF 三元组到 batch_runtime
```

### 2.2 边关系语义增强

当前边: `{ from, to, edge_type: "causes" }`

增强后边: `{ from, to, edge_type: "causes", owl_property: ":causes" }`

映射表 `edge-type-to-owl.json`:
```json
{
  "causes": ":causes",
  "affects": ":affects",
  "explains": ":explains",
  "has_property": ":hasProperty",
  "is_a": "rdfs:subClassOf",
  "part_of": ":isPartOf",
  "uses": ":uses",
  "measures": ":measures"
}
```

### 2.3 验证步骤

在 closeout 过程中添加:
```bash
python scripts/validate_ontology_consistency.py \
  --db storage/knowledge.sqlite

# 检查:
# - 所有节点都有 owl_class
# - 边类型映射到有效的 OWL 属性
# - 没有逻辑冲突（如 "HessLaw is-a ChemicalSubstance"）
```

---

## 阶段三：Viewer 可视化（2-3天）

### 3.1 增强 Node Card

**文件**: `data/v4/node_cards/*.json`

添加本体信息:
```json
{
  "node_id": "chem:concept:enthalpy-change",
  "canonical_name": "焓变",
  "owl_info": {
    "class": "EnthalpyChange",
    "parent_class": "ThermodynamicConcept",
    "hierarchy": [
      "KnowledgeNode",
      "Concept",
      "ThermodynamicConcept",
      "EnthalpyChange"
    ],
    "rdf_uri": "http://example.org/chemistry-ontology#EnthalpyChange"
  },
  "ontology_relations": {
    "superclasses": ["Concept", "ThermodynamicConcept"],
    "subclasses": [],
    "related_classes": ["ReactionHeat", "Calorimeter"]
  }
}
```

### 3.2 Viewer 显示本体面板

**功能**: 在右侧添加"本体信息"侧边栏

```javascript
// 显示内容:
1. 本体类别: 🔷 ThermodynamicConcept
2. 类别层次: KnowledgeNode → Concept → ThermodynamicConcept
3. 语义关系:
   - 父类: Concept, ThermodynamicConcept
   - 子类: (无)
   - 实例: 焓变, 熵变, 吉布斯自由能变化
4. 推理关系:
   - 因为 ΔH 是 ThermodynamicConcept
   - 所以它有热力学性质
   - 可以被热力学定律描述
```

### 3.3 按本体类别浏览

**新增 Viewer 功能**: 树形浏览器

```
按本体类别浏览:
├── 🟦 Concept (概念)
│   ├── 🟩 ThermodynamicConcept (热力学)
│   │   ├── 🔹 焓、熵、吉布斯自由能...
│   ├── 🟩 ChemicalEquilibrium (平衡)
│   ├── 🟩 ElectrochemicalConcept (电化学)
│   └── 🟩 Concept (其他)
├── 🟦 Entity (实体)
│   ├── 🟩 LaboratoryEquipment
│   └── 🟩 ChemicalSubstance
├── 🟦 Process (过程)
│   ├── 🟩 ChemicalReaction
│   └── 🟩 PhysicalProcess
├── 🟦 Principle (原理)
├── 🟦 Method (方法)
└── 🟦 Activity (活动)
```

### 3.4 关系推理可视化

**功能**: 显示推理出的隐式关系

```
显示选项: ☑ 显式边 ☑ 推理边

焓变 (EnthalpyChange)
├── [显式] causes → 反应热
├── [显式] has_property → 状态函数
├── [推理 ⭐] related_to → 内能 (因为是兄弟类)
└── [推理 ⭐] prerequisite_for → 盖斯定律应用
```

---

## 阶段四：应用激活（3-5天）

### 4.1 智能问答

**功能**: 基于本体的问答系统

```python
# 查询: "什么能测量焓变？"
sparql = """
SELECT ?equipment WHERE {
  ?equipment :measures :EnthalpyChange .
}
"""
# 结果: 热量计 (Calorimeter)

# 查询: "化学反应有哪些类型？"
sparql = """
SELECT ?reaction WHERE {
  ?reaction rdf:type/rdfs:subClassOf* :ChemicalReaction .
}
"""
# 结果: 放热反应、吸热反应、氧化还原反应...
```

### 4.2 前置知识推荐

**功能**: 基于本体的依赖推理

```python
def get_prerequisites(node_id):
    """获取学习某个概念的前置知识"""
    # 如果 Learning X requires knowing Y
    # 且 Y is-part-of Parent
    # 则推荐 Parent
    
    # 示例: 学习"化学平衡常数"
    # 需要知道: 化学平衡 (直接前置)
    # 也相关: 热力学 (同属于热力学范畴)
```

### 4.3 一致性验证

**功能**: 自动发现知识图谱中的逻辑错误

```python
def validate_ontology_consistency():
    """验证知识图谱符合本体约束"""
    errors = []
    
    # 检查1: HessLaw 应该是 Principle，不是 ChemicalSubstance
    for node in nodes.where(owl_class='ChemicalSubstance'):
        if 'Law' in node.name or '原理' in node.name:
            errors.append(f"错误: {node.name} 标记为物质，应为原理")
    
    # 检查2: causes 关系的域应该是 Process
    for edge in edges.where(predicate='causes'):
        if edge.subject.owl_class not in ['Process', 'ChemicalReaction']:
            errors.append(f"错误: {edge.subject} 不能 '引起' 其他事物")
    
    return errors
```

### 4.4 跨学科链接

**功能**: 连接到物理、生物等其他学科本体

```turtle
# 当前 (仅化学)
:Enthalpy rdf:type :ThermodynamicConcept .

# 映射后 (跨学科)
:Enthalpy rdfs:seeAlso physics:Enthalpy ;
         skos:exactMatch physics:Enthalpy .

# 可以查询:"化学中的热力学概念在物理中叫什么？"
```

---

## 快速启动方案（Minimum Viable Integration）

如果您想**现在**就使用本体，最小集成只需要：

### Step 1: 添加数据库字段（10分钟）

```sql
ALTER TABLE nodes ADD COLUMN owl_class TEXT;
ALTER TABLE nodes ADD COLUMN owl_parent TEXT;

-- 为现有节点填充
UPDATE nodes SET owl_class = 
  CASE node_kind
    WHEN 'concept' THEN 'Concept'
    WHEN 'entity' THEN 'Entity'
    WHEN 'process' THEN 'Process'
    WHEN 'principle' THEN 'Principle'
    WHEN 'method' THEN 'Method'
    WHEN 'activity' THEN 'Activity'
    ELSE 'KnowledgeNode'
  END;
```

### Step 2: 创建简单 Viewer 面板（1小时）

在 `viewer/app.js` 中添加：

```javascript
function showOntologyPanel(nodeId) {
  const node = findNode(nodeId);
  const html = `
    <div class="ontology-panel">
      <h3>🔖 本体类别</h3>
      <p>${node.owl_class || 'Unknown'}</p>
      
      <h3>📊 层次</h3>
      <p>KnowledgeNode → ${node.owl_class}</p>
      
      <h3>🔗 相关</h3>
      <p>同类别节点: ${findSimilar(node.owl_class).join(', ')}</p>
    </div>
  `;
  document.getElementById('ontology-sidebar').innerHTML = html;
}
```

### Step 3: 运行完成（5分钟）

```bash
# 更新数据库
sqlite3 storage/knowledge.sqlite < scripts/add_ontology_fields.sql

# 启动 Viewer
python scripts/viewer_sqlite_api.py --db storage/knowledge.sqlite --port 8765

# 访问 http://localhost:8765/viewer/
# 点击节点查看"本体信息"面板
```

---

## 优先级建议

| 阶段 | 工作量 | 价值 | 优先级 |
|------|--------|------|--------|
| 1.1 自动映射生成 | 1天 | ⭐⭐⭐⭐⭐ | P0 (立即做) |
| 2.1 Workflow 集成 | 2天 | ⭐⭐⭐⭐⭐ | P0 |
| 3.1 Viewer 基础显示 | 1天 | ⭐⭐⭐⭐ | P1 (本周做) |
| 3.3 树形浏览器 | 2天 | ⭐⭐⭐⭐⭐ | P1 |
| 4.1 智能问答 | 3天 | ⭐⭐⭐⭐⭐ | P2 (下周做) |
| 4.3 一致性验证 | 2天 | ⭐⭐⭐ | P2 |

---

## 您希望从哪个阶段开始？

**如果您想立即看到效果**: 从"快速启动方案"开始（30分钟搞定）
**如果您要系统性集成**: 从"阶段一：自动映射"开始
**如果您关注应用价值**: 从"阶段三：Viewer 可视化" + "阶段四：智能问答"开始