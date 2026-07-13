export const DOMAIN_SCHEMA_DEFINITIONS = {
  general: {
    schema_id: 'domain:general:v1',
    version: '1.0',
    display_name_zh: '通用学科模式',
    roles: ['knowledge_object', 'principle', 'method', 'representation', 'resource'],
  },
  mathematics: {
    schema_id: 'domain:mathematics:v1',
    version: '1.0',
    display_name_zh: '数学学科模式',
    roles: ['definition', 'theorem', 'proof_technique', 'mathematical_model', 'problem_solving_method', 'formal_representation'],
  },
  physics: {
    schema_id: 'domain:physics:v1',
    version: '1.0',
    display_name_zh: '物理学科模式',
    roles: ['law', 'principle', 'model', 'phenomenon', 'experiment', 'measurement_method', 'physical_quantity'],
  },
  'computer-science': {
    schema_id: 'domain:computer-science:v1',
    version: '1.0',
    display_name_zh: '计算机科学学科模式',
    roles: ['algorithm', 'data_structure', 'computational_model', 'system', 'programming_construct', 'method', 'theory'],
  },
  chemistry: {
    schema_id: 'domain:chemistry:v1',
    version: '1.0',
    display_name_zh: '化学学科模式',
    roles: ['substance', 'reaction', 'law', 'model', 'principle', 'experiment', 'analysis_method', 'chemical_property'],
  },
  biology: {
    schema_id: 'domain:biology:v1',
    version: '1.0',
    display_name_zh: '生物学科模式',
    roles: ['structure', 'process', 'mechanism', 'theory', 'model', 'experiment', 'classification', 'organism'],
  },
} as const;

export type DefinedDomain = keyof typeof DOMAIN_SCHEMA_DEFINITIONS;

export const DOMAIN_ROLE_LABELS_ZH: Record<string, string> = {
  knowledge_object: '知识对象',
  principle: '原理',
  method: '方法',
  representation: '表征',
  resource: '资源',
  definition: '定义',
  theorem: '定理',
  proof_technique: '证明方法',
  mathematical_model: '数学模型',
  problem_solving_method: '解题方法',
  formal_representation: '形式化表征',
  law: '定律',
  model: '模型',
  phenomenon: '现象',
  experiment: '实验',
  measurement_method: '测量方法',
  physical_quantity: '物理量',
  algorithm: '算法',
  data_structure: '数据结构',
  computational_model: '计算模型',
  system: '系统',
  programming_construct: '程序构造',
  theory: '理论',
  substance: '物质',
  reaction: '反应',
  analysis_method: '分析方法',
  chemical_property: '化学性质',
  structure: '结构',
  process: '过程',
  mechanism: '机制',
  classification: '分类',
  organism: '生物体',
};

export function domainRoleLabelZh(role: string): string {
  return DOMAIN_ROLE_LABELS_ZH[role] ?? role;
}

export function domainSchemaFor(domain: string) {
  return DOMAIN_SCHEMA_DEFINITIONS[domain as DefinedDomain] ?? DOMAIN_SCHEMA_DEFINITIONS.general;
}

export function isValidDomainRole(domain: string, role: string): boolean {
  const schema = domainSchemaFor(domain);
  return (schema.roles as readonly string[]).includes(role);
}

export function defaultDomainRole(domain: string, nodeKind?: string | null): string {
  const kind = String(nodeKind ?? '').trim();
  const preferredByDomain: Record<string, Record<string, string>> = {
    mathematics: { rule: 'theorem', method: 'problem_solving_method', representation: 'formal_representation' },
    physics: { rule: 'law', representation: 'model', property: 'physical_quantity', event: 'phenomenon', process: 'phenomenon' },
    'computer-science': { method: 'algorithm', representation: 'computational_model', entity: 'system', rule: 'theory' },
    chemistry: { entity: 'substance', process: 'reaction', rule: 'law', property: 'chemical_property', representation: 'model' },
    biology: { entity: 'organism', process: 'process', rule: 'theory', representation: 'model' },
  };
  return preferredByDomain[domain]?.[kind] ?? domainSchemaFor(domain).roles[0];
}
