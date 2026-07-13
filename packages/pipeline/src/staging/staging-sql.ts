import type { StagingTableRows } from "./staging-rows.js";

type SqlRow = Record<string, unknown>;

export type SqlStatement = {
  name: string;
  sql: string;
  params: unknown[];
};

export type InsertBatchStatement = SqlStatement & {
  table: string;
  columns: string[];
  rowCount: number;
};

export type StagingSqlPlan = {
  lessonRun: SqlStatement;
  deletes: SqlStatement[];
  inserts: InsertBatchStatement[];
  statements: SqlStatement[];
};

const JSONB_COLUMNS = new Set([
  "aliases_json",
  "counts_json",
  "curriculum_roles_json",
  "domains_json",
  "external_ids_json",
  "knowledge_form_json",
  "learning_mode_json",
  "normalized_claims_json",
  "proposed_path_json",
  "properties_json",
  "sections_json",
  "source_refs_json",
  "tags_json",
]);

const STAGING_TABLES = [
  "world_staging_nodes",
  "world_staging_edges",
  "world_staging_domain_profiles",
  "world_staging_curriculum_projections",
  "world_staging_mentions",
  "world_staging_evidence",
  "world_staging_node_cards",
] as const;

const NODE_COLUMNS = [
  "dataset_id",
  "lesson_run_id",
  "raw_node_id",
  "book_id",
  "batch_anchor",
  "name",
  "kind",
  "subkind",
  "definition",
  "aliases_json",
  "domains_json",
  "knowledge_form_json",
  "learning_mode_json",
  "scope",
  "properties_json",
  "external_ids_json",
  "tags_json",
  "semantic_key",
  "embedding",
  "source_refs_json",
  "status",
  "created_at",
  "updated_at",
  "notes",
] as const;

const EDGE_COLUMNS = [
  "dataset_id",
  "lesson_run_id",
  "raw_edge_id",
  "book_id",
  "batch_anchor",
  "type",
  "from_raw_node_id",
  "to_raw_node_id",
  "directionality",
  "confidence",
  "source_refs_json",
  "properties_json",
  "status",
  "created_at",
  "updated_at",
  "notes",
] as const;

const DOMAIN_PROFILE_COLUMNS = [
  "dataset_id",
  "lesson_run_id",
  "raw_profile_id",
  "raw_node_id",
  "domain",
  "schema_id",
  "schema_version",
  "domain_role",
  "source_refs_json",
  "properties_json",
  "status",
  "created_at",
  "updated_at",
  "notes",
] as const;

const CURRICULUM_PROJECTION_COLUMNS = [
  "dataset_id",
  "lesson_run_id",
  "raw_projection_id",
  "raw_node_id",
  "domain",
  "curriculum_id",
  "school_stage",
  "grade_band",
  "curriculum_roles_json",
  "source_refs_json",
  "properties_json",
  "status",
  "created_at",
  "updated_at",
  "notes",
] as const;

const MENTION_COLUMNS = [
  "dataset_id",
  "lesson_run_id",
  "raw_mention_id",
  "source_type",
  "source_id",
  "anchor_ref",
  "target_type",
  "target_raw_id",
  "role",
  "source_refs_json",
  "confidence",
  "properties_json",
  "created_at",
  "updated_at",
] as const;

const EVIDENCE_COLUMNS = [
  "dataset_id",
  "lesson_run_id",
  "raw_evidence_id",
  "source_type",
  "source_id",
  "anchor_ref",
  "source_path",
  "page_start",
  "page_end",
  "excerpt",
  "locator",
  "modality",
  "extraction_method",
  "normalized_claims_json",
  "properties_json",
  "created_at",
  "updated_at",
] as const;

const NODE_CARD_COLUMNS = [
  "dataset_id",
  "lesson_run_id",
  "raw_card_id",
  "raw_node_id",
  "title",
  "summary",
  "source_refs_json",
  "sections_json",
  "properties_json",
  "status",
  "created_at",
  "updated_at",
] as const;

const LESSON_RUN_COLUMNS = [
  "dataset_id",
  "lesson_run_id",
  "book_id",
  "batch_anchor",
  "status",
  "counts_json",
  "properties_json",
  "created_at",
  "updated_at",
] as const;

export function buildStagingSqlPlan(rows: StagingTableRows): StagingSqlPlan {
  const deletes = STAGING_TABLES.map((table) => buildDeleteStatement(table, rows.lesson_run.dataset_id, rows.lesson_run.lesson_run_id));
  const inserts = [
    buildInsertBatchStatement("insert-world-staging-nodes", "world_staging_nodes", NODE_COLUMNS, rows.nodes),
    buildInsertBatchStatement("insert-world-staging-edges", "world_staging_edges", EDGE_COLUMNS, rows.edges),
    buildInsertBatchStatement("insert-world-staging-domain-profiles", "world_staging_domain_profiles", DOMAIN_PROFILE_COLUMNS, rows.domain_profiles),
    buildInsertBatchStatement(
      "insert-world-staging-curriculum-projections",
      "world_staging_curriculum_projections",
      CURRICULUM_PROJECTION_COLUMNS,
      rows.curriculum_projections,
    ),
    buildInsertBatchStatement("insert-world-staging-mentions", "world_staging_mentions", MENTION_COLUMNS, rows.mentions),
    buildInsertBatchStatement("insert-world-staging-evidence", "world_staging_evidence", EVIDENCE_COLUMNS, rows.evidence),
    buildInsertBatchStatement("insert-world-staging-node-cards", "world_staging_node_cards", NODE_CARD_COLUMNS, rows.node_cards),
  ].filter((statement): statement is InsertBatchStatement => statement !== null);
  const lessonRun = buildLessonRunUpsertStatement(rows.lesson_run);
  return {
    lessonRun,
    deletes,
    inserts,
    statements: [lessonRun, ...deletes, ...inserts],
  };
}

function buildLessonRunUpsertStatement(row: SqlRow): SqlStatement {
  const params = valuesForColumns(row, LESSON_RUN_COLUMNS);
  const placeholders = LESSON_RUN_COLUMNS.map((column, index) => placeholder(index + 1, column)).join(", ");
  return {
    name: "upsert-world-lesson-run",
    sql: [
      `INSERT INTO world_lesson_runs (${LESSON_RUN_COLUMNS.join(", ")})`,
      `VALUES (${placeholders})`,
      "ON CONFLICT (dataset_id, lesson_run_id) DO UPDATE SET",
      "book_id = EXCLUDED.book_id,",
      "batch_anchor = EXCLUDED.batch_anchor,",
      "status = EXCLUDED.status,",
      "counts_json = EXCLUDED.counts_json,",
      "properties_json = EXCLUDED.properties_json,",
      "updated_at = EXCLUDED.updated_at",
    ].join("\n"),
    params,
  };
}

function buildDeleteStatement(table: string, datasetId: string, lessonRunId: string): SqlStatement {
  return {
    name: `delete-${table}`,
    sql: `DELETE FROM ${table} WHERE dataset_id = $1 AND lesson_run_id = $2`,
    params: [datasetId, lessonRunId],
  };
}

function buildInsertBatchStatement(
  name: string,
  table: string,
  columns: readonly string[],
  rows: SqlRow[],
): InsertBatchStatement | null {
  if (rows.length === 0) return null;
  const params: unknown[] = [];
  const valueGroups = rows.map((row) => {
    const placeholders = columns.map((column) => {
      params.push(row[column]);
      return placeholder(params.length, column);
    });
    return `(${placeholders.join(", ")})`;
  });
  return {
    name,
    table,
    columns: [...columns],
    rowCount: rows.length,
    sql: `INSERT INTO ${table} (${columns.join(", ")})\nVALUES ${valueGroups.join(", ")}`,
    params,
  };
}

function valuesForColumns(row: SqlRow, columns: readonly string[]): unknown[] {
  return columns.map((column) => row[column]);
}

function placeholder(index: number, column: string): string {
  const cast = JSONB_COLUMNS.has(column) ? "::jsonb" : "";
  return `$${index}${cast}`;
}
