import type { SqlStatement } from "../staging/staging-sql.js";

export type EmbeddingTextRow = {
  name?: unknown;
  definition?: unknown;
  aliases_json?: unknown;
  domains_json?: unknown;
};

export type EmbeddingBackfillRow = EmbeddingTextRow & {
  id?: unknown;
  raw_node_id?: unknown;
};

export type EmbeddingTextBatch = {
  rows: EmbeddingBackfillRow[];
  texts: string[];
};

export type PlannedEmbeddingUpdate = {
  id: string;
  vector: number[];
};

export const DEFAULT_EMBEDDING_URL = "https://heckb8bcaq88cko9mooamhkbceqq9ecc.openapi-sj.sii.edu.cn/v1/embeddings";
export const DEFAULT_EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-4B";
export const EMBEDDING_VECTOR_DIMENSION = 1024;

export type EmbeddingFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type EmbeddingFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<EmbeddingFetchResponse>;

export type EmbedTextsOptions = {
  url?: string;
  model?: string;
  apiKey?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  fetch?: EmbeddingFetch;
  sleep?: (ms: number) => Promise<void>;
};

export function composeEmbeddingText(row: EmbeddingTextRow): string {
  const aliases = Array.isArray(row.aliases_json) ? row.aliases_json : [];
  const domains = Array.isArray(row.domains_json) ? row.domains_json : [];
  const aliasText = aliases.length > 0 ? aliases.filter(Boolean).map(String).join("、") : "";
  const domainText = domains.length > 0 ? domains.filter(Boolean).map(String).join("、") : "";
  return [row.name ?? "", row.definition ?? "", aliasText, domainText]
    .map(String)
    .filter((part) => part.trim())
    .join(" ");
}

export function buildEmbeddingTextBatches(rows: EmbeddingBackfillRow[], batchSize: number): EmbeddingTextBatch[] {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("batchSize must be a positive integer.");
  const batches: EmbeddingTextBatch[] = [];
  for (let index = 0; index < rows.length; index += batchSize) {
    const batchRows = rows.slice(index, index + batchSize);
    batches.push({
      rows: batchRows,
      texts: batchRows.map((row) => composeEmbeddingText(row)),
    });
  }
  return batches;
}

export function planEmbeddingUpdatesForBatch(
  rows: EmbeddingBackfillRow[],
  vectors: Array<number[] | null | undefined>,
  pkColumn: "id" | "raw_node_id",
): PlannedEmbeddingUpdate[] {
  const limit = Math.min(rows.length, vectors.length);
  const updates: PlannedEmbeddingUpdate[] = [];
  for (let index = 0; index < limit; index += 1) {
    const vector = vectors[index];
    if (!Array.isArray(vector) || vector.length === 0) continue;
    const rawId = rows[index]?.[pkColumn];
    if (rawId === undefined || rawId === null) continue;
    updates.push({ id: String(rawId), vector });
  }
  return updates;
}

export function formatEmbeddingVector(vector: number[] | null | undefined): string | null {
  if (!Array.isArray(vector) || vector.length === 0 || vector.some((value) => !Number.isFinite(value))) return null;
  return `[${vector.map(String).join(",")}]`;
}

export type EmbeddingBackfillTable = "world_nodes" | "world_staging_nodes";

export type EmbeddingUpdateInput = {
  id: string;
  vector: number[] | null | undefined;
};

export type EmbeddingBackfillSqlPlan = {
  selectMissing: SqlStatement;
  updates: SqlStatement[];
  statements: SqlStatement[];
};

export function buildSelectMissingEmbeddingsStatement(table: EmbeddingBackfillTable): SqlStatement {
  if (table === "world_nodes") {
    return {
      name: "select-world-nodes-missing-embeddings",
      sql: "SELECT id, name, definition, aliases_json, domains_json FROM world_nodes WHERE embedding IS NULL",
      params: [],
    };
  }
  return {
    name: "select-world-staging-nodes-missing-embeddings",
    sql: "SELECT raw_node_id, name, definition, aliases_json, domains_json FROM world_staging_nodes WHERE embedding IS NULL",
    params: [],
  };
}

export function buildEmbeddingBackfillSqlPlan(table: EmbeddingBackfillTable, rows: EmbeddingUpdateInput[]): EmbeddingBackfillSqlPlan {
  const selectMissing = buildSelectMissingEmbeddingsStatement(table);
  const pkColumn = table === "world_nodes" ? "id" : "raw_node_id";
  const updates = rows
    .map((row) => ({ ...row, vectorText: formatEmbeddingVector(row.vector) }))
    .filter((row) => row.vectorText !== null)
    .map((row) => ({
      name: `update-${table}-embedding`,
      sql: `UPDATE ${table} SET embedding = $1::vector WHERE ${pkColumn} = $2`,
      params: [row.vectorText, row.id],
    }));
  return {
    selectMissing,
    updates,
    statements: [selectMissing, ...updates],
  };
}

type RawRecord = Record<string, unknown>;

export type EmbeddingBackfillMode = EmbeddingBackfillTable | "both";
export type EmbeddingBackfillQueryExecutor = (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];
export type EmbeddingBackfillExecutor = (statement: SqlStatement) => Promise<void> | void;
export type EmbedTexts = (texts: string[]) => Promise<Array<number[] | null | undefined>> | Array<number[] | null | undefined>;

export type EmbeddingBackfillTableSummary = {
  table: EmbeddingBackfillTable;
  selected: number;
  batches: number;
  updated: number;
};

export type EmbeddingBackfillDatabaseOutput = {
  status: "success";
  table: EmbeddingBackfillMode;
  batch_size: number;
  selected: number;
  batches: number;
  updated: number;
  tables: EmbeddingBackfillTableSummary[];
  read_statements: string[];
  statements: string[];
  executedStatements: string[];
};

export async function runEmbeddingBackfillFromDatabase(input: {
  table?: EmbeddingBackfillMode;
  batchSize?: number;
  query: EmbeddingBackfillQueryExecutor;
  executeStatement: EmbeddingBackfillExecutor;
  embedTexts: EmbedTexts;
  sleepBetweenBatchesMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<EmbeddingBackfillDatabaseOutput> {
  const table = input.table ?? "both";
  const batchSize = input.batchSize ?? 32;
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("batchSize must be a positive integer.");

  const readStatements: string[] = [];
  const statements: string[] = [];
  const executedStatements: string[] = [];
  const tableSummaries: EmbeddingBackfillTableSummary[] = [];
  const query = async (statement: SqlStatement): Promise<RawRecord[]> => {
    readStatements.push(statement.name);
    const rows = await input.query(statement);
    assertRecordRows(statement.name, rows);
    return rows;
  };

  for (const currentTable of tablesForMode(table)) {
    const rows = (await query(buildSelectMissingEmbeddingsStatement(currentTable))).map(toEmbeddingBackfillRow);
    const batches = buildEmbeddingTextBatches(rows, batchSize);
    const summary: EmbeddingBackfillTableSummary = {
      table: currentTable,
      selected: rows.length,
      batches: batches.length,
      updated: 0,
    };
    tableSummaries.push(summary);

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index]!;
      const vectors = await input.embedTexts(batch.texts);
      const pkColumn = currentTable === "world_nodes" ? "id" : "raw_node_id";
      const updates = planEmbeddingUpdatesForBatch(batch.rows, vectors, pkColumn);
      const plan = buildEmbeddingBackfillSqlPlan(currentTable, updates);
      for (const statement of plan.updates) {
        statements.push(statement.name);
        await input.executeStatement(statement);
        executedStatements.push(statement.name);
      }
      summary.updated += updates.length;
      if (index + 1 < batches.length && (input.sleepBetweenBatchesMs ?? 0) > 0) {
        await (input.sleep ?? defaultSleep)(input.sleepBetweenBatchesMs!);
      }
    }
  }

  return {
    status: "success",
    table,
    batch_size: batchSize,
    selected: tableSummaries.reduce((sum, item) => sum + item.selected, 0),
    batches: tableSummaries.reduce((sum, item) => sum + item.batches, 0),
    updated: tableSummaries.reduce((sum, item) => sum + item.updated, 0),
    tables: tableSummaries,
    read_statements: readStatements,
    statements,
    executedStatements,
  };
}

export function tablesForMode(table: EmbeddingBackfillMode): EmbeddingBackfillTable[] {
  if (table === "both") return ["world_nodes", "world_staging_nodes"];
  return [table];
}

export async function embedTextsOpenAICompatible(texts: string[], options: EmbedTextsOptions = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 30000;
  const fetchEmbedding = options.fetch ?? defaultFetch;
  const sleep = options.sleep ?? defaultSleep;
  const emptyResult = texts.map(() => [] as number[]);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = options.apiKey ?? process.env.EMBEDDING_API_KEY ?? "";
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const body = JSON.stringify({
    model: options.model ?? DEFAULT_EMBEDDING_MODEL,
    input: texts,
  });

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchEmbedding(options.url ?? DEFAULT_EMBEDDING_URL, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Embedding API HTTP ${response.status}`);
      return parseEmbeddingResponse(await response.json(), texts.length);
    } catch {
      if (attempt >= maxRetries) return emptyResult;
      await sleep(retryDelayMs * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  return emptyResult;
}

function parseEmbeddingResponse(body: unknown, inputCount: number): number[][] {
  const indexed = new Map<number, number[]>();
  const data = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const index = typeof item.index === "number" && Number.isInteger(item.index) ? item.index : 0;
    const rawVector = Array.isArray(item.embedding) ? item.embedding : [];
    const vector = rawVector.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (vector.length > EMBEDDING_VECTOR_DIMENSION) indexed.set(index, vector.slice(0, EMBEDDING_VECTOR_DIMENSION));
    else if (vector.length === EMBEDDING_VECTOR_DIMENSION) indexed.set(index, vector);
  }
  return Array.from({ length: inputCount }, (_, index) => indexed.get(index) ?? []);
}

async function defaultFetch(url: string, init: Parameters<EmbeddingFetch>[1]): Promise<EmbeddingFetchResponse> {
  return fetch(url, init);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toEmbeddingBackfillRow(row: RawRecord): EmbeddingBackfillRow {
  return {
    id: row.id,
    raw_node_id: row.raw_node_id,
    name: row.name,
    definition: row.definition,
    aliases_json: row.aliases_json,
    domains_json: row.domains_json,
  };
}

function assertRecordRows(name: string, rows: unknown): asserts rows is RawRecord[] {
  if (!Array.isArray(rows) || !rows.every(isRecord)) throw new Error(`${name} returned invalid rows.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
