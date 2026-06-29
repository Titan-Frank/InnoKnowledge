import type { SqlStatement } from "../staging/staging-sql.js";

type RawRecord = Record<string, unknown>;

export type QualitySqlQueryExecutor = (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];

export type PipelineQualityLessonRow = {
  lesson_run_id: string;
  book_id: string;
  batch_anchor: string;
  status: string;
  node_count: number;
  relation_count: number;
  evidence_count: number;
  evidence_coverage: number;
  isolated_node_count: number;
  isolated_node_ratio: number;
  disconnected_components: number;
  image_review_count: number;
  merge_review_count: number;
  manual_pending_items: number;
  quality_issues: string[];
  updated_at: string | null;
};

export type PipelineQualityDashboardOutput = {
  dataset_id: string;
  generated_at: string;
  read_statements: string[];
  summary: {
    lesson_count: number;
    node_count: number;
    relation_count: number;
    evidence_count: number;
    evidence_coverage: number;
    isolated_node_count: number;
    isolated_node_ratio: number;
    disconnected_components: number;
    image_review_count: number;
    merge_review_count: number;
    blocked_lesson_count: number;
    manual_pending_items: number;
  };
  lessons: PipelineQualityLessonRow[];
};

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
  from_id: string;
  to_id: string;
  status: string | null;
};

type CanonicalEvidenceRow = {
  modality: string | null;
  properties_json: unknown;
};

export async function runQualityDashboardFromDatabase(input: {
  datasetId: string;
  query: QualitySqlQueryExecutor;
  now?: string | null;
}): Promise<PipelineQualityDashboardOutput> {
  const readStatements: string[] = [];
  const query = async (statement: SqlStatement): Promise<RawRecord[]> => {
    readStatements.push(statement.name);
    const rows = await input.query(statement);
    assertRecordRows(statement.name, rows);
    return rows;
  };

  const dashboard = buildQualityDashboard({
    datasetId: input.datasetId,
    generatedAt: input.now || new Date().toISOString(),
    lessonRows: (await query(buildSelectQualityLessonRunsQuery(input.datasetId))).map(toLessonRow),
    stagingNodeRows: (await query(buildSelectQualityStagingNodesQuery(input.datasetId))).map(toStagingNodeRow),
    stagingEdgeRows: (await query(buildSelectQualityStagingEdgesQuery(input.datasetId))).map(toStagingEdgeRow),
    stagingEvidenceRows: (await query(buildSelectQualityStagingEvidenceQuery(input.datasetId))).map(toStagingEvidenceRow),
    reviewRows: (await query(buildSelectQualityReviewItemsQuery(input.datasetId))).map((row) => ({ lesson_run_id: requiredString(row.lesson_run_id, "lesson_run_id") })),
    canonicalNodeRows: (await query(buildSelectQualityCanonicalNodesQuery(input.datasetId))).map(toCanonicalNodeRow),
    canonicalEdgeRows: (await query(buildSelectQualityCanonicalEdgesQuery(input.datasetId))).map(toCanonicalEdgeRow),
    canonicalEvidenceRows: (await query(buildSelectQualityCanonicalEvidenceQuery(input.datasetId))).map(toCanonicalEvidenceRow),
  });

  return {
    ...dashboard,
    read_statements: readStatements,
  };
}

export function buildSelectQualityLessonRunsQuery(datasetId: string): SqlStatement {
  return {
    name: "select-quality-lesson-runs",
    sql: [
      "SELECT lesson_run_id, book_id, batch_anchor, status, counts_json, properties_json, updated_at",
      "FROM world_lesson_runs",
      "WHERE dataset_id = $1",
      "ORDER BY book_id, batch_anchor, updated_at DESC",
      "LIMIT 500",
    ].join("\n"),
    params: [datasetId],
  };
}

export function buildSelectQualityStagingNodesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-quality-staging-nodes",
    sql: "SELECT lesson_run_id, raw_node_id, source_refs_json, status FROM world_staging_nodes WHERE dataset_id = $1",
    params: [datasetId],
  };
}

export function buildSelectQualityStagingEdgesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-quality-staging-edges",
    sql: "SELECT lesson_run_id, from_raw_node_id, to_raw_node_id, source_refs_json, status FROM world_staging_edges WHERE dataset_id = $1",
    params: [datasetId],
  };
}

export function buildSelectQualityStagingEvidenceQuery(datasetId: string): SqlStatement {
  return {
    name: "select-quality-staging-evidence",
    sql: "SELECT lesson_run_id, raw_evidence_id, modality, properties_json FROM world_staging_evidence WHERE dataset_id = $1",
    params: [datasetId],
  };
}

export function buildSelectQualityReviewItemsQuery(datasetId: string): SqlStatement {
  return {
    name: "select-quality-review-items",
    sql: "SELECT lesson_run_id FROM world_canonical_node_map WHERE dataset_id = $1 AND resolution = 'review'",
    params: [datasetId],
  };
}

export function buildSelectQualityCanonicalNodesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-quality-canonical-nodes",
    sql: "SELECT id, status FROM world_nodes WHERE dataset_id = $1",
    params: [datasetId],
  };
}

export function buildSelectQualityCanonicalEdgesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-quality-canonical-edges",
    sql: "SELECT from_id, to_id, status FROM world_edges WHERE dataset_id = $1",
    params: [datasetId],
  };
}

export function buildSelectQualityCanonicalEvidenceQuery(datasetId: string): SqlStatement {
  return {
    name: "select-quality-canonical-evidence",
    sql: "SELECT modality, properties_json FROM world_evidence WHERE dataset_id = $1",
    params: [datasetId],
  };
}

function buildQualityDashboard(input: {
  datasetId: string;
  generatedAt: string;
  lessonRows: LessonRow[];
  stagingNodeRows: StagingNodeRow[];
  stagingEdgeRows: StagingEdgeRow[];
  stagingEvidenceRows: StagingEvidenceRow[];
  reviewRows: Array<{ lesson_run_id: string }>;
  canonicalNodeRows: CanonicalNodeRow[];
  canonicalEdgeRows: CanonicalEdgeRow[];
  canonicalEvidenceRows: CanonicalEvidenceRow[];
}): Omit<PipelineQualityDashboardOutput, "read_statements"> {
  const nodesByLesson = groupByLesson(input.stagingNodeRows);
  const edgesByLesson = groupByLesson(input.stagingEdgeRows);
  const evidenceByLesson = groupByLesson(input.stagingEvidenceRows);
  const reviewCountByLesson = countBy(input.reviewRows, (row) => row.lesson_run_id);
  let supportedObjects = 0;
  let supportableObjects = 0;

  const lessons = input.lessonRows.map((lesson): PipelineQualityLessonRow => {
    const nodes = activeRows(nodesByLesson.get(lesson.lesson_run_id) ?? []);
    const edges = activeRows(edgesByLesson.get(lesson.lesson_run_id) ?? []);
    const evidence = evidenceByLesson.get(lesson.lesson_run_id) ?? [];
    const evidenceIds = new Set(evidence.map((row) => row.raw_evidence_id).filter(Boolean));
    const denominator = nodes.length + edges.length;
    const covered = [
      ...nodes.map((row) => hasValidEvidenceRef(row.source_refs_json, evidenceIds)),
      ...edges.map((row) => hasValidEvidenceRef(row.source_refs_json, evidenceIds)),
    ].filter(Boolean).length;
    supportedObjects += covered;
    supportableObjects += denominator;
    const graph = graphStats(
      nodes.map((row) => row.raw_node_id),
      edges.map((row) => ({ from: row.from_raw_node_id, to: row.to_raw_node_id })),
    );
    const imageReviewCount = evidence.filter((row) => isPendingImageReview(row.modality, row.properties_json)).length;
    const mergeReviewCount = reviewCountByLesson.get(lesson.lesson_run_id) ?? 0;
    const blockedItem = lesson.status === "blocked" ? 1 : 0;
    return {
      lesson_run_id: lesson.lesson_run_id,
      book_id: lesson.book_id,
      batch_anchor: lesson.batch_anchor,
      status: lesson.status,
      node_count: nodes.length || countValue(lesson.counts_json, "nodes"),
      relation_count: edges.length || countValue(lesson.counts_json, "edges"),
      evidence_count: evidence.length || countValue(lesson.counts_json, "evidence"),
      evidence_coverage: denominator > 0 ? covered / denominator : 0,
      isolated_node_count: nodes.length > 0 ? graph.isolatedCount : 0,
      isolated_node_ratio: nodes.length > 0 ? graph.isolatedCount / nodes.length : 0,
      disconnected_components: nodes.length > 0 ? graph.componentCount : 0,
      image_review_count: imageReviewCount,
      merge_review_count: mergeReviewCount,
      manual_pending_items: imageReviewCount + mergeReviewCount + blockedItem,
      quality_issues: qualityIssues(lesson.properties_json),
      updated_at: lesson.updated_at,
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
  const isolatedNodeCount = canonicalNodes.length > 0 ? canonicalGraph.isolatedCount : lessons.reduce((sum, row) => sum + row.isolated_node_count, 0);
  const imageReviewCount = input.canonicalEvidenceRows.filter((row) => isPendingImageReview(row.modality, row.properties_json)).length ||
    lessons.reduce((sum, row) => sum + row.image_review_count, 0);
  const mergeReviewCount = input.reviewRows.length;
  const blockedLessonCount = lessons.filter((row) => row.status === "blocked").length;

  return {
    dataset_id: input.datasetId,
    generated_at: input.generatedAt,
    summary: {
      lesson_count: lessons.length,
      node_count: nodeCount,
      relation_count: relationCount,
      evidence_count: input.canonicalEvidenceRows.length || lessons.reduce((sum, row) => sum + row.evidence_count, 0),
      evidence_coverage: supportableObjects > 0 ? supportedObjects / supportableObjects : 0,
      isolated_node_count: isolatedNodeCount,
      isolated_node_ratio: nodeCount > 0 ? isolatedNodeCount / nodeCount : 0,
      disconnected_components: canonicalNodes.length > 0 ? canonicalGraph.componentCount : lessons.reduce((sum, row) => sum + row.disconnected_components, 0),
      image_review_count: imageReviewCount,
      merge_review_count: mergeReviewCount,
      blocked_lesson_count: blockedLessonCount,
      manual_pending_items: imageReviewCount + mergeReviewCount + blockedLessonCount,
    },
    lessons,
  };
}

function toLessonRow(row: RawRecord): LessonRow {
  return {
    lesson_run_id: requiredString(row.lesson_run_id, "lesson_run_id"),
    book_id: requiredString(row.book_id, "book_id"),
    batch_anchor: requiredString(row.batch_anchor, "batch_anchor"),
    status: requiredString(row.status, "status"),
    counts_json: row.counts_json,
    properties_json: row.properties_json,
    updated_at: optionalString(row.updated_at),
  };
}

function toStagingNodeRow(row: RawRecord): StagingNodeRow {
  return {
    lesson_run_id: requiredString(row.lesson_run_id, "lesson_run_id"),
    raw_node_id: requiredString(row.raw_node_id, "raw_node_id"),
    source_refs_json: row.source_refs_json,
    status: optionalString(row.status),
  };
}

function toStagingEdgeRow(row: RawRecord): StagingEdgeRow {
  return {
    lesson_run_id: requiredString(row.lesson_run_id, "lesson_run_id"),
    from_raw_node_id: requiredString(row.from_raw_node_id, "from_raw_node_id"),
    to_raw_node_id: requiredString(row.to_raw_node_id, "to_raw_node_id"),
    source_refs_json: row.source_refs_json,
    status: optionalString(row.status),
  };
}

function toStagingEvidenceRow(row: RawRecord): StagingEvidenceRow {
  return {
    lesson_run_id: requiredString(row.lesson_run_id, "lesson_run_id"),
    raw_evidence_id: requiredString(row.raw_evidence_id, "raw_evidence_id"),
    modality: optionalString(row.modality),
    properties_json: row.properties_json,
  };
}

function toCanonicalNodeRow(row: RawRecord): CanonicalNodeRow {
  return {
    id: requiredString(row.id, "id"),
    status: optionalString(row.status),
  };
}

function toCanonicalEdgeRow(row: RawRecord): CanonicalEdgeRow {
  return {
    from_id: requiredString(row.from_id, "from_id"),
    to_id: requiredString(row.to_id, "to_id"),
    status: optionalString(row.status),
  };
}

function toCanonicalEvidenceRow(row: RawRecord): CanonicalEvidenceRow {
  return {
    modality: optionalString(row.modality),
    properties_json: row.properties_json,
  };
}

function groupByLesson<T extends { lesson_run_id: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    grouped.set(row.lesson_run_id, [...(grouped.get(row.lesson_run_id) ?? []), row]);
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
  return rows.filter((row) => row.status !== "deprecated");
}

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function hasValidEvidenceRef(value: unknown, evidenceIds: Set<string>): boolean {
  return stringArray(value).some((ref) => evidenceIds.has(ref));
}

function isPendingImageReview(modality: unknown, propertiesValue: unknown): boolean {
  if (optionalString(modality)?.toLowerCase() !== "image") return false;
  const relevance = asRecord(asRecord(propertiesValue).image_relevance);
  const status = optionalString(relevance.review_status) ?? "";
  const label = optionalString(relevance.relevance) ?? "";
  return status === "pending" || (!status && label === "uncertain");
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

function countValue(value: unknown, key: string): number {
  const parsed = Number(asRecord(value)[key]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function qualityIssues(value: unknown): string[] {
  const issues = asRecord(value).quality_issues;
  return Array.isArray(issues) ? issues.map(String).filter(Boolean) : [];
}

function requiredString(value: unknown, name: string): string {
  const parsed = optionalString(value);
  if (!parsed) throw new Error(`Expected non-empty string field '${name}'.`);
  return parsed;
}

function optionalString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed || null;
}

function assertRecordRows(name: string, rows: unknown): asserts rows is RawRecord[] {
  if (!Array.isArray(rows) || !rows.every(isRecord)) {
    throw new Error(`Query '${name}' returned non-record rows.`);
  }
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
