import type { InterdisciplinaryCandidate } from '@okm/types';
import { DOMAIN_LABELS, EDGE_TYPE_LABELS } from './constants';

export function domainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] ?? domain;
}

export function relationTypeLabel(type: string | null): string {
  if (!type) return '待选择';
  return EDGE_TYPE_LABELS[type] ?? type;
}

export function candidateKindLabel(kind: InterdisciplinaryCandidate['candidate_kind']): string {
  return kind === 'node_alignment' ? '同一知识点' : '跨学科关系';
}

export function candidateStatusLabel(status: InterdisciplinaryCandidate['status']): string {
  return {
    pending: '待审核',
    approved: '已批准',
    rejected: '已拒绝',
    applied: '已写入',
  }[status];
}

export function reviewReadiness(
  candidate: InterdisciplinaryCandidate,
  selectedEvidenceIds: string[],
): { ready: boolean; message: string } {
  if (candidate.status !== 'pending') return { ready: false, message: '该候选项已经审核。' };
  if (candidate.candidate_kind === 'node_alignment') {
    return { ready: true, message: '批准后会在正式应用阶段归并为一个知识节点。' };
  }
  if (candidate.evidence.length === 0) {
    return { ready: false, message: '没有可核验的教材证据，不能批准这条关系。' };
  }
  const availableEvidenceIds = new Set(candidate.evidence.map((evidence) => evidence.evidence_id));
  if (!selectedEvidenceIds.some((id) => availableEvidenceIds.has(id))) {
    return { ready: false, message: '请先选择至少一条能够直接支持该关系的教材证据。' };
  }
  return { ready: true, message: '批准后仍需执行“应用已批准项”才会写入正式图谱。' };
}

export function candidateMatchesDomainPair(
  candidate: InterdisciplinaryCandidate,
  sourceDomain: string,
  targetDomain: string,
): boolean {
  return (
    candidate.source_domains.includes(sourceDomain)
    && candidate.target_domains.includes(targetDomain)
  ) || (
    candidate.source_domains.includes(targetDomain)
    && candidate.target_domains.includes(sourceDomain)
  );
}
