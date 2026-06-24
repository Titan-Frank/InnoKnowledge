import type { RetrievalCandidateInsertRow } from "./retrieve-candidates.js";
import type { InsertBatchStatement, SqlStatement } from "../staging/staging-sql.js";

type SqlRow = Record<string, unknown>;

export type RetrievalCandidatesSqlPlan = {
  deleteExisting: SqlStatement | null;
  insert: InsertBatchStatement | null;
  statements: SqlStatement[];
};

const RETRIEVAL_CANDIDATE_COLUMNS = [
  "dataset_id",
  "batch_anchor",
  "query_id",
  "query_text",
  "candidate_node_id",
  "rank",
  "score",
  "retrieval_method",
  "filters_json",
  "created_at",
] as const;

export function buildRetrievalCandidatesSqlPlan(options: {
  rows: RetrievalCandidateInsertRow[];
  replace?: boolean;
  datasetId?: string;
  queryId?: string;
}): RetrievalCandidatesSqlPlan {
  const deleteExisting = options.replace ? buildDeleteStatement(options) : null;
  const insert = buildInsertStatement(options.rows);
  return {
    deleteExisting,
    insert,
    statements: [deleteExisting, insert].filter((statement): statement is SqlStatement => statement !== null),
  };
}

function buildDeleteStatement(options: { rows: RetrievalCandidateInsertRow[]; datasetId?: string; queryId?: string }): SqlStatement {
  const firstRow = options.rows[0];
  const datasetId = options.datasetId ?? firstRow?.dataset_id;
  const queryId = options.queryId ?? firstRow?.query_id;
  if (!datasetId || !queryId) {
    throw new Error("Cannot build retrieval candidate delete statement without datasetId and queryId.");
  }
  return {
    name: "delete-retrieval-candidates",
    sql: "DELETE FROM retrieval_candidates WHERE dataset_id = $1 AND query_id = $2",
    params: [datasetId, queryId],
  };
}

function buildInsertStatement(rows: RetrievalCandidateInsertRow[]): InsertBatchStatement | null {
  if (rows.length === 0) return null;
  const params: unknown[] = [];
  const valueGroups = rows.map((row) => {
    const sqlRow = row as unknown as SqlRow;
    const placeholders = RETRIEVAL_CANDIDATE_COLUMNS.map((column) => {
      params.push(sqlRow[column]);
      return column === "filters_json" ? `$${params.length}::jsonb` : `$${params.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  return {
    name: "upsert-retrieval-candidates",
    table: "retrieval_candidates",
    columns: [...RETRIEVAL_CANDIDATE_COLUMNS],
    rowCount: rows.length,
    sql: [
      `INSERT INTO retrieval_candidates (${RETRIEVAL_CANDIDATE_COLUMNS.join(", ")})`,
      `VALUES ${valueGroups.join(", ")}`,
      "ON CONFLICT (dataset_id, query_id, candidate_node_id) DO UPDATE SET",
      "rank = EXCLUDED.rank,",
      "score = EXCLUDED.score,",
      "retrieval_method = EXCLUDED.retrieval_method,",
      "filters_json = EXCLUDED.filters_json,",
      "created_at = EXCLUDED.created_at",
    ].join("\n"),
    params,
  };
}
