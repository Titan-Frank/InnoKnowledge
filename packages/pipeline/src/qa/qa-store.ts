import type { SqlStatement } from "../staging/staging-sql.js";
import { checkGraphIntegrity, type GraphIntegrityResult } from "./graph-integrity.js";
import { runStrictQa, type StrictQaResult, type StrictQaRows } from "./strict-qa.js";

type RawRecord = Record<string, unknown>;

export type QaSqlQueryExecutor = (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];
export type QaSqlExecutor = (statement: SqlStatement) => Promise<void> | void;

export type StrictQaDatabaseOutput = StrictQaResult & {
  dataset_id: string;
  read_statements: string[];
};

export type GraphIntegrityDatabaseOutput = GraphIntegrityResult & {
  dataset_id: string;
  read_statements: string[];
  statements: string[];
  executedStatements: string[];
};

export type QaLessonRunFilter = {
  bookId?: string | null;
  lessonRunIds?: string[];
  batchAnchors?: string[];
};

export async function runStrictQaFromDatabase(input: {
  datasetId: string;
  bookId?: string | null;
  query: QaSqlQueryExecutor;
}): Promise<StrictQaDatabaseOutput> {
  const readStatements: string[] = [];
  const query = async (statement: SqlStatement): Promise<RawRecord[]> => {
    readStatements.push(statement.name);
    const rows = await input.query(statement);
    assertRecordRows(statement.name, rows);
    return rows;
  };
  const rows: StrictQaRows = {
    nodes: (await query(buildSelectQaNodesQuery(input.datasetId))).map(toStrictQaNode),
    edges: (await query(buildSelectQaEdgesQuery(input.datasetId))).map(toStrictQaEdge),
    domain_profiles: (await query(buildSelectQaDomainProfilesQuery(input.datasetId))).map(toStrictQaDomainProfile),
    mentions: (await query(buildSelectQaMentionsQuery(input.datasetId))).map(toStrictQaMention),
    evidence: (await query(buildSelectQaEvidenceQuery(input.datasetId))).map(toStrictQaEvidence),
    node_cards: (await query(buildSelectQaNodeCardsQuery(input.datasetId))).map(toStrictQaNodeCard),
    node_bodies: (await query(buildSelectQaNodeBodiesQuery(input.datasetId))).map(toStrictQaNodeBody),
  };
  const result = runStrictQa(rows);
  const scopedNodeIds = input.bookId
    ? new Set((await query(buildSelectQaBookNodeIdsQuery(input.datasetId, input.bookId))).map((row) => String(row.id ?? "")).filter(Boolean))
    : null;
  const scopedResult = scopedNodeIds ? filterStrictQaResult(result, rows, scopedNodeIds) : result;
  return {
    dataset_id: input.datasetId,
    read_statements: readStatements,
    ...scopedResult,
  };
}

export async function runGraphIntegrityFromDatabase(input: {
  datasetId: string;
  failOnCycles?: boolean;
  markQaPassed?: boolean;
  lessonRunFilter?: QaLessonRunFilter;
  now?: string | null;
  query: QaSqlQueryExecutor;
  executeStatement?: QaSqlExecutor;
}): Promise<GraphIntegrityDatabaseOutput> {
  if (input.markQaPassed && !input.executeStatement) {
    throw new Error("Marking QA passed requires an executeStatement executor.");
  }
  const readStatements: string[] = [];
  const query = async (statement: SqlStatement): Promise<RawRecord[]> => {
    readStatements.push(statement.name);
    const rows = await input.query(statement);
    assertRecordRows(statement.name, rows);
    return rows;
  };
  const nodes = (await query(buildSelectGraphNodesQuery(input.datasetId))).map(toGraphNode);
  const edges = (await query(buildSelectGraphEdgesQuery(input.datasetId))).map(toGraphEdge);
  const result = checkGraphIntegrity(nodes, edges, { failOnCycles: input.failOnCycles });
  const statements =
    result.status === "success" && input.markQaPassed
      ? buildMarkQaPassedStatements({
          datasetId: input.datasetId,
          now: input.now || new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
          filter: input.lessonRunFilter ?? {},
        })
      : [];
  const executedStatements: string[] = [];
  for (const statement of statements) {
    await input.executeStatement!(statement);
    executedStatements.push(statement.name);
  }
  return {
    dataset_id: input.datasetId,
    read_statements: readStatements,
    statements: statements.map((statement) => statement.name),
    executedStatements,
    ...result,
  };
}

export function buildSelectQaNodesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-strict-qa-nodes",
    sql: "SELECT id, kind, name, definition, domains_json, learning_mode_json FROM world_nodes WHERE dataset_id = $1 AND status != 'deprecated' ORDER BY id",
    params: [datasetId],
  };
}

export function buildSelectQaEdgesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-strict-qa-edges",
    sql: "SELECT id, type, directionality, from_id, to_id, source_refs_json FROM world_edges WHERE dataset_id = $1 AND status != 'deprecated' ORDER BY id",
    params: [datasetId],
  };
}

export function buildSelectQaDomainProfilesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-strict-qa-domain-profiles",
    sql: "SELECT id, node_id, domain, school_stages_json, curriculum_roles_json, source_refs_json, properties_json FROM world_domain_profiles WHERE dataset_id = $1 AND status != 'deprecated' ORDER BY id",
    params: [datasetId],
  };
}

export function buildSelectQaMentionsQuery(datasetId: string): SqlStatement {
  return {
    name: "select-strict-qa-mentions",
    sql: "SELECT id, target_id, source_refs_json FROM world_mentions WHERE dataset_id = $1 ORDER BY id",
    params: [datasetId],
  };
}

export function buildSelectQaEvidenceQuery(datasetId: string): SqlStatement {
  return {
    name: "select-strict-qa-evidence",
    sql: "SELECT id FROM world_evidence WHERE dataset_id = $1 ORDER BY id",
    params: [datasetId],
  };
}

export function buildSelectQaNodeCardsQuery(datasetId: string): SqlStatement {
  return {
    name: "select-strict-qa-node-cards",
    sql: "SELECT node_id, summary, source_refs_json, sections_json FROM world_node_cards WHERE dataset_id = $1 AND status != 'deprecated' ORDER BY node_id",
    params: [datasetId],
  };
}

export function buildSelectQaNodeBodiesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-strict-qa-node-bodies",
    sql: "SELECT node_id, format, content, media_refs_json, source_refs_json, generated_from, status FROM world_node_bodies WHERE dataset_id = $1 AND status != 'deprecated' ORDER BY node_id",
    params: [datasetId],
  };
}

export function buildSelectQaBookNodeIdsQuery(datasetId: string, bookId: string): SqlStatement {
  return {
    name: "select-strict-qa-book-node-ids",
    sql: [
      "SELECT DISTINCT mention.target_id AS id",
      "FROM world_mentions AS mention",
      "JOIN LATERAL jsonb_array_elements_text(mention.source_refs_json) AS mention_ref(evidence_id) ON true",
      "JOIN world_evidence AS evidence",
      "  ON evidence.dataset_id = mention.dataset_id",
      " AND evidence.id = mention_ref.evidence_id",
      "WHERE mention.dataset_id = $1",
      "  AND mention.target_type = 'node'",
      "  AND evidence.source_id = $2",
      "ORDER BY id",
    ].join("\n"),
    params: [datasetId, bookId],
  };
}

function filterStrictQaResult(result: StrictQaResult, rows: StrictQaRows, nodeIds: Set<string>): StrictQaResult {
  const edgeIds = new Set(rows.edges.filter((row) => nodeIds.has(row.from_id) || nodeIds.has(row.to_id)).map((row) => row.id));
  const profileIds = new Set(rows.domain_profiles.filter((row) => nodeIds.has(row.node_id)).map((row) => row.id));
  const inScope = (issue: StrictQaResult["errors"][number]): boolean => {
    if (issue.category === "edge") return edgeIds.has(issue.id);
    if (issue.category === "domain_profile") return nodeIds.has(issue.id) || profileIds.has(issue.id);
    if (issue.category === "pedagogical_profile") {
      return [...profileIds].some((profileId) => issue.id === profileId || issue.id.startsWith(`${profileId}:`));
    }
    return nodeIds.has(issue.id);
  };
  const errors = result.errors.filter(inScope);
  const warnings = result.warnings.filter(inScope);
  return { status: errors.length === 0 ? "success" : "blocked", errors, warnings };
}

export function buildSelectGraphNodesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-graph-integrity-nodes",
    sql: "SELECT id, name, kind, status FROM world_nodes WHERE dataset_id = $1 ORDER BY id",
    params: [datasetId],
  };
}

export function buildSelectGraphEdgesQuery(datasetId: string): SqlStatement {
  return {
    name: "select-graph-integrity-edges",
    sql: "SELECT id, type, from_id, to_id, status FROM world_edges WHERE dataset_id = $1 ORDER BY id",
    params: [datasetId],
  };
}

export function buildMarkQaPassedStatements(input: { datasetId: string; now: string; filter: QaLessonRunFilter }): SqlStatement[] {
  if (input.filter.lessonRunIds && input.filter.lessonRunIds.length > 0) {
    return [
      {
        name: "mark-explicit-world-lesson-runs-qa-passed",
        sql: "UPDATE world_lesson_runs SET status = 'qa_passed', updated_at = $1 WHERE dataset_id = $2 AND lesson_run_id = ANY($3)",
        params: [input.now, input.datasetId, input.filter.lessonRunIds],
      },
    ];
  }
  const params: unknown[] = [input.now, input.datasetId];
  const filters = ["dataset_id = $2", "status = 'merged'"];
  if (input.filter.bookId) {
    params.push(input.filter.bookId);
    filters.push(`book_id = $${params.length}`);
  }
  if (input.filter.batchAnchors && input.filter.batchAnchors.length > 0) {
    params.push(input.filter.batchAnchors);
    filters.push(`batch_anchor = ANY($${params.length})`);
  }
  return [
    {
      name: "mark-selected-world-lesson-runs-qa-passed",
      sql: `UPDATE world_lesson_runs SET status = 'qa_passed', updated_at = $1 WHERE ${filters.join(" AND ")}`,
      params,
    },
  ];
}

function toStrictQaNode(row: RawRecord): StrictQaRows["nodes"][number] {
  return {
    id: requiredString(row.id, "id"),
    kind: requiredString(row.kind, "kind"),
    name: optionalString(row.name),
    definition: optionalString(row.definition),
    domains_json: row.domains_json,
    learning_mode_json: row.learning_mode_json,
  };
}

function toStrictQaEdge(row: RawRecord): StrictQaRows["edges"][number] {
  return {
    id: requiredString(row.id, "id"),
    type: requiredString(row.type, "type"),
    directionality: requiredString(row.directionality, "directionality"),
    from_id: requiredString(row.from_id, "from_id"),
    to_id: requiredString(row.to_id, "to_id"),
    source_refs_json: row.source_refs_json,
  };
}

function toStrictQaDomainProfile(row: RawRecord): StrictQaRows["domain_profiles"][number] {
  return {
    id: requiredString(row.id, "id"),
    node_id: requiredString(row.node_id, "node_id"),
    domain: requiredString(row.domain, "domain"),
    school_stages_json: row.school_stages_json,
    curriculum_roles_json: row.curriculum_roles_json,
    source_refs_json: row.source_refs_json,
  };
}

function toStrictQaMention(row: RawRecord): StrictQaRows["mentions"][number] {
  return {
    id: requiredString(row.id, "id"),
    target_id: requiredString(row.target_id, "target_id"),
    source_refs_json: row.source_refs_json,
  };
}

function toStrictQaEvidence(row: RawRecord): StrictQaRows["evidence"][number] {
  return { id: requiredString(row.id, "id") };
}

function toStrictQaNodeCard(row: RawRecord): StrictQaRows["node_cards"][number] {
  return {
    node_id: requiredString(row.node_id, "node_id"),
    summary: optionalString(row.summary),
    source_refs_json: row.source_refs_json,
    sections_json: row.sections_json,
  };
}

function toStrictQaNodeBody(row: RawRecord): NonNullable<StrictQaRows["node_bodies"]>[number] {
  return {
    node_id: requiredString(row.node_id, "node_id"),
    format: requiredString(row.format, "format"),
    content: optionalString(row.content),
    media_refs_json: row.media_refs_json,
    source_refs_json: row.source_refs_json,
    generated_from: optionalString(row.generated_from),
    status: optionalString(row.status),
  };
}

function toGraphNode(row: RawRecord) {
  return {
    id: requiredString(row.id, "id"),
    name: requiredString(row.name, "name"),
    kind: requiredString(row.kind, "kind"),
    status: optionalString(row.status),
  };
}

function toGraphEdge(row: RawRecord) {
  return {
    id: requiredString(row.id, "id"),
    type: requiredString(row.type, "type"),
    from_id: requiredString(row.from_id, "from_id"),
    to_id: requiredString(row.to_id, "to_id"),
    status: optionalString(row.status),
  };
}

function assertRecordRows(name: string, rows: unknown): asserts rows is RawRecord[] {
  if (!Array.isArray(rows) || !rows.every(isRecord)) {
    throw new Error(`Query '${name}' must return an array of objects.`);
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required field '${name}'.`);
  return value;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  return String(value);
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
