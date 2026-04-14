export type EdgeVisual = {
  stroke: string;
  labelTone: 'accent' | 'secondary' | 'neutral' | 'warning' | 'success';
  dashArray?: string;
  category: string;
};

const HIERARCHY_TYPES = new Set(['is_a', 'instance_of', 'prerequisite_for', 'depends_on', 'extends']);
const STRUCTURE_TYPES = new Set(['part_of', 'contains']);
const ASSOCIATION_TYPES = new Set(['related_to', 'analogous_to', 'same_as']);
const CAUSAL_TYPES = new Set(['explains', 'causes', 'affects']);
const OPERATIONAL_TYPES = new Set(['uses', 'measures', 'produces', 'consumes', 'applies_to', 'represented_by', 'symbolizes', 'has_property']);

export function resolveEdgeVisual(edgeType: string): EdgeVisual {
  if (HIERARCHY_TYPES.has(edgeType)) {
    return {
      stroke: '#555AFF',
      labelTone: 'accent',
      category: '层级关系',
    };
  }

  if (STRUCTURE_TYPES.has(edgeType)) {
    return {
      stroke: '#FFB400',
      labelTone: 'warning',
      dashArray: '8 4',
      category: '结构关系',
    };
  }

  if (ASSOCIATION_TYPES.has(edgeType)) {
    return {
      stroke: '#8C55FF',
      labelTone: 'secondary',
      dashArray: '3 6',
      category: '关联关系',
    };
  }

  if (CAUSAL_TYPES.has(edgeType)) {
    return {
      stroke: '#1EB478',
      labelTone: 'success',
      category: '因果解释',
    };
  }

  if (OPERATIONAL_TYPES.has(edgeType)) {
    return {
      stroke: '#3782FF',
      labelTone: 'neutral',
      dashArray: '10 4',
      category: '作用关系',
    };
  }

  return {
    stroke: 'rgba(90, 90, 112, 0.5)',
    labelTone: 'neutral',
    category: '一般关系',
  };
}

export function resolveNodeLayerVisual(nodeLayer: string | null | undefined) {
  if (nodeLayer === 'backbone') {
    return {
      label: '主干节点',
      stroke: '#7c3aed',
      fill: 'rgba(124, 58, 237, 0.18)',
      badgeTone: 'accent' as const,
    };
  }

  return {
    label: '支撑节点',
    stroke: 'rgba(42, 42, 58, 0.5)',
    fill: 'rgba(16, 16, 24, 0.7)',
    badgeTone: 'neutral' as const,
  };
}
