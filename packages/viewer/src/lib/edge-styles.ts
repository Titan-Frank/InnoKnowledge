import type { ThemeMode } from '@/core/graph/types';

export type EdgeVisual = {
  stroke: string;
  labelTone: 'accent' | 'secondary' | 'neutral' | 'warning' | 'success';
  dashArray?: string;
  category: string;
};

export const HIERARCHY_TYPES = new Set(['is_a', 'instance_of', 'prerequisite_for', 'depends_on', 'extends']);
export const STRUCTURE_TYPES = new Set(['part_of', 'contains']);
export const ASSOCIATION_TYPES = new Set(['related_to', 'analogous_to', 'same_as']);
export const CAUSAL_TYPES = new Set(['explains', 'causes', 'affects']);
export const OPERATIONAL_TYPES = new Set(['uses', 'measures', 'produces', 'consumes', 'applies_to', 'represented_by', 'symbolizes', 'has_property']);

export function resolveEdgeVisual(edgeType: string): EdgeVisual {
  if (HIERARCHY_TYPES.has(edgeType)) {
    return { stroke: '#555AFF', labelTone: 'accent', category: '层级关系' };
  }
  if (STRUCTURE_TYPES.has(edgeType)) {
    return { stroke: '#FFB400', labelTone: 'warning', dashArray: '8 4', category: '结构关系' };
  }
  if (ASSOCIATION_TYPES.has(edgeType)) {
    return { stroke: '#8C55FF', labelTone: 'secondary', dashArray: '3 6', category: '关联关系' };
  }
  if (CAUSAL_TYPES.has(edgeType)) {
    return { stroke: '#1EB478', labelTone: 'success', category: '因果解释' };
  }
  if (OPERATIONAL_TYPES.has(edgeType)) {
    return { stroke: '#3782FF', labelTone: 'neutral', dashArray: '10 4', category: '作用关系' };
  }
  return { stroke: 'rgba(90, 90, 112, 0.5)', labelTone: 'neutral', category: '一般关系' };
}

export function resolveNodeLayerVisual(nodeLayer: string | null | undefined, mode: ThemeMode = 'dark') {
  if (nodeLayer === 'backbone') {
    return {
      label: '主干节点',
      stroke: '#7c3aed',
      fill: mode === 'light' ? 'rgba(124, 58, 237, 0.08)' : 'rgba(124, 58, 237, 0.18)',
      badgeTone: 'accent' as const,
    };
  }
  return {
    label: '支撑节点',
    stroke: mode === 'light' ? 'rgba(140, 140, 160, 0.4)' : 'rgba(42, 42, 58, 0.5)',
    fill: mode === 'light' ? 'rgba(240, 240, 245, 0.7)' : 'rgba(16, 16, 24, 0.7)',
    badgeTone: 'neutral' as const,
  };
}
