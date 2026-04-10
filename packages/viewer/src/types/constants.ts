export const TYPE_META: Record<string, { label: string; color: string }> = {
  concept: { label: '概念', color: '#9e4f2b' },
  substance: { label: '物质', color: '#2d6b7d' },
  entity: { label: '实体', color: '#2d6b7d' },
  experiment: { label: '实验', color: '#4f7a3f' },
  activity: { label: '活动', color: '#4f7a3f' },
  process: { label: '过程', color: '#6b7a3d' },
  principle: { label: '原理', color: '#8f5b2b' },
  method: { label: '方法', color: '#9c7b2f' },
  skill: { label: '技能', color: '#6d4d94' },
  symbol: { label: '符号', color: '#31576c' },
  representation: { label: '表征', color: '#31576c' },
  question: { label: '问题', color: '#a34b5f' },
  event: { label: '事件', color: '#9a4d63' },
  issue: { label: '议题', color: '#b15a3c' },
  other: { label: '其他', color: '#777777' },
};

export const LEARNING_MODE_LABELS: Record<string, string> = {
  factual: '事实性',
  conceptual: '概念性',
  procedural: '程序性',
  metacognitive: '元认知',
};

export const BRIDGE_TAG_LABELS: Record<string, string> = {
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
  junior_secondary: '初中',
  senior_secondary: '高中',
  higher: '高等教育',
  cross_stage: '跨学段',
};

export const CURRICULUM_ROLE_LABELS: Record<string, string> = {
  introduced: '首次引入',
  reinforced: '巩固强化',
  developed: '深入发展',
  integrated: '综合整合',
  transferred: '迁移应用',
  assessed: '评价考查',
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
