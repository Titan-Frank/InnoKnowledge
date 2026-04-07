# V4知识图谱修复建议

## 必须建立的边关系 (Critical Edges)

根据化学教材知识体系，以下为必须建立的边关系，用于连接孤立的核心概念：

### 第一类：酸碱与pH体系

```sql
-- pH与酸碱的关系
INSERT INTO edges (dataset_id, id, edge_type, edge_layer, backbone_expand, from_id, to_id, directionality, confidence, status)
VALUES 
('v4', 'edge:pH-measures-acid', 'measures', 'backbone', 0, 'concept:pH', 'concept:acid', 'directed', 0.95, 'active'),
('v4', 'edge:pH-measures-base', 'measures', 'backbone', 0, 'concept:pH', 'concept:base', 'directed', 0.95, 'active'),
('v4', 'edge:acid-participates-neutral', 'participates_in', 'backbone', 0, 'concept:acid', 'concept:neutralization-reaction', 'directed', 0.95, 'active'),
('v4', 'edge:base-participates-neutral', 'participates_in', 'backbone', 0, 'concept:base', 'concept:neutralization-reaction', 'directed', 0.95, 'active'),
('v4', 'edge:neutral-produces-salt', 'produces', 'backbone', 0, 'concept:neutralization-reaction', 'concept:salt', 'directed', 0.9, 'active'),
('v4', 'edge:neutral-produces-water', 'produces', 'backbone', 0, 'concept:neutralization-reaction', 'entity/substance:water', 'directed', 0.9, 'active');
```

### 第二类：燃烧与氧化反应

```sql
-- 燃烧体系
INSERT INTO edges (dataset_id, id, edge_type, edge_layer, backbone_expand, from_id, to_id, directionality, confidence, status)
VALUES 
('v4', 'edge:combustion-is-oxidation', 'is_a', 'backbone', 0, 'concept:combustion', 'concept:chem:oxidation_reaction', 'directed', 0.95, 'active'),
('v4', 'edge:complete-combustion-is-combustion', 'is_a', 'backbone', 0, 'concept:complete-combustion', 'concept:combustion', 'directed', 0.95, 'active'),
('v4', 'edge:incomplete-combustion-is-combustion', 'is_a', 'backbone', 0, 'concept:incomplete-combustion', 'concept:combustion', 'directed', 0.95, 'active'),
('v4', 'edge:ethanol-undergoes-combustion', 'undergoes', 'backbone', 0, 'entity/substance:ethanol', 'concept:combustion', 'directed', 0.9, 'active'),
('v4', 'edge:methane-undergoes-combustion', 'undergoes', 'backbone', 0, 'entity/substance:methane', 'concept:combustion', 'directed', 0.9, 'active'),
('v4', 'edge:coal-undergoes-combustion', 'undergoes', 'backbone', 0, 'entity/substance:coal', 'concept:combustion', 'directed', 0.9, 'active');
```

### 第三类：能源体系

```sql
-- 能源分类
INSERT INTO edges (dataset_id, id, edge_type, edge_layer, backbone_expand, from_id, to_id, directionality, confidence, status)
VALUES 
('v4', 'edge:fossil-fuel-is-energy', 'is_a', 'backbone', 0, 'concept:fossil-fuel', 'concept:energy', 'directed', 0.95, 'active'),
('v4', 'edge:renewable-energy-is-energy', 'is_a', 'backbone', 0, 'concept:renewable-energy', 'concept:energy', 'directed', 0.95, 'active'),
('v4', 'edge:hydrogen-energy-is-energy', 'is_a', 'backbone', 0, 'concept:hydrogen-energy', 'concept:energy', 'directed', 0.95, 'active'),
('v4', 'edge:bioenergy-is-energy', 'is_a', 'backbone', 0, 'concept:bioenergy', 'concept:energy', 'directed', 0.9, 'active'),
('v4', 'edge:coal-is-fossil-fuel', 'is_a', 'backbone', 0, 'entity/substance:coal', 'concept:fossil-fuel', 'directed', 0.95, 'active'),
('v4', 'edge:petroleum-is-fossil-fuel', 'is_a', 'backbone', 0, 'entity/substance:petroleum', 'concept:fossil-fuel', 'directed', 0.95, 'active'),
('v4', 'edge:methane-is-fossil-fuel', 'is_a', 'backbone', 0, 'entity/substance:methane', 'concept:fossil-fuel', 'directed', 0.9, 'active'),
('v4', 'edge:ethanol-is-renewable', 'is_a', 'backbone', 0, 'entity/substance:ethanol', 'concept:renewable-energy', 'directed', 0.85, 'active'),
('v4', 'edge:biodiesel-is-renewable', 'is_a', 'backbone', 0, 'entity/substance:biodiesel', 'concept:renewable-energy', 'directed', 0.85, 'active'),
('v4', 'edge:biogas-is-renewable', 'is_a', 'backbone', 0, 'entity/substance:biogas', 'concept:renewable-energy', 'directed', 0.85, 'active');
```

### 第四类：化学反应类型体系

```sql
-- 反应类型分类
INSERT INTO edges (dataset_id, id, edge_type, edge_layer, backbone_expand, from_id, to_id, directionality, confidence, status)
VALUES 
('v4', 'edge:combination-reaction-is-type', 'is_a', 'backbone', 0, 'concept:chem:combination_reaction', 'concept:chemical-reaction-type', 'directed', 0.95, 'active'),
('v4', 'edge:decomposition-reaction-is-type', 'is_a', 'backbone', 0, 'concept:chem:decomposition_reaction', 'concept:chemical-reaction-type', 'directed', 0.95, 'active'),
('v4', 'edge:single-displacement-is-type', 'is_a', 'backbone', 0, 'concept:chem:single_displacement_reaction', 'concept:chemical-reaction-type', 'directed', 0.95, 'active'),
('v4', 'edge:double-displacement-is-type', 'is_a', 'backbone', 0, 'concept:chem:double_displacement_reaction', 'concept:chemical-reaction-type', 'directed', 0.95, 'active'),
('v4', 'edge:neutralization-is-double-displace', 'is_a', 'backbone', 0, 'concept:neutralization-reaction', 'concept:chem:double_displacement_reaction', 'directed', 0.9, 'active'),
('v4', 'edge:oxidation-reaction-is-type', 'is_a', 'backbone', 0, 'concept:chem:oxidation_reaction', 'concept:chemical-reaction-type', 'directed', 0.95, 'active'),
('v4', 'edge:reduction-reaction-is-type', 'is_a', 'backbone', 0, 'concept:chem:reduction_reaction', 'concept:chemical-reaction-type', 'directed', 0.95, 'active'),
('v4', 'edge:chemical-equation-represents-reaction', 'represents', 'backbone', 0, 'concept:chem:chemical_equation', 'concept:chemical-reaction-type', 'directed', 0.95, 'active'),
('v4', 'edge:catalysis-accelerates-reaction', 'accelerates', 'backbone', 0, 'concept:catalysis', 'concept:chemical-reaction-type', 'directed', 0.9, 'active'),
('v4', 'edge:catalyst-used-in-reaction', 'used_in', 'backbone', 0, 'entity/substance:catalyst', 'concept:chemical-reaction-type', 'directed', 0.85, 'active');
```

### 第五类：材料体系

```sql
-- 材料分类
INSERT INTO edges (dataset_id, id, edge_type, edge_layer, backbone_expand, from_id, to_id, directionality, confidence, status)
VALUES 
('v4', 'edge:alloy-is-metal-material', 'is_a', 'backbone', 0, 'concept:alloy', 'concept:metal-materials', 'directed', 0.95, 'active'),
('v4', 'edge:stainless-steel-is-alloy', 'is_a', 'backbone', 0, 'entity/substance:stainless-steel', 'concept:alloy', 'directed', 0.95, 'active'),
('v4', 'edge:magnesium-aluminum-is-alloy', 'is_a', 'backbone', 0, 'entity/substance:magnesium-aluminum-alloy', 'concept:alloy', 'directed', 0.95, 'active'),
('v4', 'edge:plastic-is-polymer', 'is_a', 'backbone', 0, 'entity/substance:plastic', 'concept:organic-polymer-materials', 'directed', 0.95, 'active'),
('v4', 'edge:synthetic-fiber-is-polymer', 'is_a', 'backbone', 0, 'entity/substance:synthetic-fiber', 'concept:organic-polymer-materials', 'directed', 0.9, 'active'),
('v4', 'edge:synthetic-rubber-is-polymer', 'is_a', 'backbone', 0, 'entity/substance:synthetic-rubber', 'concept:organic-polymer-materials', 'directed', 0.9, 'active'),
('v4', 'edge:ceramics-is-inorganic-nonmetal', 'is_a', 'backbone', 0, 'concept:ceramics', 'concept:inorganic-nonmetal-materials', 'directed', 0.95, 'active'),
('v4', 'edge:glass-is-inorganic-nonmetal', 'is_a', 'backbone', 0, 'concept:glass', 'concept:inorganic-nonmetal-materials', 'directed', 0.95, 'active');
```

### 第六类：溶液体系

```sql
-- 溶液相关
INSERT INTO edges (dataset_id, id, edge_type, edge_layer, backbone_expand, from_id, to_id, directionality, confidence, status)
VALUES 
('v4', 'edge:solution-concentration-related-solubility', 'related_to', 'backbone', 0, 'concept:solution-concentration', 'concept:solid-solubility', 'bidirectional', 0.85, 'active'),
('v4', 'edge:solubility-uses-solubility-curve', 'represented_by', 'backbone', 0, 'concept:solid-solubility', 'representation:solubility-curve', 'directed', 0.9, 'active'),
('v4', 'edge:solute-mass-fraction-measures-concentration', 'measures', 'backbone', 0, 'concept:solute-mass-fraction', 'concept:solution-concentration', 'directed', 0.95, 'active'),
('v4', 'edge:crystallization-uses-evaporation', 'uses', 'backbone', 0, 'process:crystallization', 'method:evaporation-crystallization', 'directed', 0.9, 'active'),
('v4', 'edge:crystallization-uses-cooling', 'uses', 'backbone', 0, 'process:crystallization', 'method:cooling-crystallization', 'directed', 0.9, 'active');
```

### 第七类：化学基础概念

```sql
-- 基本概念关系
INSERT INTO edges (dataset_id, id, edge_type, edge_layer, backbone_expand, from_id, to_id, directionality, confidence, status)
VALUES 
('v4', 'edge:acid-has-hydrogen-ion', 'has_property', 'backbone', 0, 'concept:acid', 'concept:hydrogen-ion', 'directed', 0.95, 'active'),
('v4', 'edge:base-has-hydroxide-ion', 'has_property', 'backbone', 0, 'concept:base', 'concept:hydroxide-ion', 'directed', 0.95, 'active'),
('v4', 'edge:ionization-produces-hydrogen-ion', 'produces', 'backbone', 0, 'concept:ionization', 'concept:hydrogen-ion', 'directed', 0.9, 'active'),
('v4', 'edge:ionization-produces-hydroxide-ion', 'produces', 'backbone', 0, 'concept:ionization', 'concept:hydroxide-ion', 'directed', 0.9, 'active'),
('v4', 'edge:oxidation-contrasts-reduction', 'contrasts_with', 'backbone', 0, 'concept:chem:oxidation_reaction', 'concept:chem:reduction_reaction', 'bidirectional', 0.95, 'active');
```

## 预期修复效果

执行上述边插入后，预期效果：

| 指标 | 修复前 | 修复后(预估) | 改善 |
|------|--------|--------------|------|
| 总边数 | 185 | ~300 | +115 |
| 孤立节点 | 123 | ~40 | -83 |
| 孤立率 | 44% | ~14% | -30% |
| 边密度 | 0.66 | ~1.07 | +0.41 |

## 重复节点合并建议

### 合并策略

对于每对重复节点，建议：

1. **中和反应**: 保留 `concept:neutralization-reaction`，删除 `process:neutralization-reaction`
2. **分解反应**: 保留 `concept:chem:decomposition_reaction`，删除 `concept:chemical-reaction-type:decomposition`
3. **化合反应**: 保留 `concept:chem:combination_reaction`，删除 `concept:chemical-reaction-type:combination`
4. **化学方程式**: 保留 `concept:chem:chemical_equation`，删除 `representation:chemical-equation`
5. **单质**: 保留 `concept:simple-substance`，删除 `concept:substance:pure:element`
6. **复分解反应**: 保留 `concept:chem:double_displacement_reaction`，删除 `process:double-decomposition-reaction`
7. **物理变化**: 保留 `concept:physical-change`，删除 `process:physical-change`
8. **碳酸钙**: 保留 `entity/substance:calcium_carbonate`，删除 `entity/substance:calcium-carbonate`
9. **蒸发**: 保留 `concept:evaporation`，删除 `method:evaporation`

### 合并步骤

对于每个重复节点对，执行：

1. **迁移边**: 将待删除节点的所有边重定向到保留节点
2. **迁移提及**: 更新所有提及的目标节点ID
3. **迁移证据**: 更新证据引用
4. **删除节点**: 删除重复节点

## QA验证计划

修复后必须执行以下验证：

1. **孤立节点检查**: 确认孤立比例低于10%
2. **重复节点检查**: 确认无重复canonical_name
3. **边完整性检查**: 确认所有from_id和to_id存在
4. **环检测**: 确认层次边无环
5. **连通分量分析**: 确认最大连通分量占比>80%

---

**警告**: 执行这些修复前，请务必备份SQLite数据库！
