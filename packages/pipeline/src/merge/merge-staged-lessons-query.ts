import type { SqlStatement } from "../staging/staging-sql.js";

export type MergeStagingTable =
  | "world_staging_nodes"
  | "world_staging_edges"
  | "world_staging_domain_profiles"
  | "world_staging_mentions"
  | "world_staging_evidence"
  | "world_staging_node_cards";

export type MergeExistingTable = "world_domain_profiles" | "world_edges" | "world_mentions" | "world_node_cards" | "world_nodes";

export function buildLoadMergeLessonRunsQuery(input: {
  datasetId: string;
  bookId?: string | null;
  lessonRunIds?: string[];
  batchAnchors?: string[];
}): SqlStatement {
  const clauses = ["dataset_id = $1", "status IN ('staged', 'merging')"];
  const params: unknown[] = [input.datasetId];
  if (input.bookId) {
    params.push(input.bookId);
    clauses.push(`book_id = $${params.length}`);
  }
  if (input.lessonRunIds && input.lessonRunIds.length > 0) {
    params.push(input.lessonRunIds);
    clauses.push(`lesson_run_id = ANY($${params.length})`);
  }
  if (input.batchAnchors && input.batchAnchors.length > 0) {
    params.push(input.batchAnchors);
    clauses.push(`batch_anchor = ANY($${params.length})`);
  }
  return {
    name: "select-merge-lesson-runs",
    sql: `SELECT * FROM world_lesson_runs WHERE ${clauses.join(" AND ")} ORDER BY created_at, lesson_run_id`,
    params,
  };
}

export function buildLoadCanonicalNodesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-merge-canonical-nodes",
    sql: ["SELECT *", "FROM world_nodes", "WHERE dataset_id = $1 AND status != 'deprecated'", "ORDER BY id"].join("\n"),
    params: [datasetId],
  };
}

export function buildLoadExistingDomainProfilesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-existing-world-domain-profiles",
    sql: ["SELECT *", "FROM world_domain_profiles", "WHERE dataset_id = $1", "ORDER BY id"].join("\n"),
    params: [datasetId],
  };
}

export function buildLoadExistingEvidenceIdsQuery(datasetId: string): SqlStatement {
  return {
    name: "select-existing-world-evidence-ids",
    sql: ["SELECT id", "FROM world_evidence", "WHERE dataset_id = $1", "ORDER BY id"].join("\n"),
    params: [datasetId],
  };
}

export function buildFetchStagedRowsQuery(table: MergeStagingTable, datasetId: string, lessonRunId: string): SqlStatement {
  return {
    name: `select-${table}`,
    sql: `SELECT * FROM ${table} WHERE dataset_id = $1 AND lesson_run_id = $2 ORDER BY created_at`,
    params: [datasetId, lessonRunId],
  };
}

export function buildLoadExistingByIdQuery(input: {
  table: MergeExistingTable;
  datasetId: string;
  itemId: string;
  key?: "id" | "node_id";
}): SqlStatement {
  const key = input.key ?? "id";
  return {
    name: `select-existing-${input.table}`,
    sql: `SELECT * FROM ${input.table} WHERE dataset_id = $1 AND ${key} = $2`,
    params: [input.datasetId, input.itemId],
  };
}

export function buildFilterExistingEvidenceIdsQuery(datasetId: string, evidenceIds: string[]): SqlStatement | null {
  if (evidenceIds.length === 0) return null;
  return {
    name: "select-existing-evidence-ids",
    sql: ["SELECT id", "FROM world_evidence", "WHERE dataset_id = $1 AND id = ANY($2)"].join("\n"),
    params: [datasetId, evidenceIds],
  };
}
