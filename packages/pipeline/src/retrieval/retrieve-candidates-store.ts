import { embedTextsOpenAICompatible } from "../shared/embeddings.js";
import { makeQueryId } from "../shared/knowledge.js";
import type { SqlStatement } from "../staging/staging-sql.js";
import {
  buildRetrievalFilters,
  mergeCandidates,
  planRetrievalCandidateInsertRows,
  type RetrievalCandidate,
  type RetrievalMode,
  type RetrievalPayload,
  type RetrievalQuery,
} from "./retrieve-candidates.js";
import { buildLocalCandidatesQuery, buildVectorCandidatesQuery, mapLocalCandidateRows, mapVectorCandidateRows } from "./retrieve-candidates-query.js";
import { buildRetrievalCandidatesSqlPlan } from "./retrieve-candidates-sql.js";

type RawRecord = Record<string, unknown>;

export type RetrieveCandidatesQueryExecutor = (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];
export type RetrieveCandidatesExecutor = (statement: SqlStatement) => Promise<void> | void;
export type RetrieveCandidateEmbedder = (queryText: string) => Promise<number[]> | number[];

export type RetrieveCandidatesDatabaseOutput = {
  status: "success";
  dataset_id: string;
  payloads: RetrievalPayload[];
  read_statements: string[];
  statements: string[];
  executedStatements: string[];
};

export async function runRetrieveCandidatesFromDatabase(input: {
  datasetId: string;
  batchAnchor: string;
  queries: RetrievalQuery[];
  mode?: RetrievalMode;
  domain?: string | null;
  schoolStage?: string | null;
  nodeKind?: string | null;
  limit?: number;
  vectorMinSimilarity?: number;
  replace?: boolean;
  now?: string;
  query: RetrieveCandidatesQueryExecutor;
  executeStatement: RetrieveCandidatesExecutor;
  embedQuery?: RetrieveCandidateEmbedder;
}): Promise<RetrieveCandidatesDatabaseOutput> {
  if (input.queries.length === 0) throw new Error("Provide at least one query or --queries-file.");
  if (!input.batchAnchor.trim()) throw new Error("Writing retrieval candidates requires --batch-anchor.");
  const mode = input.mode ?? "hybrid";
  const limit = input.limit ?? 8;
  const readStatements: string[] = [];
  const statements: string[] = [];
  const executedStatements: string[] = [];
  const query = async (statement: SqlStatement): Promise<RawRecord[]> => {
    readStatements.push(statement.name);
    const rows = await input.query(statement);
    assertRecordRows(statement.name, rows);
    return rows;
  };

  const payloads: RetrievalPayload[] = [];
  for (const rawQuery of input.queries) {
    const queryText = rawQuery.query_text.trim();
    if (!queryText) continue;
    const queryId = rawQuery.query_id?.trim() || makeQueryId(input.batchAnchor || "adhoc", queryText);
    const local = mode === "vector" ? [] : await loadLocalCandidates(input, query, queryText, limit);
    const vector = mode === "local" ? [] : await loadVectorCandidates(input, query, queryText, limit);
    const candidates = selectCandidatesForMode({ local, vector, mode, limit });
    const payload = {
      dataset_id: input.datasetId,
      batch_anchor: input.batchAnchor,
      query_id: queryId,
      query_text: queryText,
      candidates,
    };
    payloads.push(payload);

    const filters = buildRetrievalFilters({ mode, domain: input.domain, schoolStage: input.schoolStage, nodeKind: input.nodeKind });
    const rows = planRetrievalCandidateInsertRows(payload, filters, input.now ?? defaultNow());
    const plan = buildRetrievalCandidatesSqlPlan({
      rows,
      replace: input.replace,
      datasetId: input.datasetId,
      queryId,
    });
    for (const statement of plan.statements) {
      statements.push(statement.name);
      await input.executeStatement(statement);
      executedStatements.push(statement.name);
    }
  }

  return {
    status: "success",
    dataset_id: input.datasetId,
    payloads,
    read_statements: readStatements,
    statements,
    executedStatements,
  };
}

async function loadLocalCandidates(
  input: {
    datasetId: string;
    domain?: string | null;
    schoolStage?: string | null;
    nodeKind?: string | null;
  },
  query: (statement: SqlStatement) => Promise<RawRecord[]>,
  queryText: string,
  limit: number,
): Promise<RetrievalCandidate[]> {
  const rows = await query(
    buildLocalCandidatesQuery({
      datasetId: input.datasetId,
      queryText,
      domain: input.domain,
      schoolStage: input.schoolStage,
      nodeKind: input.nodeKind,
      limit,
    }),
  );
  return mapLocalCandidateRows(rows.map(toLocalCandidateRow));
}

async function loadVectorCandidates(
  input: {
    datasetId: string;
    nodeKind?: string | null;
    vectorMinSimilarity?: number;
    embedQuery?: RetrieveCandidateEmbedder;
  },
  query: (statement: SqlStatement) => Promise<RawRecord[]>,
  queryText: string,
  limit: number,
): Promise<RetrievalCandidate[]> {
  const embedding = input.embedQuery ? await input.embedQuery(queryText) : await embedTextsOpenAICompatible([queryText]).then((vectors) => vectors[0] ?? []);
  if (!Array.isArray(embedding) || embedding.length === 0) return [];
  const rows = await query(
    buildVectorCandidatesQuery({
      datasetId: input.datasetId,
      embedding,
      nodeKind: input.nodeKind,
      limit,
    }),
  );
  return mapVectorCandidateRows(rows.map(toVectorCandidateRow), input.vectorMinSimilarity);
}

function selectCandidatesForMode(options: {
  local: RetrievalCandidate[];
  vector: RetrievalCandidate[];
  mode: RetrievalMode;
  limit: number;
}): RetrievalCandidate[] {
  if (options.mode === "hybrid") return mergeCandidates([options.local, options.vector], options.limit);
  if (options.mode === "vector") return options.vector.slice(0, options.limit).map((candidate) => ({ ...candidate }));
  return options.local.slice(0, options.limit).map((candidate) => ({ ...candidate }));
}

function toLocalCandidateRow(row: RawRecord) {
  return {
    id: requiredString(row.id, "id"),
    name: requiredString(row.name, "name"),
    kind: requiredString(row.kind, "kind"),
    score: row.score as number | string,
  };
}

function toVectorCandidateRow(row: RawRecord) {
  return {
    id: requiredString(row.id, "id"),
    name: requiredString(row.name, "name"),
    kind: requiredString(row.kind, "kind"),
    similarity: row.similarity as number | string,
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required field '${name}'.`);
  return value;
}

function assertRecordRows(name: string, rows: unknown): asserts rows is RawRecord[] {
  if (!Array.isArray(rows) || !rows.every(isRecord)) throw new Error(`${name} returned invalid rows.`);
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function defaultNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}
