import type { ApiUnit, ApiUnitCompleteness, ApiUnitCompletenessSignal } from '@okm/types';

type ApiUnitForScoring = Omit<ApiUnit, 'completeness'> | ApiUnit;

type SignalInput = {
  key: string;
  label: string;
  passed: boolean;
  severity: ApiUnitCompletenessSignal['severity'];
  passedMessage: string;
  failedMessage: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => hasText(item) || Object.keys(asRecord(item)).length > 0);
}

function hasSemanticCore(unit: ApiUnitForScoring): boolean {
  const semanticCore = asRecord(unit.node.properties?.semantic_core);
  return [
    semanticCore.core_claims,
    semanticCore.formal_expressions,
    semanticCore.conditions,
    semanticCore.boundaries,
    semanticCore.counterexamples,
    semanticCore.misconceptions,
  ].some(hasNonEmptyArray);
}

function hasRelations(unit: ApiUnitForScoring): boolean {
  return unit.relations.outgoing.length + unit.relations.incoming.length > 0;
}

function hasDomainContext(unit: ApiUnitForScoring): boolean {
  return unit.domain_profiles.some((profile) => (
    hasText(profile.domain) ||
    hasNonEmptyArray(profile.school_stages) ||
    hasNonEmptyArray(profile.curriculum_roles)
  ));
}

function hasBodySourceRefs(unit: ApiUnitForScoring): boolean {
  return Boolean(unit.body && hasText(unit.body.content) && hasNonEmptyArray(unit.body.source_refs));
}

function hasStructuredCard(unit: ApiUnitForScoring): boolean {
  return Boolean(
    unit.card &&
    (hasText(unit.card.summary) || hasNonEmptyArray(unit.card.sections)),
  );
}

function signal(input: SignalInput): ApiUnitCompletenessSignal {
  return {
    key: input.key,
    label: input.label,
    passed: input.passed,
    severity: input.severity,
    message: input.passed ? input.passedMessage : input.failedMessage,
  };
}

export function buildApiUnitCompleteness(unit: ApiUnitForScoring): ApiUnitCompleteness {
  const signals = [
    signal({
      key: 'node_definition',
      label: '节点定义',
      passed: hasText(unit.node.definition),
      severity: 'required',
      passedMessage: '节点有可读定义。',
      failedMessage: '节点缺少定义。',
    }),
    signal({
      key: 'semantic_core',
      label: '语义核心',
      passed: hasSemanticCore(unit),
      severity: 'recommended',
      passedMessage: '节点包含 semantic_core 语义骨架。',
      failedMessage: '节点缺少 semantic_core 语义骨架。',
    }),
    signal({
      key: 'relations',
      label: '对象关系',
      passed: hasRelations(unit),
      severity: 'recommended',
      passedMessage: '节点已有入边或出边。',
      failedMessage: '节点暂时没有入边或出边。',
    }),
    signal({
      key: 'evidence',
      label: '证据',
      passed: unit.evidence.length > 0,
      severity: 'required',
      passedMessage: '节点有证据支撑。',
      failedMessage: '节点缺少证据。',
    }),
    signal({
      key: 'source_fragments',
      label: '原文片段',
      passed: unit.source_fragments.length > 0,
      severity: 'recommended',
      passedMessage: '节点能追溯到原文片段。',
      failedMessage: '节点缺少可展示的原文片段。',
    }),
    signal({
      key: 'domain_profiles',
      label: '领域画像',
      passed: hasDomainContext(unit),
      severity: 'required',
      passedMessage: '节点有领域、学段或课程角色信息。',
      failedMessage: '节点缺少领域、学段或课程角色信息。',
    }),
    signal({
      key: 'body_source_refs',
      label: '正文引用',
      passed: hasBodySourceRefs(unit),
      severity: 'recommended',
      passedMessage: '知识正文包含 source_refs。',
      failedMessage: '知识正文缺失，或正文没有 source_refs。',
    }),
    signal({
      key: 'card_summary',
      label: '结构化卡片',
      passed: hasStructuredCard(unit),
      severity: 'recommended',
      passedMessage: '节点有结构化摘要或卡片分节。',
      failedMessage: '节点缺少结构化摘要或卡片分节。',
    }),
    signal({
      key: 'mentions',
      label: '来源提及',
      passed: unit.mentions.length > 0,
      severity: 'required',
      passedMessage: '节点有来源提及记录。',
      failedMessage: '节点缺少来源提及记录。',
    }),
  ];

  const passed = signals.filter((item) => item.passed).length;
  return {
    score: signals.length === 0 ? 0 : Math.round((passed / signals.length) * 100),
    passed,
    total: signals.length,
    signals,
  };
}
