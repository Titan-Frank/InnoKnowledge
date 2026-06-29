import type { PipelineQualityDashboardResponse, PipelineQualityLessonRow } from '@okm/types';
import type { Sql } from './connection.js';

type Row = Record<string, unknown>;

type LessonRow = {
  lesson_run_id: string;
  book_id: string;
  batch_anchor: string;
  status: string;
  counts_json: unknown;
  properties_json: unknown;
  updated_at: string | null;
};

type StagingNodeRow = {
  lesson_run_id: string;
  raw_node_id: string;
  source_refs_json: unknown;
  status: string | null;
};

type StagingEdgeRow = {
  lesson_run_id: string;
  raw_edge_id: string;
  from_raw_node_id: string;
  to_raw_node_id: string;
  source_refs_json: unknown;
  status: string | null;
};

type StagingEvidenceRow = {
  lesson_run_id: string;
  raw_evidence_id: string;
  modality: string | null;
  properties_json: unknown;
};

type CanonicalNodeRow = {
  id: string;
  status: string | null;
};

type CanonicalEdgeRow = {
  id: string;
  from_id: string;
  to_id: string;
  status: string | null;
  source_refs_json: unknown;
};

type CanonicalEvidenceRow = {
  id: string;
  modality: string | null;
  properties_json: unknown;
};

export async function loadPipelineQualityPayload(
  sql: Sql,
  datasetId: string,
): Promise<PipelineQualityDashboardResponse> {
  const [
    lessonRows,
    stagingNodeRows,
    stagingEdgeRows,
    stagingEvidenceRows,
    reviewRows,
    canonicalNodeRows,
    canonicalEdgeRows,
    canonicalEvidenceRows,
  ] = await Promise.all([
    sql<LessonRow[]>`
      SELECT lesson_run_id, book_id, batch_anchor, status, counts_json, properties_json, updated_at
      FROM world_lesson_runs
      WHERE dataset_id = ${datasetId}
      ORDER BY book_id, batch_anchor, updated_at DESC
      LIMIT 500
    `.catch(() => []),
    sql<StagingNodeRow[]>`
      SELECT lesson_run_id, raw_node_id, source_refs_json, status
      FROM world_staging_nodes
      WHERE dataset_id = ${datasetId}
    `.catch(() => []),
    sql<StagingEdgeRow[]>`
      SELECT lesson_run_id, raw_edge_id, from_raw_node_id, to_raw_node_id, source_refs_json, status
      FROM world_staging_edges
      WHERE dataset_id = ${datasetId}
    `.catch(() => []),
    sql<StagingEvidenceRow[]>`
      SELECT lesson_run_id, raw_evidence_id, modality, properties_json
      FROM world_staging_evidence
      WHERE dataset_id = ${datasetId}
    `.catch(() => []),
    sql<{ lesson_run_id: string }[]>`
      SELECT lesson_run_id
      FROM world_canonical_node_map
      WHERE dataset_id = ${datasetId}
        AND resolution = 'review'
    `.catch(() => []),
    sql<CanonicalNodeRow[]>`
      SELECT id, status
      FROM world_nodes
      WHERE dataset_id = ${datasetId}
    `.catch(() => []),
    sql<CanonicalEdgeRow[]>`
      SELECT id, from_id, to_id, status, source_refs_json
      FROM world_edges
      WHERE dataset_id = ${datasetId}
    `.catch(() => []),
    sql<CanonicalEvidenceRow[]>`
      SELECT id, modality, properties_json
      FROM world_evidence
      WHERE dataset_id = ${datasetId}
    `.catch(() => []),
  ]);

  return buildQualityDashboard({
    datasetId,
    lessonRows,
    stagingNodeRows,
    stagingEdgeRows,
    stagingEvidenceRows,
    reviewRows,
    canonicalNodeRows,
    canonicalEdgeRows,
    canonicalEvidenceRows,
  });
}

function buildQualityDashboard(input: {
  datasetId: string;
  lessonRows: LessonRow[];
  stagingNodeRows: StagingNodeRow[];
  stagingEdgeRows: StagingEdgeRow[];
  stagingEvidenceRows: StagingEvidenceRow[];
  reviewRows: Array<{ lesson_run_id: string }>;
  canonicalNodeRows: CanonicalNodeRow[];
  canonicalEdgeRows: CanonicalEdgeRow[];
  canonicalEvidenceRows: CanonicalEvidenceRow[];
}): PipelineQualityDashboardResponse {
  const nodesByLesson = groupByLesson(input.stagingNodeRows);
  const edgesByLesson = groupByLesson(input.stagingEdgeRows);
  const evidenceByLesson = groupByLesson(input.stagingEvidenceRows);
  const reviewCountByLesson = countBy(input.reviewRows, (row) => row.lesson_run_id);

  let supportedObjects = 0;
  let supportableObjects = 0;

  const lessons: PipelineQualityLessonRow[] = input.lessonRows.map((lesson) => {
    const nodes = activeRows(nodesByLesson.get(lesson.lesson_run_id) ?? []);
    const edges = activeRows(edgesByLesson.get(lesson.lesson_run_id) ?? []);
    const evidence = evidenceByLesson.get(lesson.lesson_run_id) ?? [];
    const evidenceIds = new Set(evidence.map((row) => textValue(row.raw_evidence_id)).filter(Boolean));
    const graph = graphStats(
      nodes.map((row) => row.raw_node_id),
      edges.map((row) => ({ from: row.from_raw_node_id, to: row.to_raw_node_id })),
    );
    const nodeCount = nodes.length || countValue(lesson.counts_json, 'nodes');
    const relationCount = edges.length || countValue(lesson.counts_json, 'edges');
    const denominator = nodes.length + edges.length;
    const covered = [
      ...nodes.map((row) => hasValidEvidenceRef(row.source_refs_json, evidenceIds)),
      ...edges.map((row) => hasValidEvidenceRef(row.source_refs_json, evidenceIds)),
    ].filter(Boolean).length;
    supportedObjects += covered;
    supportableObjects += denominator;

    const imageReviewCount = evidence.filter((row) => isPendingImageReview(row.modality, row.properties_json)).length;
    const mergeReviewCount = reviewCountByLesson.get(lesson.lesson_run_id) ?? 0;
    const blockedItem = lesson.status === 'blocked' ? 1 : 0;

    return {
      lesson_run_id: lesson.lesson_run_id,
      book_id: lesson.book_id,
      batch_anchor: lesson.batch_anchor,
      status: lesson.status,
      node_count: nodeCount,
      relation_count: relationCount,
      evidence_count: evidence.length || countValue(lesson.counts_json, 'evidence'),
      evidence_coverage: denominator > 0 ? covered / denominator : 0,
      isolated_node_count: nodes.length > 0 ? graph.isolatedCount : 0,
      isolated_node_ratio: nodes.length > 0 ? graph.isolatedCount / nodes.length : 0,
      disconnected_components: nodes.length > 0 ? graph.componentCount : 0,
      image_review_count: imageReviewCount,
      merge_review_count: mergeReviewCount,
      manual_pending_items: imageReviewCount + mergeReviewCount + blockedItem,
      quality_issues: qualityIssues(lesson.properties_json),
      updated_at: lesson.updated_at ?? null,
    };
  });

  const canonicalNodes = activeRows(input.canonicalNodeRows);
  const canonicalEdges = activeRows(input.canonicalEdgeRows);
  const canonicalGraph = graphStats(
    canonicalNodes.map((row) => row.id),
    canonicalEdges.map((row) => ({ from: row.from_id, to: row.to_id })),
  );
  const fallbackNodeCount = lessons.reduce((sum, row) => sum + row.node_count, 0);
  const fallbackRelationCount = lessons.reduce((sum, row) => sum + row.relation_count, 0);
  const nodeCount = canonicalNodes.length || fallbackNodeCount;
  const relationCount = canonicalEdges.length || fallbackRelationCount;
  const imageReviewCount = input.canonicalEvidenceRows.filter((row) => isPendingImageReview(row.modality, row.properties_json)).length ||
    lessons.reduce((sum, row) => sum + row.image_review_count, 0);
  const mergeReviewCount = input.reviewRows.length;
  const blockedLessonCount = lessons.filter((row) => row.status === 'blocked').length;

  return {
    dataset_id: input.datasetId,
    generated_at: new Date().toISOString(),
    summary: {
      lesson_count: lessons.length,
      node_count: nodeCount,
      relation_count: relationCount,
      evidence_count: input.canonicalEvidenceRows.length || lessons.reduce((sum, row) => sum + row.evidence_count, 0),
      evidence_coverage: supportableObjects > 0 ? supportedObjects / supportableObjects : 0,
      isolated_node_count: canonicalNodes.length > 0 ? canonicalGraph.isolatedCount : lessons.reduce((sum, row) => sum + row.isolated_node_count, 0),
      isolated_node_ratio: nodeCount > 0
        ? (canonicalNodes.length > 0 ? canonicalGraph.isolatedCount : lessons.reduce((sum, row) => sum + row.isolated_node_count, 0)) / nodeCount
        : 0,
      disconnected_components: canonicalNodes.length > 0 ? canonicalGraph.componentCount : lessons.reduce((sum, row) => sum + row.disconnected_components, 0),
      image_review_count: imageReviewCount,
      merge_review_count: mergeReviewCount,
      blocked_lesson_count: blockedLessonCount,
      manual_pending_items: imageReviewCount + mergeReviewCount + blockedLessonCount,
    },
    lessons,
  };
}

function groupByLesson<T extends { lesson_run_id: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.lesson_run_id;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function countBy<T>(rows: T[], keyFor: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFor(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function activeRows<T extends { status?: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.status !== 'deprecated');
}

function asRecord(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function textValue(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function countValue(value: unknown, key: string): number {
  const parsed = Number(asRecord(value)[key]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function qualityIssues(value: unknown): string[] {
  const issues = asRecord(value).quality_issues;
  return Array.isArray(issues) ? issues.map(String).filter(Boolean) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function hasValidEvidenceRef(value: unknown, evidenceIds: Set<string>): boolean {
  return stringArray(value).some((ref) => evidenceIds.has(ref));
}

function isPendingImageReview(modality: unknown, propertiesValue: unknown): boolean {
  if (textValue(modality).toLowerCase() !== 'image') return false;
  const relevance = asRecord(asRecord(propertiesValue).image_relevance);
  const status = textValue(relevance.review_status);
  const label = textValue(relevance.relevance);
  return status === 'pending' || (!status && label === 'uncertain');
}

function graphStats(nodes: string[], edges: Array<{ from: string; to: string }>): { isolatedCount: number; componentCount: number } {
  const nodeSet = new Set(nodes.map((node) => node.trim()).filter(Boolean));
  const adjacency = new Map<string, Set<string>>();
  const connected = new Set<string>();
  for (const node of nodeSet) adjacency.set(node, new Set());
  for (const edge of edges) {
    const from = edge.from.trim();
    const to = edge.to.trim();
    if (!nodeSet.has(from) || !nodeSet.has(to)) continue;
    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
    connected.add(from);
    connected.add(to);
  }

  let componentCount = 0;
  const visited = new Set<string>();
  for (const start of nodeSet) {
    if (visited.has(start)) continue;
    componentCount += 1;
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      visited.add(node);
      for (const next of adjacency.get(node) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
    }
  }
  return {
    isolatedCount: [...nodeSet].filter((node) => !connected.has(node)).length,
    componentCount,
  };
}
