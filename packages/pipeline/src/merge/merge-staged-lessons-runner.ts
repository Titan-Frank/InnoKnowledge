import type { StagedLessonsMergePlan } from "./merge-staged-lesson.js";
import { planStagedLessonsMerge } from "./merge-staged-lesson.js";
import {
  buildFetchStagedRowsQuery,
  buildLoadCanonicalNodesQuery,
  buildLoadExistingDomainProfilesQuery,
  buildLoadExistingEvidenceIdsQuery,
  buildLoadMergeLessonRunsQuery,
  type MergeStagingTable,
} from "./merge-staged-lessons-query.js";
import { buildMergeRowsPlanInput, evidenceIdsFromRows, indexRowsByStringKey, type MergeFetchedStagingRows } from "./merge-staged-lessons-rows.js";
import { buildMergeStagedLessonsSqlPlan } from "./merge-staged-lessons-sql.js";
import { planNodeTerms, type NodeTermRow, type NodeTermsPlan } from "../shared/node-terms.js";
import type { SqlStatement } from "../staging/staging-sql.js";

type RawRecord = Record<string, unknown>;

export type MergeSqlExecutor = (statement: SqlStatement) => Promise<void> | void;
export type MergeSqlQueryExecutor = (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];

export type StoreMergedLessonsResult = {
  status: "success";
  merge_run_id: string | null;
  merged: number;
  stats: StagedLessonsMergePlan["stats"];
  executedStatements: string[];
};

export type RunMergeStagedLessonsFromDatabaseInput = {
  datasetId: string;
  bookId?: string | null;
  lessonRunIds?: string[];
  batchAnchors?: string[];
  mergeRunId?: string | null;
  similarityThreshold?: number;
  embeddingThreshold?: number;
  reviewThreshold?: number;
  now?: string | null;
  query: MergeSqlQueryExecutor;
  executeStatement: MergeSqlExecutor;
};

export type RunMergeStagedLessonsFromDatabaseOutput = StagedLessonsMergePlan & {
  dataset_id: string;
  read_statements: string[];
  statements: string[];
  node_terms: NodeTermsPlan;
  executedStatements: string[];
};

const STAGING_TABLES: MergeStagingTable[] = [
  "world_staging_nodes",
  "world_staging_edges",
  "world_staging_domain_profiles",
  "world_staging_mentions",
  "world_staging_evidence",
  "world_staging_node_cards",
];

const STAGED_KEY_BY_TABLE: Record<MergeStagingTable, keyof MergeFetchedStagingRows> = {
  world_staging_nodes: "nodes",
  world_staging_edges: "edges",
  world_staging_domain_profiles: "domain_profiles",
  world_staging_mentions: "mentions",
  world_staging_evidence: "evidence",
  world_staging_node_cards: "node_cards",
};

export async function storeMergedLessons(
  plan: StagedLessonsMergePlan,
  options: {
    datasetId: string;
    now: string;
    nodeTermRows?: NodeTermRow[];
    execute: MergeSqlExecutor;
  },
): Promise<StoreMergedLessonsResult> {
  const sqlPlan = buildMergeStagedLessonsSqlPlan(plan, {
    datasetId: options.datasetId,
    now: options.now,
    nodeTermRows: options.nodeTermRows,
  });
  const executedStatements: string[] = [];
  for (const statement of sqlPlan.statements) {
    await options.execute(statement);
    executedStatements.push(statement.name);
  }
  return {
    status: "success",
    merge_run_id: plan.merge_run_id,
    merged: plan.merged,
    stats: plan.stats,
    executedStatements,
  };
}

export async function runMergeStagedLessonsFromDatabase(input: RunMergeStagedLessonsFromDatabaseInput): Promise<RunMergeStagedLessonsFromDatabaseOutput> {
  const now = input.now || new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const readStatements: string[] = [];
  const query = async (statement: SqlStatement): Promise<RawRecord[]> => {
    readStatements.push(statement.name);
    const rows = await input.query(statement);
    if (!Array.isArray(rows) || !rows.every(isRecord)) {
      throw new Error(`Query '${statement.name}' must return an array of objects.`);
    }
    return rows;
  };

  const lessonRuns = await query(
    buildLoadMergeLessonRunsQuery({
      datasetId: input.datasetId,
      bookId: input.bookId,
      lessonRunIds: input.lessonRunIds,
      batchAnchors: input.batchAnchors,
    }),
  );
  const canonicalNodeRows = await query(buildLoadCanonicalNodesQuery(input.datasetId));
  const existingDomainProfileRows = await query(buildLoadExistingDomainProfilesQuery(input.datasetId));
  const existingEvidenceIdRows = await query(buildLoadExistingEvidenceIdsQuery(input.datasetId));

  const staged: MergeFetchedStagingRows = {};
  for (const lessonRun of lessonRuns) {
    const lessonRunId = requiredString(lessonRun.lesson_run_id, "lesson_run_id");
    for (const table of STAGING_TABLES) {
      const key = STAGED_KEY_BY_TABLE[table];
      staged[key] = [...(staged[key] ?? []), ...(await query(buildFetchStagedRowsQuery(table, input.datasetId, lessonRunId)))];
    }
  }

  const planInput = buildMergeRowsPlanInput({
    lessonRuns,
    canonicalNodeRows,
    staged,
  });
  const plan = planStagedLessonsMerge({
    datasetId: input.datasetId,
    mergeRunId: input.mergeRunId ?? undefined,
    lessons: planInput.lessons,
    canonicalNodes: planInput.canonicalNodes,
    existingDomainProfilesById: indexRowsByStringKey(existingDomainProfileRows),
    existingEvidenceIds: evidenceIdsFromRows(existingEvidenceIdRows),
    similarityThreshold: input.similarityThreshold,
    embeddingThreshold: input.embeddingThreshold,
    reviewThreshold: input.reviewThreshold,
    now,
  });
  const nodeTerms = planNodeTerms(input.datasetId, buildNodeTermSourceRows(canonicalNodeRows, plan));
  const sqlPlan = buildMergeStagedLessonsSqlPlan(plan, {
    datasetId: input.datasetId,
    now,
    nodeTermRows: nodeTerms.rows,
  });
  const executed = await storeMergedLessons(plan, {
    datasetId: input.datasetId,
    now,
    nodeTermRows: nodeTerms.rows,
    execute: input.executeStatement,
  });

  return {
    ...plan,
    dataset_id: input.datasetId,
    read_statements: readStatements,
    statements: sqlPlan.statements.map((statement) => statement.name),
    node_terms: nodeTerms,
    executedStatements: executed.executedStatements,
  };
}

function buildNodeTermSourceRows(canonicalNodeRows: RawRecord[], plan: StagedLessonsMergePlan): RawRecord[] {
  const rowsById = new Map<string, RawRecord>();
  for (const row of canonicalNodeRows) {
    const id = stringValue(row.id);
    if (id) rowsById.set(id, row);
  }
  for (const lesson of plan.lessons) {
    for (const node of lesson.nodes) {
      const id = stringValue(node.node_payload.id);
      if (!id) continue;
      rowsById.set(id, nodeTermRowFromNodePayload(node.node_payload));
    }
  }
  return [...rowsById.values()];
}

function nodeTermRowFromNodePayload(payload: RawRecord): RawRecord {
  return {
    id: payload.id,
    name: payload.name,
    aliases_json: Array.isArray(payload.aliases) ? payload.aliases : [],
    tags_json: Array.isArray(payload.tags) ? payload.tags : [],
    status: payload.status,
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required field '${name}'.`);
  return value;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
