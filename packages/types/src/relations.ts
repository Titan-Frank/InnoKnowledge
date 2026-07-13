export const ACTIVE_EDGE_TYPES = [
  'is_a',
  'instance_of',
  'part_of',
  'contains',
  'has_property',
  'uses',
  'produces',
  'depends_on',
  'prerequisite_for',
  'causes',
  'affects',
  'represents',
  'formalizes',
  'applies_to',
  'analogous_to',
  'models',
  'about',
  'related_to',
] as const;

export const LEGACY_EDGE_TYPES = ['same_as'] as const;
export const EDGE_TYPES = [...ACTIVE_EDGE_TYPES, ...LEGACY_EDGE_TYPES] as const;

export type ActiveEdgeType = typeof ACTIVE_EDGE_TYPES[number];
export type LegacyEdgeType = typeof LEGACY_EDGE_TYPES[number];
export type EdgeType = typeof EDGE_TYPES[number];
export type RelationScope = 'intra_domain' | 'cross_domain' | 'universal';

export type RelationCategory =
  | 'classification'
  | 'structure'
  | 'mechanism'
  | 'learning'
  | 'representation'
  | 'application'
  | 'analogy'
  | 'association'
  | 'legacy';

export interface EdgeTypeMetadata {
  code: EdgeType;
  label_zh: string;
  sentence_zh: string;
  description_zh: string;
  category: RelationCategory;
  default_directionality: 'directed' | 'undirected';
  aliases_zh: readonly string[];
  active: boolean;
}

export const EDGE_TYPE_METADATA: Record<EdgeType, EdgeTypeMetadata> = {
  is_a: relation('is_a', '是一种', '{from} 是一种 {to}', '表示具体类型属于更一般的类型。', 'classification', 'directed', ['属于', '下位于']),
  instance_of: relation('instance_of', '是实例', '{from} 是 {to} 的实例', '表示具体对象是某个一般对象的实例。', 'classification', 'directed', ['实例', '实例化为']),
  part_of: relation('part_of', '是组成部分', '{from} 是 {to} 的组成部分', '表示来源对象构成目标对象的一部分。', 'structure', 'directed', ['组成部分', '隶属于']),
  contains: relation('contains', '包含', '{from} 包含 {to}', '表示来源对象在结构上包含目标对象。', 'structure', 'directed', ['含有', '由其包含']),
  has_property: relation('has_property', '具有属性', '{from} 具有属性 {to}', '表示对象具有某个性质、状态或可测特征。', 'mechanism', 'directed', ['具有性质', '属性为']),
  uses: relation('uses', '使用', '{from} 使用 {to}', '表示方法、模型或过程使用目标对象。', 'application', 'directed', ['采用', '运用']),
  produces: relation('produces', '产生', '{from} 产生 {to}', '表示过程、机制或方法产生目标对象。', 'mechanism', 'directed', ['生成', '产出']),
  depends_on: relation('depends_on', '依赖', '{from} 依赖 {to}', '表示来源对象成立、运行或理解时依赖目标对象。', 'mechanism', 'directed', ['基于', '以其为基础']),
  prerequisite_for: relation('prerequisite_for', '是前置知识', '{from} 是学习 {to} 的前置知识', '表示理解来源对象应先于目标对象。', 'learning', 'directed', ['前置于', '先修于']),
  causes: relation('causes', '导致', '{from} 导致 {to}', '表示来源对象对目标对象具有直接因果作用。', 'mechanism', 'directed', ['引起', '造成']),
  affects: relation('affects', '影响', '{from} 影响 {to}', '表示来源对象改变目标对象，但不声称充分因果。', 'mechanism', 'directed', ['作用于', '改变']),
  represents: relation('represents', '表示', '{from} 表示 {to}', '表示符号、图式或表达形式指向目标知识对象。', 'representation', 'directed', ['表征', '指代']),
  formalizes: relation('formalizes', '形式化表达', '{from} 形式化表达 {to}', '表示来源对象为目标对象提供数学、逻辑或符号形式。', 'representation', 'directed', ['形式化', '数学化表达']),
  applies_to: relation('applies_to', '应用于', '{from} 应用于 {to}', '表示方法、理论或工具可用于目标问题或领域。', 'application', 'directed', ['适用于', '用于']),
  analogous_to: relation('analogous_to', '类似于', '{from} 类似于 {to}', '表示两个对象在明确机制或结构框架下具有可解释类比。', 'analogy', 'undirected', ['类比于', '相似于']),
  models: relation('models', '建模描述', '{from} 建模描述 {to}', '表示来源模型对目标对象、过程或现象进行建模描述。', 'representation', 'directed', ['模拟', '刻画']),
  about: relation('about', '主题是', '{from} 的主题是 {to}', '表示资源、表征或内容以目标对象为主题。', 'association', 'directed', ['关于', '围绕']),
  related_to: relation('related_to', '相关', '{from} 与 {to} 相关', '只表示存在待进一步细化的稳定关联。', 'association', 'undirected', ['有关', '关联']),
  same_as: {
    ...relation('same_as', '同一对象（已停用）', '{from} 与 {to} 指向同一对象', '历史兼容关系。新数据必须执行节点身份归一，不得新建此关系。', 'legacy', 'undirected', ['等同', '同一对象']),
    active: false,
  },
};

export const EDGE_TYPE_LABELS_ZH = Object.fromEntries(
  Object.values(EDGE_TYPE_METADATA).map((item) => [item.code, item.label_zh]),
) as Record<EdgeType, string>;

const EDGE_TYPE_ALIAS_MAP = new Map<string, EdgeType>();
for (const item of Object.values(EDGE_TYPE_METADATA)) {
  for (const alias of [item.code, item.label_zh, item.sentence_zh, ...item.aliases_zh]) {
    EDGE_TYPE_ALIAS_MAP.set(normalizeAlias(alias), item.code);
  }
}

export function normalizeEdgeType(value: unknown, options?: { allowLegacy?: false }): ActiveEdgeType | null;
export function normalizeEdgeType(value: unknown, options: { allowLegacy: true }): EdgeType | null;
export function normalizeEdgeType(value: unknown, options: { allowLegacy?: boolean } = {}): EdgeType | null {
  const normalized = normalizeAlias(String(value ?? ''));
  if (!normalized) return null;
  const edgeType = EDGE_TYPE_ALIAS_MAP.get(normalized) ?? null;
  if (!edgeType) return null;
  if (!options.allowLegacy && !EDGE_TYPE_METADATA[edgeType].active) return null;
  return edgeType;
}

export function isActiveEdgeType(value: unknown): value is ActiveEdgeType {
  return normalizeEdgeType(value) !== null;
}

export function edgeTypeLabelZh(value: unknown): string {
  const edgeType = normalizeEdgeType(value, { allowLegacy: true });
  return edgeType ? EDGE_TYPE_METADATA[edgeType].label_zh : String(value ?? '').trim() || '未知关系';
}

export function formatRelationZh(edgeType: unknown, fromName: string, toName: string): string {
  const normalized = normalizeEdgeType(edgeType, { allowLegacy: true });
  if (!normalized) return `${fromName} 与 ${toName} 存在未知关系`;
  return EDGE_TYPE_METADATA[normalized].sentence_zh
    .replace('{from}', fromName)
    .replace('{to}', toName);
}

function relation(
  code: EdgeType,
  label_zh: string,
  sentence_zh: string,
  description_zh: string,
  category: RelationCategory,
  default_directionality: 'directed' | 'undirected',
  aliases_zh: readonly string[],
): EdgeTypeMetadata {
  return {
    code,
    label_zh,
    sentence_zh,
    description_zh,
    category,
    default_directionality,
    aliases_zh,
    active: true,
  };
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}
