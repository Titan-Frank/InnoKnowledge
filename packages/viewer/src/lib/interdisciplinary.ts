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
  if (kind === 'node_alignment') return '同一知识对象';
  if (kind === 'bridge_path') return '桥接路径';
  return '跨学科关系';
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
  bridgePathEvidenceIds: string[][] = [],
): { ready: boolean; message: string } {
  if (candidate.status !== 'pending') return { ready: false, message: '该候选项已经审核。' };
  if (candidate.candidate_kind === 'node_alignment') {
    return { ready: true, message: '批准后会在正式应用阶段归并为一个知识节点。' };
  }
  if (candidate.evidence.length === 0) {
    return { ready: false, message: '没有符合来源策略的可核验证据，不能批准。' };
  }
  const availableEvidenceIds = new Set(candidate.evidence.map((evidence) => evidence.evidence_id));
  if (candidate.candidate_kind === 'bridge_path') {
    if (candidate.proposed_path.length !== 2) return { ready: false, message: '桥接路径不完整，请重新扫描。' };
    const everySegmentSupported = candidate.proposed_path.every((segment, index) => {
      const segmentEvidenceIds = new Set(segment.evidence_refs);
      return (bridgePathEvidenceIds[index] ?? []).some((id) => (
        availableEvidenceIds.has(id) && segmentEvidenceIds.has(id)
      ));
    });
    return everySegmentSupported
      ? { ready: true, message: '两段关系均已有证据；批准后仍需正式应用。' }
      : { ready: false, message: '请为桥接路径的每一段至少选择一条直接证据。' };
  }
  if (!selectedEvidenceIds.some((id) => availableEvidenceIds.has(id))) {
    return { ready: false, message: '请先选择至少一条能够直接支持该关系的证据。' };
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
