import { basename, resolve } from "node:path";

import { makeLessonRunId, resolveOutlineAnchor } from "../shared/pathing.js";
import { checkStagingIntegrity } from "./staging-integrity.js";
import { checkLessonStagingQuality, type LessonStagingQualityResult } from "./staging-quality.js";
import { buildStagingTableRows, type StagingTableRows } from "./staging-rows.js";
import { buildStagingSqlPlan, type SqlStatement } from "./staging-sql.js";
import { normalizeLessonArtifacts } from "./staging.js";

type RawRecord = Record<string, unknown>;

export type SqlExecutor = (statement: SqlStatement) => Promise<void> | void;

const BEGIN_STAGING_TRANSACTION: SqlStatement = {
  name: "begin-staging-transaction",
  sql: "BEGIN",
  params: [],
};

const COMMIT_STAGING_TRANSACTION: SqlStatement = {
  name: "commit-staging-transaction",
  sql: "COMMIT",
  params: [],
};

const ROLLBACK_STAGING_TRANSACTION: SqlStatement = {
  name: "rollback-staging-transaction",
  sql: "ROLLBACK",
  params: [],
};

export type StoreStagingResult = {
  status: "success" | "blocked";
  lesson_run_id: string;
  counts: StagingTableRows["lesson_run"]["counts_json"];
  issues: string[];
  executedStatements: string[];
};

export async function storeStagingRows(rows: StagingTableRows, execute: SqlExecutor): Promise<StoreStagingResult> {
  const integrity = checkStagingIntegrity(rows);
  if (!integrity.valid) {
    return {
      status: "blocked",
      lesson_run_id: rows.lesson_run.lesson_run_id,
      counts: rows.lesson_run.counts_json,
      issues: integrity.issues,
      executedStatements: [],
    };
  }

  const plan = buildStagingSqlPlan(rows);
  const executedStatements = await executeStatementsInTransaction(plan.statements, execute);

  return {
    status: "success",
    lesson_run_id: rows.lesson_run.lesson_run_id,
    counts: rows.lesson_run.counts_json,
    issues: [],
    executedStatements,
  };
}

export type StoreStagingInput = {
  root: string;
  bookId: string;
  batchAnchor: string;
  lessonDisposition?: string;
  noKnowledgeReason?: string;
  lessonRunId?: string;
  datasetId?: string;
  nodesJson: string;
  edgesJson: string;
  domainProfilesJson: string;
  mentionsJson: string;
  evidenceJson: string;
  nodeCardsJson: string;
  now?: string;
  resolveOutline?: boolean;
  skipIntegrityCheck?: boolean;
  executeStatement: SqlExecutor;
};

export type StoreStagingOutput = {
  status: "success" | "blocked";
  dataset_id: string;
  lesson_run_id: string;
  counts: {
    nodes: number;
    edges: number;
    domain_profiles: number;
    mentions: number;
    evidence: number;
    node_cards: number;
  };
  issues: string[];
  quality: LessonStagingQualityResult;
  statements: string[];
};

export async function runStoreStaging(input: StoreStagingInput): Promise<StoreStagingOutput> {
  const root = resolve(input.root);
  const datasetId = input.datasetId || basename(root);
  const batchAnchor = input.resolveOutline === false ? input.batchAnchor : resolveOutlineAnchor(input.bookId, input.batchAnchor, { strict: true });
  const lessonRunId = input.lessonRunId || makeLessonRunId(input.bookId, batchAnchor);
  const now = input.now || new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const lessonDisposition = parseLessonDisposition(input.lessonDisposition);

  const artifacts = normalizeLessonArtifacts(
    {
      nodes: parseRecordArray(input.nodesJson, "nodes-json"),
      edges: parseRecordArray(input.edgesJson, "edges-json"),
      domainProfiles: parseRecordArray(input.domainProfilesJson, "domain-profiles-json"),
      mentions: parseRecordArray(input.mentionsJson, "mentions-json"),
      evidence: parseRecordArray(input.evidenceJson, "evidence-json"),
      nodeCards: parseRecordArray(input.nodeCardsJson, "node-cards-json"),
    },
    input.bookId,
    batchAnchor,
  );

  const rows = buildStagingTableRows(
    {
      datasetId,
      lessonRunId,
      bookId: input.bookId,
      batchAnchor,
      now,
      lessonDisposition,
      noKnowledgeReason: input.noKnowledgeReason?.trim() ?? "",
    },
    artifacts,
  );
  const quality = checkLessonStagingQuality(rows);

  if (input.skipIntegrityCheck) {
    const plan = buildStagingSqlPlan(rows);
    const executedStatements = await executeStatementsInTransaction(plan.statements, input.executeStatement);
    return {
      status: "success",
      dataset_id: datasetId,
      lesson_run_id: lessonRunId,
      counts: rows.lesson_run.counts_json,
      issues: [],
      quality,
      statements: executedStatements,
    };
  }

  const result = await storeStagingRows(rows, input.executeStatement);
  return {
    status: result.status,
    dataset_id: datasetId,
    lesson_run_id: lessonRunId,
    counts: result.counts,
    issues: result.issues,
    quality,
    statements: result.executedStatements,
  };
}

function parseLessonDisposition(value: string | undefined): "extracted" | "no_knowledge" {
  const disposition = value?.trim() || "extracted";
  if (disposition === "extracted" || disposition === "no_knowledge") return disposition;
  throw new Error(`Invalid --lesson-disposition '${value}'. Expected extracted or no_knowledge.`);
}

async function executeStatementsInTransaction(statements: SqlStatement[], execute: SqlExecutor): Promise<string[]> {
  const executedStatements: string[] = [];
  await execute(BEGIN_STAGING_TRANSACTION);
  try {
    for (const statement of statements) {
      await execute(statement);
      executedStatements.push(statement.name);
    }
    await execute(COMMIT_STAGING_TRANSACTION);
  } catch (error) {
    try {
      await execute(ROLLBACK_STAGING_TRANSACTION);
    } catch (rollbackError) {
      throw new Error(
        `Staging transaction failed: ${(error as Error).message}; rollback also failed: ${(rollbackError as Error).message}`,
        { cause: error },
      );
    }
    throw error;
  }
  return executedStatements;
}

function parseRecordArray(value: string, name: string): RawRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid ${name}: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed) || !parsed.every(isRecord)) {
    throw new Error(`Invalid ${name}: expected a JSON array of objects.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
