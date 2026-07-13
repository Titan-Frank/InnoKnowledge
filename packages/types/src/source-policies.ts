export const SOURCE_TYPE_POLICIES = {
  textbook: { label_zh: '教材', relation_evidence_allowed: true, requires_explicit_review: false, trust_tier: 2 },
  academic_paper: { label_zh: '学术论文', relation_evidence_allowed: true, requires_explicit_review: false, trust_tier: 3 },
  encyclopedia: { label_zh: '百科资料', relation_evidence_allowed: true, requires_explicit_review: true, trust_tier: 1 },
  curriculum_standard: { label_zh: '课程标准', relation_evidence_allowed: true, requires_explicit_review: false, trust_tier: 3 },
  structured_database: { label_zh: '结构化数据库', relation_evidence_allowed: true, requires_explicit_review: false, trust_tier: 3 },
  expert_note: { label_zh: '专家知识', relation_evidence_allowed: true, requires_explicit_review: true, trust_tier: 2 },
} as const;

export type GovernedSourceType = keyof typeof SOURCE_TYPE_POLICIES;

export function sourceTypeLabelZh(sourceType: unknown): string {
  const key = String(sourceType ?? '').trim() as GovernedSourceType;
  return SOURCE_TYPE_POLICIES[key]?.label_zh ?? (key || '未知来源');
}
