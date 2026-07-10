import { VALID_EDGE_TYPES, VALID_NODE_KINDS } from "../shared/knowledge.js";
import type { SqlStatement } from "./staging-sql.js";
import type {
  LessonRunRow,
  StagingDomainProfileRow,
  StagingEdgeRow,
  StagingEvidenceRow,
  StagingMentionRow,
  StagingNodeCardRow,
  StagingNodeRow,
  StagingTableRows,
} from "./staging-rows.js";

type RawRecord = Record<string, unknown>;

export const REQUIRED_CARD_SECTIONS = new Set(["definition", "essence", "key_points", "example", "application", "misconception"]);

const STRUCTURAL_TITLE_PATTERNS = [
  /^第[\d一二三四五六七八九十百千万]+[章节课单元]/,
  /^(本节小结|章末小结|单元小结|复习|练习|习题|单元检测|实验活动|探究活动|活动与探究|观察与思考|思考与讨论|资料卡片|阅读材料|科学史话|你知道吗)/,
  /^(chapter|unit|section|lesson|review|exercise)\b/i,
];

const ASSESSMENT_TITLE_PATTERNS = [
  /^(考点|题型|专题|中考|高考|选择题|填空题|判断题|实验题|计算题|综合题|易错题)/,
  /^(exam point|question type|exercise type)\b/i,
];

export type LessonStagingQualityResult = {
  lesson_run_id: string;
  status: "success" | "blocked";
  errors: string[];
  warnings: string[];
  quality_review_required: boolean;
  review_node_ids: string[];
  counts: {
    nodes: number;
    edges: number;
    domain_profiles: number;
    mentions: number;
    evidence: number;
    node_cards: number;
  };
};

export function checkLessonStagingQuality(rows: StagingTableRows): LessonStagingQualityResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const reviewNodeIds = new Set<string>();
  const nodeIds = new Set(rows.nodes.map((row) => row.raw_node_id));
  const evidenceIds = new Set(rows.evidence.map((row) => row.raw_evidence_id));
  const qualityEvidenceIds = new Set(rows.evidence.filter((row) => !isQualityExcludedEvidence(row)).map((row) => row.raw_evidence_id));
  const profileNodeIds = new Set(rows.domain_profiles.map((row) => row.raw_node_id));
  const cardByNode = new Map(rows.node_cards.map((row) => [row.raw_node_id, row]));
  const mentionByTarget = new Map<string, typeof rows.mentions>();
  const connectedNodeIds = new Set<string>();

  for (const edge of rows.edges) {
    connectedNodeIds.add(edge.from_raw_node_id);
    connectedNodeIds.add(edge.to_raw_node_id);
  }

  for (const mention of rows.mentions) {
    const mentions = mentionByTarget.get(mention.target_raw_id) ?? [];
    mentions.push(mention);
    mentionByTarget.set(mention.target_raw_id, mentions);
  }

  const lessonProperties = rows.lesson_run.properties_json ?? {};
  const lessonDisposition = typeof lessonProperties.lesson_disposition === "string" ? lessonProperties.lesson_disposition : "";
  const noKnowledgeReason = typeof lessonProperties.no_knowledge_reason === "string" ? lessonProperties.no_knowledge_reason.trim() : "";
  const artifactCount = rows.nodes.length
    + rows.edges.length
    + rows.domain_profiles.length
    + rows.mentions.length
    + rows.evidence.length
    + rows.node_cards.length;
  if (lessonDisposition === "no_knowledge") {
    if (!noKnowledgeReason) {
      errors.push("Lesson marked no_knowledge is missing no_knowledge_reason.");
    }
    if (artifactCount > 0) {
      errors.push("Lesson marked no_knowledge must have no staged knowledge artifacts.");
    }
  } else {
    if (lessonDisposition && lessonDisposition !== "extracted") {
      errors.push(`Lesson has invalid lesson_disposition ${lessonDisposition}.`);
    }
    if (rows.nodes.length === 0) {
      errors.push("Lesson produced no staged nodes.");
    }
    if (rows.evidence.length === 0) {
      errors.push("Lesson produced no staged evidence.");
    }
  }

  for (const evidence of rows.evidence) {
    if (!isQualityExcludedEvidence(evidence)) continue;
    warnings.push(`Evidence ${evidence.raw_evidence_id} is synthetic or quality-excluded and requires review.`);
  }

  for (const node of rows.nodes) {
    const nodeId = node.raw_node_id;
    if (!VALID_NODE_KINDS.has(node.kind)) {
      errors.push(`Node ${nodeId} has invalid kind ${node.kind}.`);
    }
    if (!node.definition) {
      errors.push(`Node ${nodeId} is missing definition.`);
    }
    if (!profileNodeIds.has(nodeId)) {
      errors.push(`Node ${nodeId} is missing a domain profile.`);
    }
    if (!cardByNode.has(nodeId)) {
      errors.push(`Node ${nodeId} is missing a node card.`);
    }
    if (!mentionByTarget.has(nodeId)) {
      errors.push(`Node ${nodeId} is missing a mention.`);
    }

    const mentionRefs = (mentionByTarget.get(nodeId) ?? []).flatMap((mention) => mention.source_refs_json ?? []);
    const nodeEvidenceRefs = [...node.source_refs_json, ...mentionRefs];
    if (!hasQualityEvidenceRef(nodeEvidenceRefs, qualityEvidenceIds)) {
      errors.push(`Node ${nodeId} has no evidence-backed source reference.`);
    }
    if (nodeEvidenceRefs.some((ref) => evidenceIds.has(ref) && !qualityEvidenceIds.has(ref))) reviewNodeIds.add(nodeId);

    const admissionWarnings = nodeAdmissionWarnings(node, connectedNodeIds, rows.edges.length);
    warnings.push(...admissionWarnings);
    if (admissionWarnings.length > 0) reviewNodeIds.add(nodeId);
  }

  for (const edge of rows.edges) {
    if (!VALID_EDGE_TYPES.has(edge.type)) {
      errors.push(`Edge ${edge.raw_edge_id} has invalid type ${edge.type}.`);
    }
    if (edge.directionality !== "directed" && edge.directionality !== "undirected") {
      errors.push(`Edge ${edge.raw_edge_id} has invalid directionality ${edge.directionality}.`);
    }
    if (!nodeIds.has(edge.from_raw_node_id) || !nodeIds.has(edge.to_raw_node_id)) {
      errors.push(`Edge ${edge.raw_edge_id} references missing node endpoint.`);
    }
    if (!hasQualityEvidenceRef(edge.source_refs_json, qualityEvidenceIds)) {
      errors.push(`Edge ${edge.raw_edge_id} has no evidence source_refs.`);
    }
    if (edge.source_refs_json.some((ref) => evidenceIds.has(ref) && !qualityEvidenceIds.has(ref))) {
      reviewNodeIds.add(edge.from_raw_node_id);
      reviewNodeIds.add(edge.to_raw_node_id);
    }
  }

  for (const profile of rows.domain_profiles) {
    if (!nodeIds.has(profile.raw_node_id)) {
      errors.push(`Domain profile ${profile.raw_profile_id} references missing node.`);
    }
    if (profile.source_refs_json.length === 0) {
      warnings.push(`Domain profile ${profile.raw_profile_id} has no source_refs.`);
      reviewNodeIds.add(profile.raw_node_id);
    } else if (!hasQualityEvidenceRef(profile.source_refs_json, qualityEvidenceIds)) {
      warnings.push(`Domain profile ${profile.raw_profile_id} has no quality-eligible source_refs.`);
      reviewNodeIds.add(profile.raw_node_id);
    }
  }

  for (const mention of rows.mentions) {
    if (mention.target_type === "node" && !nodeIds.has(mention.target_raw_id)) {
      errors.push(`Mention ${mention.raw_mention_id} references missing node.`);
    }
    for (const ref of mention.source_refs_json) {
      if (!evidenceIds.has(ref)) {
        errors.push(`Mention ${mention.raw_mention_id} references missing evidence ${ref}.`);
      } else if (!qualityEvidenceIds.has(ref)) {
        errors.push(`Mention ${mention.raw_mention_id} references quality-excluded evidence ${ref}.`);
        if (mention.target_type === "node") reviewNodeIds.add(mention.target_raw_id);
      }
    }
  }

  for (const card of rows.node_cards) {
    if (!nodeIds.has(card.raw_node_id)) {
      errors.push(`Node card ${card.raw_card_id} references missing node.`);
    }
    if (!card.summary) {
      errors.push(`Node card ${card.raw_card_id} is missing summary.`);
    }
    const sectionTypes = new Set(card.sections_json.map((section) => section.section_type));
    const missing = [...REQUIRED_CARD_SECTIONS].filter((section) => !sectionTypes.has(section)).sort();
    if (missing.length > 0) {
      errors.push(`Node card ${card.raw_card_id} missing sections: ${formatPythonStringList(missing)}.`);
    }
    for (const section of card.sections_json) {
      if (section.source_refs.length === 0) {
        errors.push(`Node card ${card.raw_card_id} section ${section.id} has no evidence source_refs.`);
      } else if (!hasQualityEvidenceRef(section.source_refs, qualityEvidenceIds)) {
        errors.push(`Node card ${card.raw_card_id} section ${section.id} has no quality-eligible evidence source_refs.`);
        reviewNodeIds.add(card.raw_node_id);
      }
    }
  }

  return {
    lesson_run_id: rows.lesson_run.lesson_run_id,
    status: errors.length > 0 ? "blocked" : "success",
    errors,
    warnings,
    quality_review_required: warnings.length > 0,
    review_node_ids: [...reviewNodeIds].sort(),
    counts: rows.lesson_run.counts_json,
  };
}

function isQualityExcludedEvidence(row: StagingEvidenceRow): boolean {
  const properties = row.properties_json ?? {};
  return properties.synthetic === true || properties.quality_excluded === true;
}

function hasQualityEvidenceRef(refs: string[], qualityEvidenceIds: Set<string>): boolean {
  return refs.some((ref) => qualityEvidenceIds.has(ref));
}

function formatPythonStringList(values: string[]): string {
  return `[${values.map((value) => `'${value}'`).join(", ")}]`;
}

function nodeAdmissionWarnings(node: StagingNodeRow, connectedNodeIds: Set<string>, edgeCount: number): string[] {
  const warnings: string[] = [];
  const name = node.name.trim();
  if (name.length <= 1) {
    warnings.push(`Node ${node.raw_node_id} name is too short to be a stable knowledge identity.`);
  }
  if (STRUCTURAL_TITLE_PATTERNS.some((pattern) => pattern.test(name))) {
    warnings.push(`Node ${node.raw_node_id} looks like a directory heading or textbook column; review node admission policy.`);
  }
  if (ASSESSMENT_TITLE_PATTERNS.some((pattern) => pattern.test(name))) {
    warnings.push(`Node ${node.raw_node_id} looks like an assessment label rather than a knowledge object; review node admission policy.`);
  }
  if (edgeCount > 0 && !connectedNodeIds.has(node.raw_node_id)) {
    warnings.push(`Node ${node.raw_node_id} has no staged relations; review relation potential before activation.`);
  }
  return warnings;
}

export type StagingQualityQueryExecutor = (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];
export type StagingQualityExecutor = (statement: SqlStatement) => Promise<void> | void;

export type StagingQualityFilter = {
  bookId?: string | null;
  lessonRunIds?: string[];
  batchAnchors?: string[];
};

export type StagingQualityDatabaseOutput = {
  status: "success" | "blocked";
  dataset_id: string;
  checked: number;
  blocked: number;
  results: LessonStagingQualityResult[];
  read_statements: string[];
  statements: string[];
  executedStatements: string[];
};

export async function runStagingQualityFromDatabase(input: {
  datasetId: string;
  filter?: StagingQualityFilter;
  warnOnly?: boolean;
  now?: string | null;
  query: StagingQualityQueryExecutor;
  executeStatement?: StagingQualityExecutor;
}): Promise<StagingQualityDatabaseOutput> {
  const readStatements: string[] = [];
  const query = async (statement: SqlStatement): Promise<RawRecord[]> => {
    readStatements.push(statement.name);
    const rows = await input.query(statement);
    assertRecordRows(statement.name, rows);
    return rows;
  };

  const lessonRuns = await query(buildSelectStagedLessonRunsQuery(input.datasetId, input.filter ?? {}));
  const results: LessonStagingQualityResult[] = [];
  for (const lessonRun of lessonRuns) {
    const lessonRunId = requiredString(lessonRun.lesson_run_id, "lesson_run_id");
    const rows = await fetchStagingRowsForLesson({ datasetId: input.datasetId, lessonRun, lessonRunId, query });
    results.push(checkLessonStagingQuality(rows));
  }

  const blockedResults = results.filter((result) => result.status === "blocked");
  const successfulResults = results.filter((result) => result.status === "success");
  const now = input.now ?? defaultNow();
  const statements = input.warnOnly
    ? []
    : [
      ...buildPersistQualityStatements(input.datasetId, successfulResults, now),
      ...buildMarkBlockedStatements(input.datasetId, blockedResults, now),
    ];
  const executedStatements: string[] = [];
  if (statements.length > 0) {
    if (!input.executeStatement) throw new Error("Executing staging quality updates requires an executeStatement executor.");
    for (const statement of statements) {
      await input.executeStatement(statement);
      executedStatements.push(statement.name);
    }
  }

  return {
    status: blockedResults.length > 0 && !input.warnOnly ? "blocked" : "success",
    dataset_id: input.datasetId,
    checked: results.length,
    blocked: blockedResults.length,
    results,
    read_statements: readStatements,
    statements: statements.map((statement) => statement.name),
    executedStatements,
  };
}

export function buildSelectStagedLessonRunsQuery(datasetId: string, filter: StagingQualityFilter): SqlStatement {
  const params: unknown[] = [datasetId];
  const clauses = ["dataset_id = $1", "status = 'staged'"];
  if (filter.bookId) {
    params.push(filter.bookId);
    clauses.push(`book_id = $${params.length}`);
  }
  if (filter.lessonRunIds && filter.lessonRunIds.length > 0) {
    params.push(filter.lessonRunIds);
    clauses.push(`lesson_run_id = ANY($${params.length})`);
  }
  if (filter.batchAnchors && filter.batchAnchors.length > 0) {
    params.push(filter.batchAnchors);
    clauses.push(`batch_anchor = ANY($${params.length})`);
  }
  return {
    name: "select-staging-quality-lesson-runs",
    sql: `SELECT * FROM world_lesson_runs WHERE ${clauses.join(" AND ")} ORDER BY created_at, lesson_run_id`,
    params,
  };
}

export function buildSelectStagingRowsQuery(input: { table: StagingQualityTable; datasetId: string; lessonRunId: string }): SqlStatement {
  return {
    name: `select-staging-quality-${input.table}`,
    sql: `SELECT * FROM ${input.table} WHERE dataset_id = $1 AND lesson_run_id = $2 ORDER BY created_at`,
    params: [input.datasetId, input.lessonRunId],
  };
}

export function buildMarkBlockedStatements(datasetId: string, results: LessonStagingQualityResult[], now: string): SqlStatement[] {
  return results.map((result) => ({
    name: `mark-staging-quality-blocked-${result.lesson_run_id}`,
    sql: [
      "UPDATE world_lesson_runs",
      "SET status = 'blocked',",
      ...buildQualityPropertiesAssignment(),
      "updated_at = $5",
      "WHERE dataset_id = $6 AND lesson_run_id = $7",
    ].join("\n"),
    params: qualityStatementParams(result, now, datasetId),
  }));
}

export function buildPersistQualityStatements(datasetId: string, results: LessonStagingQualityResult[], now: string): SqlStatement[] {
  return results.map((result) => ({
    name: `persist-staging-quality-${result.lesson_run_id}`,
    sql: [
      "UPDATE world_lesson_runs",
      "SET",
      ...buildQualityPropertiesAssignment(),
      "updated_at = $5",
      "WHERE dataset_id = $6 AND lesson_run_id = $7",
    ].join("\n"),
    params: qualityStatementParams(result, now, datasetId),
  }));
}

function buildQualityPropertiesAssignment(): string[] {
  return [
    "properties_json = (",
    "  CASE",
    "    WHEN jsonb_typeof(COALESCE(properties_json, '{}'::jsonb)) = 'object' THEN COALESCE(properties_json, '{}'::jsonb)",
    "    ELSE '{}'::jsonb",
    "  END",
    ") || jsonb_build_object(",
    "  'quality_issues', $1::jsonb,",
    "  'quality_warnings', $2::jsonb,",
    "  'quality_review_required', $3::boolean,",
    "  'review_node_ids', $4::jsonb",
    "),",
  ];
}

function qualityStatementParams(result: LessonStagingQualityResult, now: string, datasetId: string): unknown[] {
  return [
    JSON.stringify(result.errors),
    JSON.stringify(result.warnings),
    result.quality_review_required,
    JSON.stringify(result.review_node_ids),
    now,
    datasetId,
    result.lesson_run_id,
  ];
}

type StagingQualityTable =
  | "world_staging_nodes"
  | "world_staging_edges"
  | "world_staging_domain_profiles"
  | "world_staging_mentions"
  | "world_staging_evidence"
  | "world_staging_node_cards";

async function fetchStagingRowsForLesson(input: {
  datasetId: string;
  lessonRun: RawRecord;
  lessonRunId: string;
  query: (statement: SqlStatement) => Promise<RawRecord[]>;
}): Promise<StagingTableRows> {
  const nodes = (await input.query(buildSelectStagingRowsQuery({ table: "world_staging_nodes", datasetId: input.datasetId, lessonRunId: input.lessonRunId }))).map(toStagingNodeRow);
  const edges = (await input.query(buildSelectStagingRowsQuery({ table: "world_staging_edges", datasetId: input.datasetId, lessonRunId: input.lessonRunId }))).map(toStagingEdgeRow);
  const domainProfiles = (
    await input.query(buildSelectStagingRowsQuery({ table: "world_staging_domain_profiles", datasetId: input.datasetId, lessonRunId: input.lessonRunId }))
  ).map(toStagingDomainProfileRow);
  const mentions = (await input.query(buildSelectStagingRowsQuery({ table: "world_staging_mentions", datasetId: input.datasetId, lessonRunId: input.lessonRunId }))).map(toStagingMentionRow);
  const evidence = (await input.query(buildSelectStagingRowsQuery({ table: "world_staging_evidence", datasetId: input.datasetId, lessonRunId: input.lessonRunId }))).map(toStagingEvidenceRow);
  const nodeCards = (await input.query(buildSelectStagingRowsQuery({ table: "world_staging_node_cards", datasetId: input.datasetId, lessonRunId: input.lessonRunId }))).map(toStagingNodeCardRow);
  return {
    lesson_run: toLessonRunRow(input.lessonRun, {
      nodes: nodes.length,
      edges: edges.length,
      domain_profiles: domainProfiles.length,
      mentions: mentions.length,
      evidence: evidence.length,
      node_cards: nodeCards.length,
    }),
    nodes,
    edges,
    domain_profiles: domainProfiles,
    mentions,
    evidence,
    node_cards: nodeCards,
  };
}

function toLessonRunRow(row: RawRecord, counts: LessonRunRow["counts_json"]): LessonRunRow {
  return {
    dataset_id: requiredString(row.dataset_id, "dataset_id"),
    lesson_run_id: requiredString(row.lesson_run_id, "lesson_run_id"),
    book_id: requiredString(row.book_id, "book_id"),
    batch_anchor: requiredString(row.batch_anchor, "batch_anchor"),
    status: "staged",
    counts_json: counts,
    properties_json: isRecord(row.properties_json) ? row.properties_json : {},
    created_at: optionalString(row.created_at),
    updated_at: optionalString(row.updated_at),
  };
}

function toStagingNodeRow(row: RawRecord): StagingNodeRow {
  return {
    ...(row as StagingNodeRow),
    raw_node_id: requiredString(row.raw_node_id, "raw_node_id"),
    kind: requiredString(row.kind, "kind"),
    definition: optionalString(row.definition),
    source_refs_json: stringArray(row.source_refs_json),
  };
}

function toStagingEdgeRow(row: RawRecord): StagingEdgeRow {
  return {
    ...(row as StagingEdgeRow),
    raw_edge_id: requiredString(row.raw_edge_id, "raw_edge_id"),
    type: requiredString(row.type, "type"),
    from_raw_node_id: requiredString(row.from_raw_node_id, "from_raw_node_id"),
    to_raw_node_id: requiredString(row.to_raw_node_id, "to_raw_node_id"),
    source_refs_json: stringArray(row.source_refs_json),
  };
}

function toStagingDomainProfileRow(row: RawRecord): StagingDomainProfileRow {
  return {
    ...(row as StagingDomainProfileRow),
    raw_profile_id: requiredString(row.raw_profile_id, "raw_profile_id"),
    raw_node_id: requiredString(row.raw_node_id, "raw_node_id"),
    source_refs_json: stringArray(row.source_refs_json),
  };
}

function toStagingMentionRow(row: RawRecord): StagingMentionRow {
  return {
    ...(row as StagingMentionRow),
    raw_mention_id: requiredString(row.raw_mention_id, "raw_mention_id"),
    target_type: requiredString(row.target_type, "target_type"),
    target_raw_id: requiredString(row.target_raw_id, "target_raw_id"),
    source_refs_json: stringArray(row.source_refs_json),
  };
}

function toStagingEvidenceRow(row: RawRecord): StagingEvidenceRow {
  return {
    ...(row as StagingEvidenceRow),
    raw_evidence_id: requiredString(row.raw_evidence_id, "raw_evidence_id"),
  };
}

function toStagingNodeCardRow(row: RawRecord): StagingNodeCardRow {
  return {
    ...(row as StagingNodeCardRow),
    raw_card_id: requiredString(row.raw_card_id, "raw_card_id"),
    raw_node_id: requiredString(row.raw_node_id, "raw_node_id"),
    summary: optionalString(row.summary),
    sections_json: Array.isArray(row.sections_json) ? (row.sections_json as StagingNodeCardRow["sections_json"]) : [],
    source_refs_json: stringArray(row.source_refs_json),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required field '${name}'.`);
  return value;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
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
