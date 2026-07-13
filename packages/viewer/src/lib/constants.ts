export const TYPE_META: Record<string, { label: string; color: string }> = {
  concept: { label: '概念', color: '#555AFF' },
  entity: { label: '实体', color: '#3782FF' },
  property: { label: '属性', color: '#9A9AB0' },
  process: { label: '过程', color: '#2BA876' },
  event: { label: '事件', color: '#E84855' },
  method: { label: '方法', color: '#FFB400' },
  rule: { label: '规则', color: '#8C55FF' },
  representation: { label: '表征', color: '#5580CC' },
  resource: { label: '资源', color: '#14B8A6' },
  substance: { label: '物质', color: '#3782FF' },
  experiment: { label: '实验', color: '#1EB478' },
  symbol: { label: '符号', color: '#5580CC' },
  simulation_tool: { label: '仿真工具', color: '#9A9AB0' },
  仿真工具: { label: '仿真工具', color: '#9A9AB0' },
  'bond-angle': { label: '键角', color: '#9A9AB0' },
  'bond count': { label: '成键数', color: '#9A9AB0' },
  'bond length': { label: '键长', color: '#9A9AB0' },
  'bond property': { label: '化学键性质', color: '#9A9AB0' },
  'bonding rule': { label: '成键规则', color: '#9A9AB0' },
  'chemical stability': { label: '化学稳定性', color: '#9A9AB0' },
  chemical_structure_prediction_rule: { label: '结构预测规则', color: '#9A9AB0' },
  'electron-pair-property': { label: '电子对性质', color: '#9A9AB0' },
  'electronic-repulsion-rule': { label: '电子排斥规则', color: '#9A9AB0' },
  'geometry-rule': { label: '几何规则', color: '#9A9AB0' },
  'molecular-geometry': { label: '分子几何构型', color: '#9A9AB0' },
  molecular_mass_property: { label: '相对分子质量性质', color: '#9A9AB0' },
  molecular_property: { label: '分子性质', color: '#9A9AB0' },
  'orbital geometry': { label: '轨道几何', color: '#9A9AB0' },
  principle_group: { label: '原理组', color: '#9A9AB0' },
  'system energy': { label: '体系能量', color: '#9A9AB0' },
  thermophysical_property: { label: '热物理性质', color: '#9A9AB0' },
  thermophysical_trend_rule: { label: '热物性趋势规则', color: '#9A9AB0' },
  化学键结构参量: { label: '化学键结构参量', color: '#9A9AB0' },
  结构性质: { label: '结构性质', color: '#9A9AB0' },
  晶体宏观形态性质: { label: '晶体宏观形态性质', color: '#9A9AB0' },
  晶体结构几何属性: { label: '晶体结构几何属性', color: '#9A9AB0' },
  晶体物理性质: { label: '晶体物理性质', color: '#9A9AB0' },
  热学性质: { label: '热学性质', color: '#9A9AB0' },
  other: { label: '其他', color: '#9A9AB0' },
};

export const LEARNING_MODE_LABELS: Record<string, string> = {
  factual: '事实性',
  conceptual: '概念性',
  procedural: '程序性',
  metacognitive: '元认知',
};

export const KNOWLEDGE_FORM_LABELS: Record<string, string> = {
  propositional: '命题式',
  practical: '实践式',
};

export const SCOPE_LABELS: Record<string, string> = {
  universal: '通用',
  'domain-specific': '领域特定',
  'culture-specific': '文化特定',
};

export const TAG_LABELS: Record<string, string> = {
  system: '系统',
  structure: '结构',
  function: '功能',
  change: '变化',
  interaction: '相互作用',
  energy: '能量',
  matter: '物质',
  evidence: '证据',
  model: '模型',
  representation: '表征',
  measurement: '测量',
  classification: '分类',
  rule: '规则',
  scale: '尺度',
  causality: '因果',
  uncertainty: '不确定性',
};

export const SCHOOL_STAGE_LABELS: Record<string, string> = {
  primary: '小学',
  'junior-secondary': '初中',
  'senior-secondary': '高中',
  junior_secondary: '初中',
  senior_secondary: '高中',
  higher: '高等教育',
  cross_stage: '跨学段',
};

export const CURRICULUM_ROLE_LABELS: Record<string, string> = {
  core: '核心',
  support: '支撑',
  assessment: '评价',
  practice: '练习',
  literacy: '素养',
  introduced: '首次引入',
  reinforced: '巩固强化',
  developed: '深入发展',
  integrated: '综合整合',
  transferred: '迁移应用',
  assessed: '评价考查',
};

export const DOMAIN_LABELS: Record<string, string> = {
  mathematics: '数学',
  physics: '物理',
  chemistry: '化学',
  biology: '生物学',
  'earth-science': '地球科学',
  astronomy: '天文学',
  'computer-science': '计算机科学',
  engineering: '工程学',
  'language-arts': '语言与语文',
  linguistics: '语言学',
  literature: '文学',
  history: '历史',
  geography: '地理',
  civics: '公民教育',
  economics: '经济学',
  law: '法学',
  education: '教育学',
  arts: '艺术',
  music: '音乐',
  health: '健康',
  sports: '体育',
  philosophy: '哲学',
  general: '通用',
};

export const PEDAGOGICAL_DIFFICULTY_LABELS: Record<string, string> = {
  introductory: '入门',
  basic: '基础',
  intermediate: '中等',
  advanced: '进阶',
  expert: '专家级',
};

export const PEDAGOGICAL_REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: '待审核',
  approved: '已确认',
  rejected: '已退回',
};

export const MASTERY_LEVEL_LABELS: Record<string, string> = {
  aware: '感知',
  identify: '识别',
  understand: '理解',
  apply: '应用',
  analyze: '分析',
  model: '建模',
  transfer: '迁移',
  evaluate: '评价',
  create: '创造',
};

export const NODE_LAYER_LABELS: Record<string, string> = {
  backbone: '主干',
  support: '支撑',
};

export const EDGE_LAYER_LABELS: Record<string, string> = {
  backbone: '主干关系',
  support: '支撑关系',
};

export const EDGE_TYPE_LABELS: Record<string, string> = {
  is_a: '属于',
  instance_of: '实例',
  part_of: '组成部分',
  contains: '包含',
  has_property: '具有性质',
  uses: '使用',
  produces: '生成',
  depends_on: '依赖',
  prerequisite_for: '前置知识',
  causes: '导致',
  affects: '影响',
  represents: '表征',
  about: '关于',
  same_as: '等同',
  related_to: '相关',
};

export const LAYER_MODE_OPTIONS = [
  {
    id: 'backbone-expand' as const,
    label: '主干展开',
    description: '默认只显示主干，选中主干节点时展开它的支撑节点。',
  },
  {
    id: 'all' as const,
    label: '全部节点',
    description: '同时显示主干和支撑节点。',
  },
];

export type LayerMode = (typeof LAYER_MODE_OPTIONS)[number]['id'];

export const API_BASE = '/api';
export const META_PATH = `${API_BASE}/meta`;

export const COMMUNITY_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6',
  '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e', '#14b8a6', '#a3e635',
];

export const COMMUNITY_COLORS_LIGHT = [
  '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb',
  '#7c3aed', '#c026d3', '#db2777', '#e11d48', '#0d9488', '#65a30d',
];

import type { ThemeMode } from '@/core/graph/types';

export function getCommunityColor(index: number, mode: ThemeMode = 'dark'): string {
  const palette = mode === 'light' ? COMMUNITY_COLORS_LIGHT : COMMUNITY_COLORS;
  return palette[index % palette.length];
}

export const COMMUNITY_EDGE_TYPES = new Set([
  'related_to', 'same_as', 'about',
  'causes', 'affects',
  'uses', 'produces', 'represents', 'has_property',
]);
