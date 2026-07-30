import { parseModelJsonObject } from "../shared/model-json.js";
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

export type NodeBodyInputNodeRow = {
  id: string;
  name: string;
  kind: string;
  subkind?: string | null;
  definition: string;
  aliases_json?: unknown;
  domains_json?: unknown;
  knowledge_form_json?: unknown;
  learning_mode_json?: unknown;
  scope?: string | null;
  properties_json?: unknown;
  tags_json?: unknown;
};

export type NodeBodyInputMentionRow = {
  target_id: string;
  source_id: string;
  anchor_ref: string;
  source_refs_json?: unknown;
};

export type NodeBodyInputEvidenceRow = {
  id: string;
  source_type: string;
  source_id: string;
  anchor_ref: string;
  source_path?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  excerpt: string;
  locator: string;
  modality?: string | null;
  normalized_claims_json?: unknown;
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
  generated_from: "model_generation";
  properties_json: RawRecord;
  status: "active";
  created_at: string;
  updated_at: string;
};

export type ModelNodeBodyInput = {
  datasetId: string;
  node: NodeBodyInputNodeRow;
  card: NodeCardBodyRow;
  card_markdown: string;
  evidence: NodeBodyInputEvidenceRow[];
};

export type ModelNodeBodyResult = {
  content: string;
  source_refs: string[];
  media_refs?: RawRecord[];
  properties?: RawRecord;
};

export type ModelNodeBodyPrompt = {
  instructions: string;
  user_payload: string;
  response_schema: RawRecord;
};

export type ModelNodeBodyGenerator = (input: ModelNodeBodyInput) => Promise<ModelNodeBodyResult> | ModelNodeBodyResult;

export type ModelGenerationFailure = {
  node_id: string;
  message: string;
};

export type GenerateNodeBodiesPlan = {
  rows: GeneratedNodeBodyRow[];
  skippedExisting: string[];
  skippedMissingSourceRefs: string[];
  skippedEmptyContent: string[];
  skippedBackfilledOnly: string[];
  modelFailures: ModelGenerationFailure[];
};

export type GenerateNodeBodiesDatabaseOutput = {
  status: "success";
  mode: "model";
  dataset_id: string;
  selected: number;
  generated: number;
  skipped_existing: number;
  skipped_missing_source_refs: number;
  skipped_empty_content: number;
  skipped_backfilled_only: number;
  failed_model_generation: number;
  model_failures: ModelGenerationFailure[];
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

export function buildSelectNodesForModelBodiesQuery(input: {
  datasetId: string;
  nodeId?: string | null;
  limit?: number | null;
  bookId?: string | null;
  overwriteExisting?: boolean;
}): SqlStatement {
  return {
    name: "select-nodes-for-model-bodies",
    sql: [
      "SELECT n.id, n.name, n.kind, n.subkind, n.definition, n.aliases_json, n.domains_json, n.knowledge_form_json, n.learning_mode_json, n.scope, n.properties_json, n.tags_json",
      "FROM world_nodes AS n",
      "WHERE n.dataset_id = $1",
      "  AND n.status != 'deprecated'",
      "  AND ($2 = '' OR n.id = $2)",
      "  AND (",
      "    $4 = ''",
      "    OR EXISTS (",
      "      SELECT 1",
      "      FROM world_mentions AS mention",
      "      JOIN LATERAL jsonb_array_elements_text(mention.source_refs_json) AS mention_ref(evidence_id) ON true",
      "      JOIN world_evidence AS evidence",
      "        ON evidence.dataset_id = mention.dataset_id",
      "       AND evidence.id = mention_ref.evidence_id",
      "      WHERE mention.dataset_id = n.dataset_id",
      "        AND mention.target_type = 'node'",
      "        AND mention.target_id = n.id",
      "        AND evidence.source_id = $4",
      "    )",
      "  )",
      "  AND (",
      "    $5",
      "    OR NOT EXISTS (",
      "      SELECT 1",
      "      FROM world_node_bodies AS body",
      "      WHERE body.dataset_id = n.dataset_id",
      "        AND body.node_id = n.id",
      "        AND body.status != 'deprecated'",
      "        AND body.generated_from IS DISTINCT FROM 'card_expansion'",
      "    )",
      "  )",
      "ORDER BY n.id",
      "LIMIT NULLIF($3, 0)",
    ].join("\n"),
    params: [input.datasetId, input.nodeId ?? "", input.limit ?? 0, input.bookId ?? "", input.overwriteExisting === true],
  };
}

export function buildSelectMentionsForModelBodiesQuery(datasetId: string, bookId = ""): SqlStatement {
  return {
    name: "select-mentions-for-model-bodies",
    sql: [
      "SELECT target_id, source_id, anchor_ref, source_refs_json",
      "FROM world_mentions",
      "WHERE dataset_id = $1",
      "  AND target_type = 'node'",
      "  AND ($2 = '' OR source_id = $2)",
      "ORDER BY target_id, source_id, anchor_ref",
    ].join("\n"),
    params: [datasetId, bookId],
  };
}

export function buildSelectEvidenceForModelBodiesQuery(datasetId: string, bookId = ""): SqlStatement {
  return {
    name: "select-evidence-for-model-bodies",
    sql: [
      "SELECT id, source_type, source_id, anchor_ref, source_path, page_start, page_end, excerpt, locator, modality, normalized_claims_json, properties_json",
      "FROM world_evidence",
      "WHERE dataset_id = $1",
      "  AND ($2 = '' OR source_id = $2)",
      "ORDER BY source_id, anchor_ref, id",
    ].join("\n"),
    params: [datasetId, bookId],
  };
}

export function buildModelNodeBodyPrompt(input: ModelNodeBodyInput): ModelNodeBodyPrompt {
  const evidenceIds = input.evidence.map((row) => row.id);
  const instructions = [
    "你是 Open Knowledge Map 的知识正文写作者。",
    "任务：根据一个知识节点、它的高质量结构化卡片、课本原文片段和证据引用，写出可阅读、可追溯的 Markdown 知识正文。",
    "",
    "硬约束：",
    "1. 只能使用输入里给出的节点信息、卡片内容和证据片段，不要补充没有证据支持的新事实。",
    "2. 正文不是课本原文搬运；可以解释和组织，但不能虚构。",
    "3. `source_refs` 只能填写输入 evidence 中出现的 id，不能创造新的证据 id。",
    "4. 如果证据不足以支持某个小节，就省略该小节，不要硬写。",
    "5. 如果在正文句末标注证据，直接用完整证据 ID 加方括号，例如 `[evidence:auto-64c1ee9124ae]`，不要用反引号包裹证据标记。",
    "6. Markdown 不要使用一级标题；正文可以包含 `## 定义`、`## 核心解释`、`## 关键要点`、`## 示例或应用`、`## 易错点` 等二级标题。",
    "7. 输出必须是可由 JSON.parse 直接解析的单个 JSON 对象；只能以一个左花括号开始、一个右花括号结束，不要输出额外解释。",
  ].join("\n");
  const userPayload = JSON.stringify({
    dataset_id: input.datasetId,
    node: {
      id: input.node.id,
      name: input.node.name,
      kind: input.node.kind,
      subkind: input.node.subkind,
      definition: input.node.definition,
      aliases: arrayValue(input.node.aliases_json),
      domains: arrayValue(input.node.domains_json),
      knowledge_form: arrayValue(input.node.knowledge_form_json),
      learning_mode: arrayValue(input.node.learning_mode_json),
      scope: input.node.scope,
      tags: arrayValue(input.node.tags_json),
      properties: recordValue(input.node.properties_json),
    },
    card: {
      title: textValue(input.card.title),
      summary: textValue(input.card.summary),
      markdown: input.card_markdown,
      sections: usableBodySections(input.card).map((section) => ({
        id: textValue(section.id),
        title: textValue(section.title),
        section_type: textValue(section.section_type),
        content: sectionContentItems(section.content),
        source_refs: uniqueStrings(Array.isArray(section.source_refs) ? section.source_refs : []),
      })),
    },
    evidence: input.evidence.map((row) => ({
      id: row.id,
      source_id: row.source_id,
      anchor_ref: row.anchor_ref,
      source_path: row.source_path,
      page_start: row.page_start,
      page_end: row.page_end,
      locator: row.locator,
      modality: row.modality,
      excerpt: truncateText(row.excerpt, 1400),
      normalized_claims: arrayValue(row.normalized_claims_json),
    })),
    allowed_source_refs: evidenceIds,
  }, null, 2);
  return {
    instructions,
    user_payload: userPayload,
    response_schema: buildModelNodeBodyResponseSchema(),
  };
}

export function buildModelNodeBodyResponseSchema(): RawRecord {
  return {
    name: "okm_node_body",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        content: {
          type: "string",
          description: "Markdown knowledge body without a level-1 heading.",
        },
        source_refs: {
          type: "array",
          minItems: 1,
          items: { type: "string" },
        },
      },
      required: ["content", "source_refs"],
    },
  };
}

export function parseModelNodeBodyResultText(text: string): ModelNodeBodyResult {
  const parsed = parseModelJsonObject(text);
  const content = textValue(parsed.content)
    || textValue(parsed.markdown)
    || textValue(parsed.body)
    || textValue(parsed.content_markdown)
    || textValue(parsed.knowledge_body);
  if (!content) throw new Error("Model output is missing content.");
  const rawSourceRefs = Array.isArray(parsed.source_refs)
    ? parsed.source_refs
    : Array.isArray(parsed.evidence_refs)
      ? parsed.evidence_refs
      : Array.isArray(parsed.sources)
        ? parsed.sources
        : [];
  const sourceRefs = uniqueStrings(rawSourceRefs).length > 0
    ? uniqueStrings(rawSourceRefs)
    : extractBracketedSourceRefs(content);
  if (sourceRefs.length === 0) throw new Error("Model output is missing source_refs.");
  return {
    content,
    source_refs: sourceRefs,
    media_refs: Array.isArray(parsed.media_refs) ? parsed.media_refs.filter(isRecord) : [],
    properties: recordValue(parsed.properties),
  };
}

function extractBracketedSourceRefs(content: string): string[] {
  return uniqueStrings([...content.matchAll(/\[([^\]\s]+)\]/g)].map((match) => match[1]).filter(Boolean));
}

export function renderNodeCardBodyMarkdown(card: NodeCardBodyRow): string {
  const lines: string[] = [];
  const emittedParagraphs = new Set<string>();
  const summary = isBackfilledCard(card) ? "" : textValue(card.summary);
  if (summary) {
    pushParagraph(lines, emittedParagraphs, summary);
  }

  const sections = usableBodySections(card);
  for (const section of sections) {
    const items = sectionContentItems(section.content).filter((item) => !emittedParagraphs.has(item));
    if (items.length === 0) continue;
    const title = textValue(section.title) || textValue(section.section_type);
    if (title) {
      lines.push(`## ${title}`);
      lines.push("");
    }
    for (const item of items) pushParagraph(lines, emittedParagraphs, item);
  }

  return lines.join("\n").trim();
}

function collectModelBodySourceRefs(card: NodeCardBodyRow): string[] {
  const refs: unknown[] = Array.isArray(card.source_refs_json) ? [...card.source_refs_json] : [];
  const sections = Array.isArray(card.sections_json) ? card.sections_json.filter(isRecord) : [];
  for (const section of sections) {
    if (Array.isArray(section.source_refs)) refs.push(...section.source_refs);
  }
  return uniqueStrings(refs);
}

function renderModelCardContextMarkdown(card: NodeCardBodyRow): string {
  const formalContent = renderNodeCardBodyMarkdown(card);
  if (formalContent) return formalContent;
  return textValue(card.summary);
}

export async function planModelNodeBodies(input: {
  datasetId: string;
  nodes: NodeBodyInputNodeRow[];
  cards: NodeCardBodyRow[];
  mentions: NodeBodyInputMentionRow[];
  evidence: NodeBodyInputEvidenceRow[];
  existingBodies?: ExistingNodeBodyRow[];
  overwriteExisting?: boolean;
  modelName: string;
  now: string;
  maxEvidencePerNode?: number;
  concurrency?: number;
  generateBody: ModelNodeBodyGenerator;
}): Promise<GenerateNodeBodiesPlan> {
  const existing = new Map((input.existingBodies ?? []).map((row) => [row.node_id, row]));
  const cardByNode = new Map(input.cards.map((card) => [card.node_id, card]));
  const evidenceById = new Map(input.evidence.map((row) => [row.id, row]));
  const evidenceByAnchor = new Map<string, NodeBodyInputEvidenceRow[]>();
  for (const row of input.evidence) {
    const key = `${row.source_id}:${row.anchor_ref}`;
    if (!evidenceByAnchor.has(key)) evidenceByAnchor.set(key, []);
    evidenceByAnchor.get(key)!.push(row);
  }
  const mentionsByNode = new Map<string, NodeBodyInputMentionRow[]>();
  for (const mention of input.mentions) {
    if (!mentionsByNode.has(mention.target_id)) mentionsByNode.set(mention.target_id, []);
    mentionsByNode.get(mention.target_id)!.push(mention);
  }

  const rows: GeneratedNodeBodyRow[] = [];
  const skippedExisting: string[] = [];
  const skippedMissingSourceRefs: string[] = [];
  const skippedEmptyContent: string[] = [];
  const skippedBackfilledOnly: string[] = [];
  const modelFailures: ModelGenerationFailure[] = [];
  const maxEvidence = input.maxEvidencePerNode ?? 8;
  const tasks: ModelNodeBodyTask[] = [];

  for (const node of input.nodes) {
    const existingBody = existing.get(node.id);
    if (existingBody && !input.overwriteExisting && existingBody.generated_from !== "card_expansion") {
      skippedExisting.push(node.id);
      continue;
    }

    const card = cardByNode.get(node.id);
    if (!card) {
      skippedEmptyContent.push(node.id);
      continue;
    }
    const cardMarkdown = renderModelCardContextMarkdown(card);
    if (!cardMarkdown) {
      if (hasBackfilledContent(card)) skippedBackfilledOnly.push(node.id);
      else skippedEmptyContent.push(node.id);
      continue;
    }

    const evidenceRows = collectEvidenceForModelBody({
      card,
      mentions: mentionsByNode.get(node.id) ?? [],
      evidenceById,
      evidenceByAnchor,
      maxEvidence,
    });
    if (evidenceRows.length === 0) {
      skippedMissingSourceRefs.push(node.id);
      continue;
    }

    tasks.push({
      datasetId: input.datasetId,
      node,
      card,
      cardMarkdown,
      evidenceRows,
      allowedEvidenceIds: new Set(evidenceRows.map((row) => row.id)),
      modelName: input.modelName,
      now: input.now,
    });
  }

  const taskResults = await mapWithConcurrency(tasks, input.concurrency ?? 8, async (task) => {
    try {
      const generated = await input.generateBody({
        datasetId: task.datasetId,
        node: task.node,
        card: task.card,
        card_markdown: task.cardMarkdown,
        evidence: task.evidenceRows,
      });
      const content = textValue(generated.content);
      if (!content) return { kind: "skipped_empty" as const, nodeId: task.node.id };
      const sourceRefs = uniqueStrings(generated.source_refs).filter((id) => task.allowedEvidenceIds.has(id));
      if (sourceRefs.length === 0) {
        return {
          kind: "model_failure" as const,
          failure: { node_id: task.node.id, message: "Model output did not cite any provided evidence id." },
        };
      }
      return {
        kind: "row" as const,
        row: {
          dataset_id: task.datasetId,
          node_id: task.node.id,
          format: "markdown" as const,
          content,
          media_refs_json: Array.isArray(generated.media_refs) ? generated.media_refs.filter(isRecord) : [],
          source_refs_json: sourceRefs,
          generated_from: "model_generation" as const,
          properties_json: {
            source: "model_node_body",
            model: task.modelName,
            prompt_version: "node-body-writer-v1",
            card_title: textValue(task.card.title),
            evidence_count: task.evidenceRows.length,
            ...recordValue(generated.properties),
          },
          status: "active" as const,
          created_at: task.now,
          updated_at: task.now,
        },
      };
    } catch (error) {
      return { kind: "model_failure" as const, failure: { node_id: task.node.id, message: (error as Error).message } };
    }
  });

  for (const result of taskResults) {
    if (result.kind === "row") rows.push(result.row);
    else if (result.kind === "skipped_empty") skippedEmptyContent.push(result.nodeId);
    else modelFailures.push(result.failure);
  }

  return { rows, skippedExisting, skippedMissingSourceRefs, skippedEmptyContent, skippedBackfilledOnly, modelFailures };
}

type ModelNodeBodyTask = {
  datasetId: string;
  node: NodeBodyInputNodeRow;
  card: NodeCardBodyRow;
  cardMarkdown: string;
  evidenceRows: NodeBodyInputEvidenceRow[];
  allowedEvidenceIds: Set<string>;
  modelName: string;
  now: string;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!, index);
    }
  }));
  return results;
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
  nodeId?: string | null;
  bookId?: string | null;
  limit?: number | null;
  maxEvidencePerNode?: number | null;
  modelName?: string;
  concurrency?: number | null;
  overwriteExisting?: boolean;
  generateBody?: ModelNodeBodyGenerator;
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
  const plan = await planModelNodeBodies({
    datasetId: input.datasetId,
    nodes: (await query(buildSelectNodesForModelBodiesQuery({
      datasetId: input.datasetId,
      nodeId: input.nodeId,
      limit: input.limit,
      bookId: input.bookId,
      overwriteExisting: input.overwriteExisting,
    }))).map(toNodeBodyInputNodeRow),
    cards,
    existingBodies,
    mentions: (await query(buildSelectMentionsForModelBodiesQuery(input.datasetId, input.bookId ?? ""))).map(toNodeBodyInputMentionRow),
    evidence: (await query(buildSelectEvidenceForModelBodiesQuery(input.datasetId, input.bookId ?? ""))).map(toNodeBodyInputEvidenceRow),
    overwriteExisting: input.overwriteExisting,
    maxEvidencePerNode: input.maxEvidencePerNode ?? undefined,
    concurrency: input.concurrency ?? 8,
    modelName: input.modelName ?? "",
    generateBody: input.generateBody ?? missingModelGenerator,
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
    mode: "model",
    dataset_id: input.datasetId,
    selected: plan.rows.length + plan.skippedExisting.length + plan.skippedMissingSourceRefs.length + plan.skippedEmptyContent.length + plan.skippedBackfilledOnly.length + plan.modelFailures.length,
    generated: plan.rows.length,
    skipped_existing: plan.skippedExisting.length,
    skipped_missing_source_refs: plan.skippedMissingSourceRefs.length,
    skipped_empty_content: plan.skippedEmptyContent.length,
    skipped_backfilled_only: plan.skippedBackfilledOnly.length,
    failed_model_generation: plan.modelFailures.length,
    model_failures: plan.modelFailures,
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

function pushParagraph(lines: string[], emittedParagraphs: Set<string>, item: string): void {
  if (emittedParagraphs.has(item)) return;
  lines.push(item);
  lines.push("");
  emittedParagraphs.add(item);
}

function usableBodySections(card: NodeCardBodyRow): RawRecord[] {
  const sections = Array.isArray(card.sections_json) ? card.sections_json.filter(isRecord) : [];
  return sections.filter((section) => !isBackfilledSection(section));
}

function isBackfilledCard(card: NodeCardBodyRow): boolean {
  return hasBackfilledMarker(card.properties_json);
}

function isBackfilledSection(section: RawRecord): boolean {
  return hasBackfilledMarker(section.properties);
}

function hasBackfilledContent(card: NodeCardBodyRow): boolean {
  if (isBackfilledCard(card)) return true;
  const sections = Array.isArray(card.sections_json) ? card.sections_json.filter(isRecord) : [];
  return sections.some(isBackfilledSection);
}

function collectEvidenceForModelBody(input: {
  card: NodeCardBodyRow;
  mentions: NodeBodyInputMentionRow[];
  evidenceById: Map<string, NodeBodyInputEvidenceRow>;
  evidenceByAnchor: Map<string, NodeBodyInputEvidenceRow[]>;
  maxEvidence: number;
}): NodeBodyInputEvidenceRow[] {
  const ids = new Set<string>();
  for (const id of collectModelBodySourceRefs(input.card)) ids.add(id);
  for (const mention of input.mentions) {
    for (const id of uniqueStrings(Array.isArray(mention.source_refs_json) ? mention.source_refs_json : [])) ids.add(id);
    for (const row of input.evidenceByAnchor.get(`${mention.source_id}:${mention.anchor_ref}`) ?? []) ids.add(row.id);
  }
  const rows = [...ids].map((id) => input.evidenceById.get(id)).filter((row): row is NodeBodyInputEvidenceRow => Boolean(row));
  return rows.slice(0, Math.max(1, input.maxEvidence));
}

function hasBackfilledMarker(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const marker = value.backfilled;
  return marker === true || marker === "true";
}

function toNodeBodyInputNodeRow(row: RawRecord): NodeBodyInputNodeRow {
  return {
    id: requiredString(row.id, "id"),
    name: requiredString(row.name, "name"),
    kind: requiredString(row.kind, "kind"),
    subkind: optionalString(row.subkind),
    definition: requiredString(row.definition, "definition"),
    aliases_json: row.aliases_json,
    domains_json: row.domains_json,
    knowledge_form_json: row.knowledge_form_json,
    learning_mode_json: row.learning_mode_json,
    scope: optionalString(row.scope),
    properties_json: row.properties_json,
    tags_json: row.tags_json,
  };
}

function toNodeBodyInputMentionRow(row: RawRecord): NodeBodyInputMentionRow {
  return {
    target_id: requiredString(row.target_id, "target_id"),
    source_id: requiredString(row.source_id, "source_id"),
    anchor_ref: requiredString(row.anchor_ref, "anchor_ref"),
    source_refs_json: row.source_refs_json,
  };
}

function toNodeBodyInputEvidenceRow(row: RawRecord): NodeBodyInputEvidenceRow {
  return {
    id: requiredString(row.id, "id"),
    source_type: requiredString(row.source_type, "source_type"),
    source_id: requiredString(row.source_id, "source_id"),
    anchor_ref: requiredString(row.anchor_ref, "anchor_ref"),
    source_path: optionalString(row.source_path),
    page_start: optionalNumber(row.page_start),
    page_end: optionalNumber(row.page_end),
    excerpt: requiredString(row.excerpt, "excerpt"),
    locator: requiredString(row.locator, "locator"),
    modality: optionalString(row.modality),
    normalized_claims_json: row.normalized_claims_json,
    properties_json: row.properties_json,
  };
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

function recordValue(value: unknown): RawRecord {
  return isRecord(value) ? value : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function truncateText(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
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

function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function missingModelGenerator(): never {
  throw new Error("Model body generation requires a generateBody implementation.");
}

function assertRecordRows(name: string, rows: unknown): asserts rows is RawRecord[] {
  if (!Array.isArray(rows) || !rows.every(isRecord)) {
    throw new Error(`Query '${name}' must return an array of objects.`);
  }
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
