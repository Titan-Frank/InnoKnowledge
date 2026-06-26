import type { SqlStatement } from "../staging/staging-sql.js";

type RawRecord = Record<string, unknown>;

export type NodeCardBodyRow = {
  node_id: string;
  title?: string | null;
  summary?: string | null;
  source_refs_json?: unknown;
  sections_json?: unknown;
  properties_json?: unknown;
};

export type ExistingNodeBodyRow = {
  node_id: string;
  generated_from?: string | null;
  status?: string | null;
};

export type GeneratedNodeBodyRow = {
  dataset_id: string;
  node_id: string;
  format: "markdown";
  content: string;
  media_refs_json: RawRecord[];
  source_refs_json: string[];
  generated_from: "card_expansion";
  properties_json: RawRecord;
  status: "active";
  created_at: string;
  updated_at: string;
};

export type GenerateNodeBodiesPlan = {
  rows: GeneratedNodeBodyRow[];
  skippedExisting: string[];
  skippedMissingSourceRefs: string[];
  skippedEmptyContent: string[];
};

export type GenerateNodeBodiesDatabaseOutput = {
  status: "success";
  dataset_id: string;
  selected: number;
  generated: number;
  skipped_existing: number;
  skipped_missing_source_refs: number;
  skipped_empty_content: number;
  read_statements: string[];
  statements: string[];
  executedStatements: string[];
};

export type GenerateNodeBodiesQueryExecutor = (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];
export type GenerateNodeBodiesExecutor = (statement: SqlStatement) => Promise<void> | void;

export function buildSelectNodeCardsForBodiesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-node-cards-for-bodies",
    sql: [
      "SELECT node_id, title, summary, source_refs_json, sections_json, properties_json",
      "FROM world_node_cards",
      "WHERE dataset_id = $1 AND status != 'deprecated'",
      "ORDER BY node_id",
    ].join("\n"),
    params: [datasetId],
  };
}

export function buildSelectExistingNodeBodiesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-existing-node-bodies",
    sql: [
      "SELECT node_id, generated_from, status",
      "FROM world_node_bodies",
      "WHERE dataset_id = $1 AND status != 'deprecated'",
      "ORDER BY node_id",
    ].join("\n"),
    params: [datasetId],
  };
}

export function renderNodeCardBodyMarkdown(card: NodeCardBodyRow): string {
  const lines: string[] = [];
  const summary = textValue(card.summary);
  if (summary) {
    lines.push(summary);
    lines.push("");
  }

  const sections = Array.isArray(card.sections_json) ? card.sections_json.filter(isRecord) : [];
  for (const section of sections) {
    const title = textValue(section.title) || textValue(section.section_type);
    if (title) {
      lines.push(`## ${title}`);
      lines.push("");
    }
    for (const item of sectionContentItems(section.content)) {
      lines.push(item);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

export function collectBodySourceRefs(card: NodeCardBodyRow): string[] {
  const refs: unknown[] = Array.isArray(card.source_refs_json) ? [...card.source_refs_json] : [];
  const sections = Array.isArray(card.sections_json) ? card.sections_json.filter(isRecord) : [];
  for (const section of sections) {
    if (Array.isArray(section.source_refs)) refs.push(...section.source_refs);
  }
  return uniqueStrings(refs);
}

export function planNodeBodiesFromCards(input: {
  datasetId: string;
  cards: NodeCardBodyRow[];
  existingBodies?: ExistingNodeBodyRow[];
  overwriteExisting?: boolean;
  now: string;
}): GenerateNodeBodiesPlan {
  const existing = new Map((input.existingBodies ?? []).map((row) => [row.node_id, row]));
  const rows: GeneratedNodeBodyRow[] = [];
  const skippedExisting: string[] = [];
  const skippedMissingSourceRefs: string[] = [];
  const skippedEmptyContent: string[] = [];

  for (const card of input.cards) {
    const existingBody = existing.get(card.node_id);
    if (existingBody && !input.overwriteExisting && existingBody.generated_from !== "card_expansion") {
      skippedExisting.push(card.node_id);
      continue;
    }

    const content = renderNodeCardBodyMarkdown(card);
    if (!content) {
      skippedEmptyContent.push(card.node_id);
      continue;
    }

    const sourceRefs = collectBodySourceRefs(card);
    if (sourceRefs.length === 0) {
      skippedMissingSourceRefs.push(card.node_id);
      continue;
    }

    rows.push({
      dataset_id: input.datasetId,
      node_id: card.node_id,
      format: "markdown",
      content,
      media_refs_json: [],
      source_refs_json: sourceRefs,
      generated_from: "card_expansion",
      properties_json: {
        source: "world_node_cards",
        card_title: textValue(card.title),
      },
      status: "active",
      created_at: input.now,
      updated_at: input.now,
    });
  }

  return { rows, skippedExisting, skippedMissingSourceRefs, skippedEmptyContent };
}

export function buildUpsertNodeBodyStatement(row: GeneratedNodeBodyRow): SqlStatement {
  return {
    name: "upsert-world-node-body",
    sql: [
      "INSERT INTO world_node_bodies (",
      "dataset_id, node_id, format, content, media_refs_json, source_refs_json, generated_from, properties_json, status, created_at, updated_at",
      ") VALUES (",
      "$1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9, $10, $11",
      ")",
      "ON CONFLICT (dataset_id, node_id) DO UPDATE SET",
      "format = EXCLUDED.format,",
      "content = EXCLUDED.content,",
      "media_refs_json = EXCLUDED.media_refs_json,",
      "source_refs_json = EXCLUDED.source_refs_json,",
      "generated_from = EXCLUDED.generated_from,",
      "properties_json = EXCLUDED.properties_json,",
      "status = EXCLUDED.status,",
      "updated_at = EXCLUDED.updated_at",
    ].join("\n"),
    params: [
      row.dataset_id,
      row.node_id,
      row.format,
      row.content,
      row.media_refs_json,
      row.source_refs_json,
      row.generated_from,
      row.properties_json,
      row.status,
      row.created_at,
      row.updated_at,
    ],
  };
}

export async function runGenerateNodeBodiesFromDatabase(input: {
  datasetId: string;
  now?: string;
  overwriteExisting?: boolean;
  query: GenerateNodeBodiesQueryExecutor;
  executeStatement: GenerateNodeBodiesExecutor;
}): Promise<GenerateNodeBodiesDatabaseOutput> {
  const now = input.now || new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const readStatements: string[] = [];
  const statements: string[] = [];
  const executedStatements: string[] = [];
  const query = async (statement: SqlStatement): Promise<RawRecord[]> => {
    readStatements.push(statement.name);
    const rows = await input.query(statement);
    assertRecordRows(statement.name, rows);
    return rows;
  };

  const cards = (await query(buildSelectNodeCardsForBodiesQuery(input.datasetId))).map(toNodeCardBodyRow);
  const existingBodies = (await query(buildSelectExistingNodeBodiesQuery(input.datasetId))).map(toExistingNodeBodyRow);
  const plan = planNodeBodiesFromCards({
    datasetId: input.datasetId,
    cards,
    existingBodies,
    overwriteExisting: input.overwriteExisting,
    now,
  });

  for (const row of plan.rows) {
    const statement = buildUpsertNodeBodyStatement(row);
    statements.push(statement.name);
    await input.executeStatement(statement);
    executedStatements.push(statement.name);
  }

  return {
    status: "success",
    dataset_id: input.datasetId,
    selected: cards.length,
    generated: plan.rows.length,
    skipped_existing: plan.skippedExisting.length,
    skipped_missing_source_refs: plan.skippedMissingSourceRefs.length,
    skipped_empty_content: plan.skippedEmptyContent.length,
    read_statements: readStatements,
    statements,
    executedStatements,
  };
}

function sectionContentItems(content: unknown): string[] {
  if (Array.isArray(content)) return content.map(formatContentItem).filter(Boolean);
  const text = formatContentItem(content);
  return text ? [text] : [];
}

function formatContentItem(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isRecord(value)) {
    const text = textValue(value.text) || textValue(value.content) || textValue(value.value);
    if (text) return text;
  }
  return JSON.stringify(value);
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => textValue(value)).filter(Boolean))];
}

function toNodeCardBodyRow(row: RawRecord): NodeCardBodyRow {
  return {
    node_id: requiredString(row.node_id, "node_id"),
    title: optionalString(row.title),
    summary: optionalString(row.summary),
    source_refs_json: row.source_refs_json,
    sections_json: row.sections_json,
    properties_json: row.properties_json,
  };
}

function toExistingNodeBodyRow(row: RawRecord): ExistingNodeBodyRow {
  return {
    node_id: requiredString(row.node_id, "node_id"),
    generated_from: optionalString(row.generated_from),
    status: optionalString(row.status),
  };
}

function textValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required field '${name}'.`);
  return value;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  return String(value);
}

function assertRecordRows(name: string, rows: unknown): asserts rows is RawRecord[] {
  if (!Array.isArray(rows) || !rows.every(isRecord)) {
    throw new Error(`Query '${name}' must return an array of objects.`);
  }
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
