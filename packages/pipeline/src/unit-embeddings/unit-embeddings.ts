import { createHash } from "node:crypto";

import { formatEmbeddingVector } from "../shared/embeddings.js";
import type { SqlStatement } from "../staging/staging-sql.js";

type RawRecord = Record<string, unknown>;

export type UnitEmbeddingNode = {
  id: string;
  name: string;
  kind: string;
  definition: string;
  aliases: string[];
  domains: string[];
  semanticCore: unknown;
};

export type UnitEmbeddingCard = {
  title: string;
  summary: string;
  sections: RawRecord[];
};

export type UnitEmbeddingBody = {
  content: string;
  generatedFrom: string;
};

export type UnitEmbeddingEvidence = {
  id: string;
  locator: string;
  excerpt: string;
};

type UnitEmbeddingJob = {
  nodeId: string;
  text: string;
  hash: string;
};

export type UnitEmbeddingDatabaseOutput = {
  status: "success";
  dataset_id: string;
  selected: number;
  pending: number;
  updated: number;
  skipped: number;
  batch_size: number;
  force: boolean;
  read_statements: string[];
  statements: string[];
};

export type UnitEmbeddingQueryExecutor = (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];
export type UnitEmbeddingStatementExecutor = (statement: SqlStatement) => Promise<void> | void;
export type UnitEmbedTexts = (texts: string[]) => Promise<Array<number[] | null | undefined>> | Array<number[] | null | undefined>;

const MAX_BODY_CHARS = 5000;
const MAX_EVIDENCE_ITEMS = 12;
const MAX_EVIDENCE_CHARS = 900;
const MAX_SECTION_CHARS = 1200;

export async function runUnitEmbeddingBackfillFromDatabase(input: {
  datasetId: string;
  batchSize?: number;
  limit?: number | null;
  force?: boolean;
  embeddingModel: string;
  query: UnitEmbeddingQueryExecutor;
  executeStatement: UnitEmbeddingStatementExecutor;
  embedTexts: UnitEmbedTexts;
}): Promise<UnitEmbeddingDatabaseOutput> {
  const batchSize = input.batchSize ?? 8;
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("batchSize must be a positive integer.");

  const readStatements: string[] = [];
  const statements: string[] = [];
  const query = async (statement: SqlStatement): Promise<RawRecord[]> => {
    readStatements.push(statement.name);
    const rows = await input.query(statement);
    assertRows(statement.name, rows);
    return rows;
  };

  const nodeRows = await query(buildSelectUnitEmbeddingNodesStatement(input.datasetId, input.limit ?? null));
  const cardRows = await query(buildSelectUnitEmbeddingCardsStatement(input.datasetId));
  const bodyRows = await query(buildSelectUnitEmbeddingBodiesStatement(input.datasetId));
  const evidenceRows = await query(buildSelectUnitEmbeddingEvidenceStatement(input.datasetId));
  const existingRows = await query(buildSelectExistingUnitEmbeddingsStatement(input.datasetId));

  const cardsByNodeId = firstByNodeId(cardRows.map(toCardRecord));
  const bodiesByNodeId = firstByNodeId(bodyRows.map(toBodyRecord).filter((body) => body.generatedFrom !== "node_card_fallback"));
  const evidenceByNodeId = groupEvidenceByNodeId(evidenceRows);
  const existingHashes = new Map(existingRows.map((row) => [stringValue(row.node_id), stringValue(row.content_hash)]));

  const jobs: UnitEmbeddingJob[] = [];
  for (const row of nodeRows) {
    const node = toNodeRecord(row);
    const text = composeUnitEmbeddingText({
      node,
      card: cardsByNodeId.get(node.id) ?? null,
      body: bodiesByNodeId.get(node.id) ?? null,
      evidence: evidenceByNodeId.get(node.id) ?? [],
    });
    if (!text) continue;
    const hash = hashUnitEmbeddingText(text);
    if (!input.force && existingHashes.get(node.id) === hash) continue;
    jobs.push({ nodeId: node.id, text, hash });
  }

  let updated = 0;
  for (let index = 0; index < jobs.length; index += batchSize) {
    const batch = jobs.slice(index, index + batchSize);
    const vectors = await input.embedTexts(batch.map((job) => job.text));
    for (let offset = 0; offset < batch.length; offset += 1) {
      const vectorText = formatEmbeddingVector(vectors[offset]);
      if (!vectorText) continue;
      const job = batch[offset]!;
      const statement = buildUpsertUnitEmbeddingStatement({
        datasetId: input.datasetId,
        nodeId: job.nodeId,
        vectorText,
        contentHash: job.hash,
        retrievalText: job.text,
        embeddingModel: input.embeddingModel,
        generatedAt: new Date().toISOString(),
      });
      await input.executeStatement(statement);
      statements.push(statement.name);
      updated += 1;
    }
  }

  return {
    status: "success",
    dataset_id: input.datasetId,
    selected: nodeRows.length,
    pending: jobs.length,
    updated,
    skipped: nodeRows.length - jobs.length,
    batch_size: batchSize,
    force: Boolean(input.force),
    read_statements: readStatements,
    statements,
  };
}

export function buildSelectUnitEmbeddingNodesStatement(datasetId: string, limit: number | null): SqlStatement {
  const params: unknown[] = [datasetId];
  const limitClause = limit && limit > 0 ? "\nLIMIT $2" : "";
  if (limitClause) params.push(limit);
  return {
    name: "select-unit-embedding-nodes",
    sql: [
      "SELECT id, name, kind, definition, aliases_json, domains_json, properties_json",
      "FROM world_nodes",
      "WHERE dataset_id = $1 AND status != 'deprecated'",
      "ORDER BY id",
      limitClause.trim(),
    ].filter(Boolean).join("\n"),
    params,
  };
}

export function buildSelectUnitEmbeddingCardsStatement(datasetId: string): SqlStatement {
  return {
    name: "select-unit-embedding-cards",
    sql: [
      "SELECT node_id, title, summary, sections_json",
      "FROM world_node_cards",
      "WHERE dataset_id = $1 AND status != 'deprecated'",
      "ORDER BY node_id",
    ].join("\n"),
    params: [datasetId],
  };
}

export function buildSelectUnitEmbeddingBodiesStatement(datasetId: string): SqlStatement {
  return {
    name: "select-unit-embedding-bodies",
    sql: [
      "SELECT node_id, content, generated_from",
      "FROM world_node_bodies",
      "WHERE dataset_id = $1 AND status != 'deprecated'",
      "ORDER BY node_id",
    ].join("\n"),
    params: [datasetId],
  };
}

export function buildSelectUnitEmbeddingEvidenceStatement(datasetId: string): SqlStatement {
  return {
    name: "select-unit-embedding-evidence",
    sql: [
      "SELECT DISTINCT m.target_id AS node_id, e.id, e.locator, e.excerpt, e.modality, e.properties_json, e.source_id, e.anchor_ref",
      "FROM world_evidence AS e",
      "JOIN world_mentions AS m ON m.dataset_id = e.dataset_id",
      "WHERE m.dataset_id = $1",
      "  AND m.target_type = 'node'",
      "  AND (",
      "    EXISTS (",
      "      SELECT 1",
      "      FROM jsonb_array_elements_text(COALESCE(m.source_refs_json, '[]'::jsonb)) AS ref(value)",
      "      WHERE ref.value = e.id",
      "    )",
      "    OR (e.source_id = m.source_id AND e.anchor_ref = m.anchor_ref)",
      "  )",
      "ORDER BY m.target_id, e.source_id, e.anchor_ref, e.id",
    ].join("\n"),
    params: [datasetId],
  };
}

export function buildSelectExistingUnitEmbeddingsStatement(datasetId: string): SqlStatement {
  return {
    name: "select-existing-unit-embeddings",
    sql: [
      "SELECT node_id, content_hash",
      "FROM world_unit_embeddings",
      "WHERE dataset_id = $1",
    ].join("\n"),
    params: [datasetId],
  };
}

export function buildUpsertUnitEmbeddingStatement(input: {
  datasetId: string;
  nodeId: string;
  vectorText: string;
  contentHash: string;
  retrievalText: string;
  embeddingModel: string;
  generatedAt: string;
}): SqlStatement {
  return {
    name: "upsert-world-unit-embedding",
    sql: [
      "INSERT INTO world_unit_embeddings (",
      "  dataset_id, node_id, embedding, content_hash, retrieval_text, embedding_model, generated_at",
      ") VALUES (",
      "  $1, $2, $3::vector, $4, $5, $6, $7",
      ")",
      "ON CONFLICT (dataset_id, node_id) DO UPDATE SET",
      "  embedding = EXCLUDED.embedding,",
      "  content_hash = EXCLUDED.content_hash,",
      "  retrieval_text = EXCLUDED.retrieval_text,",
      "  embedding_model = EXCLUDED.embedding_model,",
      "  generated_at = EXCLUDED.generated_at",
    ].join("\n"),
    params: [
      input.datasetId,
      input.nodeId,
      input.vectorText,
      input.contentHash,
      input.retrievalText,
      input.embeddingModel,
      input.generatedAt,
    ],
  };
}

export function composeUnitEmbeddingText(input: {
  node: UnitEmbeddingNode;
  card: UnitEmbeddingCard | null;
  body: UnitEmbeddingBody | null;
  evidence: UnitEmbeddingEvidence[];
}): string {
  const parts = [
    `name: ${input.node.name}`,
    `kind: ${input.node.kind}`,
    input.node.definition ? `definition: ${input.node.definition}` : "",
    arrayText("aliases", input.node.aliases),
    arrayText("domains", input.node.domains),
    semanticCoreText(input.node.semanticCore),
    cardText(input.card),
    input.body?.content ? `body:\n${truncate(input.body.content, MAX_BODY_CHARS)}` : "",
    evidenceText(input.evidence),
  ];
  return normalizeWhitespace(parts.filter(Boolean).join("\n\n"));
}

export function hashUnitEmbeddingText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function toNodeRecord(row: RawRecord): UnitEmbeddingNode {
  const properties = asRecord(row.properties_json);
  return {
    id: stringValue(row.id),
    name: stringValue(row.name) || stringValue(row.id),
    kind: stringValue(row.kind) || "concept",
    definition: stringValue(row.definition),
    aliases: stringArray(row.aliases_json),
    domains: stringArray(row.domains_json),
    semanticCore: properties.semantic_core,
  };
}

function toCardRecord(row: RawRecord): UnitEmbeddingCard & { nodeId: string } {
  return {
    nodeId: stringValue(row.node_id),
    title: stringValue(row.title),
    summary: stringValue(row.summary),
    sections: Array.isArray(row.sections_json) ? row.sections_json.filter(isRecord) : [],
  };
}

function toBodyRecord(row: RawRecord): UnitEmbeddingBody & { nodeId: string } {
  return {
    nodeId: stringValue(row.node_id),
    content: stringValue(row.content),
    generatedFrom: stringValue(row.generated_from),
  };
}

function groupEvidenceByNodeId(rows: RawRecord[]): Map<string, UnitEmbeddingEvidence[]> {
  const result = new Map<string, UnitEmbeddingEvidence[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (isHiddenImageEvidence(row)) continue;
    const nodeId = stringValue(row.node_id);
    const id = stringValue(row.id);
    if (!nodeId || !id) continue;
    const key = `${nodeId}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const items = result.get(nodeId) ?? [];
    items.push({
      id,
      locator: stringValue(row.locator),
      excerpt: stringValue(row.excerpt),
    });
    result.set(nodeId, items);
  }
  return result;
}

function firstByNodeId<T extends { nodeId: string }>(items: T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (!item.nodeId || result.has(item.nodeId)) continue;
    result.set(item.nodeId, item);
  }
  return result;
}

function cardText(card: UnitEmbeddingCard | null): string {
  if (!card) return "";
  const sections = card.sections
    .slice(0, 8)
    .map((section) => [
      stringValue(section.title) ? `section: ${stringValue(section.title)}` : "",
      truncate(stringifyContent(section.content), MAX_SECTION_CHARS),
    ].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n");
  return [
    card.title ? `card_title: ${card.title}` : "",
    card.summary ? `card_summary: ${card.summary}` : "",
    sections ? `card_sections:\n${sections}` : "",
  ].filter(Boolean).join("\n");
}

function evidenceText(evidence: UnitEmbeddingEvidence[]): string {
  const rows = evidence
    .slice(0, MAX_EVIDENCE_ITEMS)
    .map((item) => [
      `evidence_id: ${item.id}`,
      item.locator ? `locator: ${item.locator}` : "",
      item.excerpt ? truncate(item.excerpt, MAX_EVIDENCE_CHARS) : "",
    ].filter(Boolean).join("\n"))
    .filter(Boolean);
  return rows.length ? `evidence:\n${rows.join("\n")}` : "";
}

function semanticCoreText(value: unknown): string {
  if (!isRecord(value)) return "";
  return `semantic_core: ${stringifyContent(value)}`;
}

function arrayText(label: string, values: string[]): string {
  const text = values.map((item) => item.trim()).filter(Boolean).join("、");
  return text ? `${label}: ${text}` : "";
}

function isHiddenImageEvidence(row: RawRecord): boolean {
  if (stringValue(row.modality).toLowerCase() !== "image") return false;
  const properties = asRecord(row.properties_json);
  const relevance = asRecord(properties.image_relevance);
  const status = stringValue(relevance.review_status);
  const label = stringValue(relevance.relevance);
  if (relevance.keep === false || status === "rejected") return true;
  if (status === "pending") return true;
  return !status && label === "uncertain";
}

function stringifyContent(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxChars: number): string {
  const text = value.trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function asRecord(value: unknown): RawRecord {
  return isRecord(value) ? value : {};
}

function assertRows(name: string, rows: unknown): asserts rows is RawRecord[] {
  if (!Array.isArray(rows) || !rows.every(isRecord)) throw new Error(`${name} returned invalid rows.`);
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
