import {
  applyApprovedInterdisciplinaryCandidates,
  loadInterdisciplinaryGraphFromSql,
  runInterdisciplinaryAnalysisFromDatabase,
  summarizeInterdisciplinaryGraph,
  VALID_EDGE_TYPES,
} from '@okm/pipeline';
import {
  type EdgeType,
  type InterdisciplinaryAnalyzeRequest,
  type InterdisciplinaryAnalyzeResponse,
  type InterdisciplinaryApplyResponse,
  type InterdisciplinaryCandidate,
  type InterdisciplinaryEvidenceSummary,
  type InterdisciplinaryOverviewResponse,
  type InterdisciplinaryReviewRequest,
  type InterdisciplinaryReviewResponse,
  type InterdisciplinaryRun,
} from '@okm/types';
import type { Sql } from './connection.js';

type Row = Record<string, unknown>;
type UnsafeSqlClient = {
  unsafe: (query: string, params?: any[]) => Promise<unknown> | unknown;
};

const EDGE_TYPE_SET = VALID_EDGE_TYPES;

export class InterdisciplinaryRequestError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'InterdisciplinaryRequestError';
  }
}

export async function loadInterdisciplinaryOverview(
  sql: Sql,
  datasetId: string,
): Promise<InterdisciplinaryOverviewResponse> {
  const [graph, candidateRows, runRows, countRows, pendingPairRows] = await Promise.all([
    loadInterdisciplinaryGraphFromSql(sql, datasetId),
    queryRows(sql, [
      'SELECT c.*,',
      '  from_node.name AS from_node_name, from_node.kind AS from_node_kind, from_node.definition AS from_node_definition,',
      '  to_node.name AS to_node_name, to_node.kind AS to_node_kind, to_node.definition AS to_node_definition',
      'FROM world_interdisciplinary_candidates c',
      'JOIN world_nodes from_node ON from_node.dataset_id = c.dataset_id AND from_node.id = c.from_node_id',
      'JOIN world_nodes to_node ON to_node.dataset_id = c.dataset_id AND to_node.id = c.to_node_id',
      'WHERE c.dataset_id = $1',
      "ORDER BY CASE c.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'applied' THEN 2 ELSE 3 END,",
      '  c.confidence DESC, c.updated_at DESC, c.candidate_id',
      'LIMIT 500',
    ].join('\n'), [datasetId]),
    queryRows(sql, [
      'SELECT *',
      'FROM world_interdisciplinary_runs',
      'WHERE dataset_id = $1',
      'ORDER BY created_at DESC, run_id DESC',
      'LIMIT 1',
    ].join('\n'), [datasetId]),
    queryRows(sql, [
      'SELECT',
      "  count(*) FILTER (WHERE status = 'pending' AND candidate_kind = 'node_alignment') AS pending_alignment_count,",
      "  count(*) FILTER (WHERE status = 'pending' AND candidate_kind = 'relation') AS pending_relation_count,",
      "  count(*) FILTER (WHERE status = 'approved') AS approved_candidate_count",
      'FROM world_interdisciplinary_candidates',
      'WHERE dataset_id = $1',
    ].join('\n'), [datasetId]),
    queryRows(sql, [
      'SELECT source_domains_json, target_domains_json',
      'FROM world_interdisciplinary_candidates',
      "WHERE dataset_id = $1 AND status = 'pending'",
    ].join('\n'), [datasetId]),
  ]);

  const graphSummary = summarizeInterdisciplinaryGraph(graph.nodes, graph.edges);
  const candidates = candidateRows.map(mapCandidate);
  const evidenceById = await loadEvidenceById(sql, datasetId, candidates.flatMap((candidate) => candidate.evidence_refs));
  for (const candidate of candidates) {
    candidate.evidence = candidate.evidence_refs.flatMap((id) => evidenceById.get(id) ? [evidenceById.get(id)!] : []);
  }
  const counts = countRows[0] ?? {};
  const pairMap = new Map(
    graphSummary.domain_pairs.map((pair) => [domainPairKey(pair.source_domain, pair.target_domain), {
      ...pair,
      pending_candidate_count: 0,
    }]),
  );

  for (const candidate of pendingPairRows) {
    const seen = new Set<string>();
    for (const sourceDomain of stringArray(candidate.source_domains_json)) {
      for (const targetDomain of stringArray(candidate.target_domains_json)) {
        if (sourceDomain === targetDomain) continue;
        const key = domainPairKey(sourceDomain, targetDomain);
        if (seen.has(key)) continue;
        seen.add(key);
        const [left, right] = key.split('\n');
        const pair = pairMap.get(key) ?? {
          source_domain: left!,
          target_domain: right!,
          shared_node_count: 0,
          cross_domain_edge_count: 0,
          pending_candidate_count: 0,
        };
        pair.pending_candidate_count += 1;
        pairMap.set(key, pair);
      }
    }
  }

  return {
    dataset_id: datasetId,
    generated_at: new Date().toISOString(),
    summary: {
      domain_count: graphSummary.domain_count,
      bridge_node_count: graphSummary.bridge_node_count,
      cross_domain_edge_count: graphSummary.cross_domain_edge_count,
      pending_alignment_count: numberValue(counts.pending_alignment_count),
      pending_relation_count: numberValue(counts.pending_relation_count),
      approved_candidate_count: numberValue(counts.approved_candidate_count),
    },
    domains: graphSummary.domains,
    domain_pairs: [...pairMap.values()].sort((left, right) =>
      right.pending_candidate_count - left.pending_candidate_count
      || right.shared_node_count - left.shared_node_count
      || right.cross_domain_edge_count - left.cross_domain_edge_count
      || left.source_domain.localeCompare(right.source_domain)
      || left.target_domain.localeCompare(right.target_domain)),
    bridge_nodes: graphSummary.bridge_nodes,
    candidates,
    latest_run: runRows[0] ? mapRun(runRows[0]) : null,
  };
}

export async function analyzeInterdisciplinaryGraph(input: {
  dbUrl: string;
  datasetId: string;
  request: InterdisciplinaryAnalyzeRequest;
}): Promise<InterdisciplinaryAnalyzeResponse> {
  const replacePending = optionalBoolean(input.request.replace_pending, 'replace_pending');
  const result = await runInterdisciplinaryAnalysisFromDatabase({
    dbUrl: input.dbUrl,
    datasetId: input.datasetId,
    domains: cleanStrings(input.request.domains),
    minimumAlignmentScore: optionalScore(input.request.minimum_alignment_score, 'minimum_alignment_score'),
    minimumRelationScore: optionalScore(input.request.minimum_relation_score, 'minimum_relation_score'),
    maximumCandidates: optionalPositiveInteger(input.request.maximum_candidates, 'maximum_candidates'),
    replacePending,
  });
  return {
    run: result.run,
    candidates_created: result.candidates_created,
    alignment_candidates: result.alignment_candidates,
    relation_candidates: result.relation_candidates,
  };
}

export async function reviewInterdisciplinaryCandidate(
  sql: Sql,
  datasetId: string,
  candidateId: string,
  request: InterdisciplinaryReviewRequest,
): Promise<InterdisciplinaryReviewResponse> {
  return sql.begin(async (transaction) => {
    const candidateRows = await queryRows(transaction, [
      'SELECT *',
      'FROM world_interdisciplinary_candidates',
      'WHERE dataset_id = $1 AND candidate_id = $2',
      'FOR UPDATE',
    ].join('\n'), [datasetId, candidateId]);
    const candidate = candidateRows[0];
    if (!candidate) throw new InterdisciplinaryRequestError('未找到这个跨学科候选项。', 404);
    if (textValue(candidate.status) !== 'pending') {
      throw new InterdisciplinaryRequestError('只有待审核的候选项可以修改。', 409);
    }

    const selectedEvidenceIds = cleanStrings(request.evidence_ids);
    const existingEvidenceIds = selectedEvidenceIds.length > 0
      ? new Set((await queryRows(transaction, [
          'SELECT id',
          'FROM world_evidence',
          'WHERE dataset_id = $1 AND id = ANY($2::text[])',
          "  AND source_type = 'textbook'",
          "  AND COALESCE(properties_json->>'synthetic', 'false') != 'true'",
          "  AND COALESCE(properties_json->>'quality_excluded', 'false') != 'true'",
          "  AND COALESCE(properties_json->>'review_status', 'approved') NOT IN ('pending', 'rejected')",
        ].join('\n'), [datasetId, selectedEvidenceIds])).map((row) => textValue(row.id)))
      : new Set<string>();
    const review = validateInterdisciplinaryReview({
      candidateKind: textValue(candidate.candidate_kind),
      proposedEdgeType: nullableText(candidate.proposed_edge_type),
      candidateDirection: nullableText(candidate.directionality),
      candidateEvidenceIds: stringArray(candidate.evidence_refs_json),
      existingEvidenceIds,
      request,
    });
    const now = new Date().toISOString();
    const reverseEndpoints = review.reverseEndpoints;
    const reviewedFromNodeId = textValue(reverseEndpoints ? candidate.to_node_id : candidate.from_node_id);
    const reviewedToNodeId = textValue(reverseEndpoints ? candidate.from_node_id : candidate.to_node_id);
    const reviewedSourceDomains = reverseEndpoints ? candidate.target_domains_json : candidate.source_domains_json;
    const reviewedTargetDomains = reverseEndpoints ? candidate.source_domains_json : candidate.target_domains_json;
    const rows = await queryRows(transaction, [
      'UPDATE world_interdisciplinary_candidates',
      'SET status = $1, proposed_edge_type = $2, directionality = $3,',
      '  from_node_id = $4, to_node_id = $5, source_domains_json = $6::jsonb, target_domains_json = $7::jsonb,',
      '  evidence_refs_json = $8::jsonb, reviewer = $9, review_notes = $10, reviewed_at = $11, updated_at = $11',
      'WHERE dataset_id = $12 AND candidate_id = $13 AND status = \'pending\'',
      'RETURNING *',
    ].join('\n'), [
      review.status,
      review.proposedEdgeType,
      review.directionality,
      reviewedFromNodeId,
      reviewedToNodeId,
      reviewedSourceDomains,
      reviewedTargetDomains,
      review.evidenceIds,
      cleanText(request.reviewer) || 'manual',
      cleanText(request.notes) || null,
      now,
      datasetId,
      candidateId,
    ]);
    if (!rows[0]) throw new InterdisciplinaryRequestError('候选项状态已经变化，请刷新后重试。', 409);

    return {
      candidate: await loadCandidateWithNames(transaction, datasetId, candidateId),
    };
  });
}

export async function applyInterdisciplinaryCandidates(input: {
  dbUrl: string;
  datasetId: string;
  limit?: number;
}): Promise<InterdisciplinaryApplyResponse> {
  return applyApprovedInterdisciplinaryCandidates(input) as Promise<InterdisciplinaryApplyResponse>;
}

export function validateInterdisciplinaryReview(input: {
  candidateKind: string;
  proposedEdgeType: string | null;
  candidateDirection: string | null;
  candidateEvidenceIds: string[];
  existingEvidenceIds: Set<string>;
  request: InterdisciplinaryReviewRequest;
}): {
  status: 'approved' | 'rejected';
  proposedEdgeType: EdgeType | null;
  directionality: 'directed' | 'undirected' | null;
  evidenceIds: string[];
  reverseEndpoints: boolean;
} {
  if (input.request.reverse_direction !== undefined && typeof input.request.reverse_direction !== 'boolean') {
    throw new InterdisciplinaryRequestError('reverse_direction 必须是布尔值。');
  }
  if (input.request.decision !== 'approve' && input.request.decision !== 'reject') {
    throw new InterdisciplinaryRequestError('审核决定只能是批准或拒绝。');
  }
  if (input.request.decision === 'reject') {
    return {
      status: 'rejected',
      proposedEdgeType: asEdgeType(input.proposedEdgeType),
      directionality: asDirectionality(input.candidateDirection),
      evidenceIds: input.candidateEvidenceIds,
      reverseEndpoints: false,
    };
  }
  if (input.candidateKind === 'node_alignment') {
    return { status: 'approved', proposedEdgeType: null, directionality: null, evidenceIds: input.candidateEvidenceIds, reverseEndpoints: false };
  }
  if (input.candidateKind !== 'relation') {
    throw new InterdisciplinaryRequestError(`不支持的候选类型：${input.candidateKind || '空'}`);
  }

  const proposedEdgeType = asEdgeType(input.request.relation_type ?? input.proposedEdgeType);
  if (!proposedEdgeType) throw new InterdisciplinaryRequestError('批准关系候选时必须选择关系类型。');
  if (proposedEdgeType === 'same_as') {
    throw new InterdisciplinaryRequestError('同一知识对象必须使用对象对齐候选归并，不能创建 same_as 关系。');
  }
  const directionality = input.request.directionality ?? asDirectionality(input.candidateDirection) ?? 'undirected';
  if (directionality !== 'directed' && directionality !== 'undirected') {
    throw new InterdisciplinaryRequestError('关系方向只能是有向或无向。');
  }
  if (input.request.reverse_direction && directionality !== 'directed') {
    throw new InterdisciplinaryRequestError('只有有向关系可以反转起点和终点。');
  }
  const candidateEvidence = new Set(input.candidateEvidenceIds);
  const evidenceIds = cleanStrings(input.request.evidence_ids);
  if (evidenceIds.length === 0) throw new InterdisciplinaryRequestError('批准关系候选时至少要选择一条教材证据。');
  const unavailable = evidenceIds.filter((id) => !candidateEvidence.has(id) || !input.existingEvidenceIds.has(id));
  if (unavailable.length > 0) {
    throw new InterdisciplinaryRequestError(`所选证据不属于该候选项或已不存在：${unavailable.join('、')}`);
  }
  return {
    status: 'approved',
    proposedEdgeType,
    directionality,
    evidenceIds,
    reverseEndpoints: input.request.reverse_direction === true,
  };
}

async function loadCandidateWithNames(
  sql: UnsafeSqlClient,
  datasetId: string,
  candidateId: string,
): Promise<InterdisciplinaryCandidate> {
  const rows = await queryRows(sql, [
    'SELECT c.*,',
    '  from_node.name AS from_node_name, from_node.kind AS from_node_kind, from_node.definition AS from_node_definition,',
    '  to_node.name AS to_node_name, to_node.kind AS to_node_kind, to_node.definition AS to_node_definition',
    'FROM world_interdisciplinary_candidates c',
    'JOIN world_nodes from_node ON from_node.dataset_id = c.dataset_id AND from_node.id = c.from_node_id',
    'JOIN world_nodes to_node ON to_node.dataset_id = c.dataset_id AND to_node.id = c.to_node_id',
    'WHERE c.dataset_id = $1 AND c.candidate_id = $2',
    'LIMIT 1',
  ].join('\n'), [datasetId, candidateId]);
  if (!rows[0]) throw new InterdisciplinaryRequestError('未找到这个跨学科候选项。', 404);
  const candidate = mapCandidate(rows[0]);
  const evidenceById = await loadEvidenceById(sql, datasetId, candidate.evidence_refs);
  candidate.evidence = candidate.evidence_refs.flatMap((id) => evidenceById.get(id) ? [evidenceById.get(id)!] : []);
  return candidate;
}

async function loadEvidenceById(
  sql: UnsafeSqlClient,
  datasetId: string,
  evidenceIdsInput: string[],
): Promise<Map<string, InterdisciplinaryEvidenceSummary>> {
  const evidenceIds = [...new Set(evidenceIdsInput)].filter(Boolean);
  if (evidenceIds.length === 0) return new Map();
  const rows = await queryRows(sql, [
    'SELECT id, source_id, anchor_ref, left(excerpt, 1200) AS excerpt, locator, modality, page_start, page_end',
    'FROM world_evidence',
    'WHERE dataset_id = $1 AND id = ANY($2::text[])',
    "  AND source_type = 'textbook'",
    "  AND COALESCE(properties_json->>'synthetic', 'false') != 'true'",
    "  AND COALESCE(properties_json->>'quality_excluded', 'false') != 'true'",
    "  AND COALESCE(properties_json->>'review_status', 'approved') NOT IN ('pending', 'rejected')",
    'ORDER BY source_id, anchor_ref, id',
  ].join('\n'), [datasetId, evidenceIds]);
  return new Map(rows.map((row) => {
    const evidence: InterdisciplinaryEvidenceSummary = {
      evidence_id: textValue(row.id),
      source_id: textValue(row.source_id),
      anchor_ref: textValue(row.anchor_ref),
      excerpt: textValue(row.excerpt),
      locator: textValue(row.locator),
      modality: nullableText(row.modality),
      page_start: nullableNumber(row.page_start),
      page_end: nullableNumber(row.page_end),
    };
    return [evidence.evidence_id, evidence];
  }));
}

function mapCandidate(row: Row): InterdisciplinaryCandidate {
  const candidateKind = textValue(row.candidate_kind);
  const status = textValue(row.status);
  if (candidateKind !== 'node_alignment' && candidateKind !== 'relation') {
    throw new Error(`Invalid interdisciplinary candidate kind '${candidateKind}'.`);
  }
  if (status !== 'pending' && status !== 'approved' && status !== 'rejected' && status !== 'applied') {
    throw new Error(`Invalid interdisciplinary candidate status '${status}'.`);
  }
  return {
    candidate_id: textValue(row.candidate_id),
    run_id: textValue(row.run_id),
    candidate_kind: candidateKind,
    from_node_id: textValue(row.from_node_id),
    from_node_name: textValue(row.from_node_name) || textValue(row.from_node_id),
    from_node_kind: asNodeKind(row.from_node_kind),
    from_node_definition: textValue(row.from_node_definition),
    to_node_id: textValue(row.to_node_id),
    to_node_name: textValue(row.to_node_name) || textValue(row.to_node_id),
    to_node_kind: asNodeKind(row.to_node_kind),
    to_node_definition: textValue(row.to_node_definition),
    proposed_edge_type: asEdgeType(nullableText(row.proposed_edge_type)),
    directionality: row.directionality === 'directed' ? 'directed' : row.directionality === 'undirected' ? 'undirected' : null,
    confidence: numberValue(row.confidence),
    source_domains: stringArray(row.source_domains_json),
    target_domains: stringArray(row.target_domains_json),
    evidence_refs: stringArray(row.evidence_refs_json),
    evidence: [],
    rationale: recordValue(row.rationale_json),
    status,
    reviewer: nullableText(row.reviewer),
    review_notes: nullableText(row.review_notes),
    reviewed_at: nullableText(row.reviewed_at),
    applied_edge_id: nullableText(row.applied_edge_id),
    created_at: textValue(row.created_at),
    updated_at: textValue(row.updated_at),
  };
}

function mapRun(row: Row): InterdisciplinaryRun {
  const status = textValue(row.status);
  if (status !== 'in_progress' && status !== 'completed' && status !== 'blocked') {
    throw new Error(`Invalid interdisciplinary run status '${status}'.`);
  }
  return {
    run_id: textValue(row.run_id),
    domains: stringArray(row.domains_json),
    config: recordValue(row.config_json),
    stats: recordValue(row.stats_json),
    status,
    created_at: textValue(row.created_at),
    completed_at: nullableText(row.completed_at),
  };
}

async function queryRows(sql: UnsafeSqlClient, query: string, params: unknown[]): Promise<Row[]> {
  const rows = await sql.unsafe(query, params as any[]);
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

function asEdgeType(value: unknown): EdgeType | null {
  const text = cleanText(value);
  if (!text) return null;
  if (!EDGE_TYPE_SET.has(text)) throw new InterdisciplinaryRequestError(`不支持的关系类型：${text}`);
  return text as EdgeType;
}

function asNodeKind(value: unknown): InterdisciplinaryCandidate['from_node_kind'] {
  const text = cleanText(value);
  if (
    text !== 'entity'
    && text !== 'concept'
    && text !== 'property'
    && text !== 'process'
    && text !== 'event'
    && text !== 'method'
    && text !== 'rule'
    && text !== 'representation'
    && text !== 'resource'
  ) {
    throw new Error(`Invalid interdisciplinary node kind '${text}'.`);
  }
  return text;
}

function asDirectionality(value: unknown): 'directed' | 'undirected' | null {
  const text = cleanText(value);
  if (!text) return null;
  if (text !== 'directed' && text !== 'undirected') {
    throw new InterdisciplinaryRequestError(`不支持的关系方向：${text}`);
  }
  return text;
}

function optionalScore(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new InterdisciplinaryRequestError(`${field} 必须是 0 到 1 之间的数字。`);
  }
  return parsed;
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 5000) {
    throw new InterdisciplinaryRequestError(`${field} 必须是 1 到 5000 之间的整数。`);
  }
  return parsed;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new InterdisciplinaryRequestError(`${field} 必须是布尔值。`);
  return value;
}

function domainPairKey(left: string, right: string): string {
  return left.localeCompare(right) <= 0 ? `${left}\n${right}` : `${right}\n${left}`;
}

function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanText).filter(Boolean))].sort();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(textValue).filter(Boolean) : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nullableText(value: unknown): string | null {
  return cleanText(value) || null;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
