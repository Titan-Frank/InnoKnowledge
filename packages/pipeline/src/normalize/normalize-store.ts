import { checkGraphIntegrity } from "../qa/graph-integrity.js";
import { planNodeTerms, type NodeTermsPlan } from "../shared/node-terms.js";
import type { SqlStatement } from "../staging/staging-sql.js";
import { normalizeNodeCardRows, type NodeCardLike } from "./normalize-cards.js";
import { planDomainProfileDeduplication, type CanonicalDomainProfileLike, type DomainProfileDeduplicationPlan } from "./normalize-domain-profiles.js";
import { planEdgeDeduplication, type CanonicalEdgeLike, type EdgeDeduplicationPlan } from "./normalize-edges.js";

type RawRecord = Record<string, unknown>;

export type NormalizeSqlQueryExecutor = (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];
export type NormalizeSqlExecutor = (statement: SqlStatement) => Promise<void> | void;

export type NormalizeDatabaseOutput = {
  status: "success";
  dataset_id: string;
  cards_updated: number;
  domain_profiles_deduplicated: number;
  edges_deduplicated: number;
  cycle_count: number;
  read_statements: string[];
  statements: string[];
  executedStatements: string[];
  node_terms: NodeTermsPlan;
  plans: {
    cards: ReturnType<typeof normalizeNodeCardRows>;
    domain_profiles: DomainProfileDeduplicationPlan;
    edges: EdgeDeduplicationPlan;
  };
};

export type RunNormalizeFromDatabaseInput = {
  datasetId: string;
  now?: string | null;
  query: NormalizeSqlQueryExecutor;
  executeStatement: NormalizeSqlExecutor;
};

export async function runNormalizeFromDatabase(input: RunNormalizeFromDatabaseInput): Promise<NormalizeDatabaseOutput> {
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

  const nodeCards = await query(buildSelectNodeCardsForNormalizeQuery(input.datasetId));
  const domainProfiles = await query(buildSelectDomainProfilesForNormalizeQuery(input.datasetId));
  const edges = await query(buildSelectEdgesForNormalizeQuery(input.datasetId));
  const nodes = await query(buildSelectNodesForNormalizeQuery(input.datasetId));
  const evidenceIds = new Set((await query(buildSelectEvidenceIdsForNormalizeQuery(input.datasetId))).map((row) => stringValue(row.id)).filter(Boolean));

  const cardPlan = normalizeNodeCardRows(nodeCards.map(toNodeCard));
  const domainProfilePlan = planDomainProfileDeduplication(domainProfiles.map(toDomainProfile), { existingEvidenceIds: evidenceIds });
  const edgePlan = planEdgeDeduplication(edges.map(toEdge));
  const graph = checkGraphIntegrity(nodes.map(toGraphNode), edges.map(toGraphEdge));
  const nodeTerms = planNodeTerms(input.datasetId, nodes);
  const statements = buildNormalizeSqlStatements({
    datasetId: input.datasetId,
    now,
    cardPlan,
    domainProfilePlan,
    edgePlan,
    nodeTerms,
  });

  const executedStatements: string[] = [];
  for (const statement of statements) {
    await input.executeStatement(statement);
    executedStatements.push(statement.name);
  }

  return {
    status: "success",
    dataset_id: input.datasetId,
    cards_updated: cardPlan.filter((card) => card.modified).length,
    domain_profiles_deduplicated: domainProfilePlan.merged_count,
    edges_deduplicated: edgePlan.deprecate.length,
    cycle_count: graph.cycles,
    read_statements: readStatements,
    statements: statements.map((statement) => statement.name),
    executedStatements,
    node_terms: nodeTerms,
    plans: {
      cards: cardPlan,
      domain_profiles: domainProfilePlan,
      edges: edgePlan,
    },
  };
}

export function buildSelectNodeCardsForNormalizeQuery(datasetId: string): SqlStatement {
  return {
    name: "select-normalize-node-cards",
    sql: "SELECT node_id, sections_json FROM world_node_cards WHERE dataset_id = $1 ORDER BY node_id",
    params: [datasetId],
  };
}

export function buildSelectDomainProfilesForNormalizeQuery(datasetId: string): SqlStatement {
  return {
    name: "select-normalize-domain-profiles",
    sql: ["SELECT *", "FROM world_domain_profiles", "WHERE dataset_id = $1 AND status != 'deprecated'", "ORDER BY created_at, id"].join("\n"),
    params: [datasetId],
  };
}

export function buildSelectEdgesForNormalizeQuery(datasetId: string): SqlStatement {
  return {
    name: "select-normalize-edges",
    sql: ["SELECT id, from_id, to_id, type, directionality, status, created_at", "FROM world_edges", "WHERE dataset_id = $1", "ORDER BY created_at, id"].join("\n"),
    params: [datasetId],
  };
}

export function buildSelectNodesForNormalizeQuery(datasetId: string): SqlStatement {
  return {
    name: "select-normalize-nodes",
    sql: ["SELECT id, name, kind, aliases_json, tags_json, status", "FROM world_nodes", "WHERE dataset_id = $1", "ORDER BY id"].join("\n"),
    params: [datasetId],
  };
}

export function buildSelectEvidenceIdsForNormalizeQuery(datasetId: string): SqlStatement {
  return {
    name: "select-normalize-evidence-ids",
    sql: ["SELECT id", "FROM world_evidence", "WHERE dataset_id = $1", "ORDER BY id"].join("\n"),
    params: [datasetId],
  };
}

export function buildNormalizeSqlStatements(input: {
  datasetId: string;
  now: string;
  cardPlan: ReturnType<typeof normalizeNodeCardRows>;
  domainProfilePlan: DomainProfileDeduplicationPlan;
  edgePlan: EdgeDeduplicationPlan;
  nodeTerms: NodeTermsPlan;
}): SqlStatement[] {
  const statements: SqlStatement[] = [];
  for (const card of input.cardPlan.filter((item) => item.modified)) {
    statements.push({
      name: "update-normalized-node-card",
      sql: ["UPDATE world_node_cards", "SET sections_json = $1::jsonb, updated_at = $2", "WHERE dataset_id = $3 AND node_id = $4"].join("\n"),
      params: [card.sections_json, input.now, input.datasetId, card.node_id],
    });
  }
  for (const group of input.domainProfilePlan.groups) {
    statements.push(...buildDomainProfileDeduplicationStatements(input.datasetId, input.now, group));
  }
  for (const edgeId of input.edgePlan.deprecate) {
    statements.push({
      name: "deprecate-duplicate-world-edge",
      sql: ["UPDATE world_edges", "SET status = 'deprecated', updated_at = $1", "WHERE dataset_id = $2 AND id = $3"].join("\n"),
      params: [input.now, input.datasetId, edgeId],
    });
  }
  statements.push(...buildNodeTermsStatements(input.datasetId, input.nodeTerms.rows));
  return statements;
}

function buildDomainProfileDeduplicationStatements(
  datasetId: string,
  now: string,
  group: DomainProfileDeduplicationPlan["groups"][number],
): SqlStatement[] {
  const statements: SqlStatement[] = [
    {
      name: "upsert-normalized-domain-profile",
      sql: [
        "INSERT INTO world_domain_profiles (",
        "dataset_id, id, node_id, domain, school_stages_json, curriculum_roles_json, source_refs_json, properties_json, status, created_at, updated_at, notes",
        ") VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, 'active', $9, $10, $11)",
        "ON CONFLICT (dataset_id, id) DO UPDATE SET",
        "school_stages_json = EXCLUDED.school_stages_json,",
        "curriculum_roles_json = EXCLUDED.curriculum_roles_json,",
        "source_refs_json = EXCLUDED.source_refs_json,",
        "properties_json = EXCLUDED.properties_json,",
        "status = 'active',",
        "updated_at = EXCLUDED.updated_at,",
        "notes = EXCLUDED.notes",
      ].join("\n"),
      params: [
        datasetId,
        group.canonical_profile_id,
        group.key.node_id,
        group.key.domain,
        group.merged.school_stages_json,
        group.merged.curriculum_roles_json,
        group.merged.source_refs_json,
        group.merged.properties_json,
        group.merged.created_at,
        now,
        group.merged.notes,
      ],
    },
    {
      name: "delete-normalized-domain-profile-evidence-links",
      sql: "DELETE FROM world_evidence_links WHERE dataset_id = $1 AND owner_type = 'domain_profile' AND owner_id = $2",
      params: [datasetId, group.canonical_profile_id],
    },
  ];
  for (const [index, evidenceId] of group.merged.source_refs_json.entries()) {
    statements.push({
      name: "upsert-normalized-domain-profile-evidence-link",
      sql: [
        "INSERT INTO world_evidence_links (dataset_id, owner_type, owner_id, evidence_id, ordinal)",
        "VALUES ($1, 'domain_profile', $2, $3, $4)",
        "ON CONFLICT (dataset_id, owner_type, owner_id, evidence_id) DO UPDATE SET ordinal = EXCLUDED.ordinal",
      ].join("\n"),
      params: [datasetId, group.canonical_profile_id, evidenceId, index + 1],
    });
  }
  if (group.duplicate_ids.length > 0) {
    statements.push(
      {
        name: "remap-normalized-domain-profile-mentions",
        sql: [
          "UPDATE world_mentions",
          "SET target_id = $1, updated_at = $2",
          "WHERE dataset_id = $3 AND target_type = 'domain_profile' AND target_id = ANY($4)",
        ].join("\n"),
        params: [group.canonical_profile_id, now, datasetId, group.duplicate_ids],
      },
      {
        name: "delete-duplicate-domain-profile-evidence-links",
        sql: "DELETE FROM world_evidence_links WHERE dataset_id = $1 AND owner_type = 'domain_profile' AND owner_id = ANY($2)",
        params: [datasetId, group.duplicate_ids],
      },
      {
        name: "delete-duplicate-domain-profiles",
        sql: "DELETE FROM world_domain_profiles WHERE dataset_id = $1 AND id = ANY($2)",
        params: [datasetId, group.duplicate_ids],
      },
    );
  }
  return statements;
}

function buildNodeTermsStatements(datasetId: string, rows: NodeTermsPlan["rows"]): SqlStatement[] {
  const deleteStatement: SqlStatement = {
    name: "delete-world-node-terms",
    sql: "DELETE FROM world_node_terms WHERE dataset_id = $1",
    params: [datasetId],
  };
  if (rows.length === 0) return [deleteStatement];
  const columns = ["dataset_id", "node_id", "term", "term_norm", "term_type"] as const;
  const params: unknown[] = [];
  const values = rows.map((row) => {
    const placeholders = columns.map((column) => {
      params.push(row[column]);
      return `$${params.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  return [
    deleteStatement,
    {
      name: "upsert-world-node-terms",
      sql: [
        `INSERT INTO world_node_terms (${columns.join(", ")})`,
        `VALUES ${values.join(", ")}`,
        "ON CONFLICT (dataset_id, node_id, term_norm, term_type)",
        "DO UPDATE SET term = EXCLUDED.term",
      ].join("\n"),
      params,
    },
  ];
}

function toNodeCard(row: RawRecord): NodeCardLike {
  return {
    node_id: requiredString(row.node_id, "node_id"),
    sections_json: row.sections_json,
  };
}

function toDomainProfile(row: RawRecord): CanonicalDomainProfileLike {
  return {
    id: requiredString(row.id, "id"),
    node_id: requiredString(row.node_id, "node_id"),
    domain: requiredString(row.domain, "domain"),
    school_stages_json: row.school_stages_json,
    curriculum_roles_json: row.curriculum_roles_json,
    source_refs_json: row.source_refs_json,
    properties_json: row.properties_json,
    notes: optionalString(row.notes),
    status: optionalString(row.status),
    created_at: requiredString(row.created_at, "created_at"),
  };
}

function toEdge(row: RawRecord): CanonicalEdgeLike {
  return {
    id: requiredString(row.id, "id"),
    from_id: requiredString(row.from_id, "from_id"),
    to_id: requiredString(row.to_id, "to_id"),
    type: requiredString(row.type, "type"),
    status: optionalString(row.status),
    created_at: requiredString(row.created_at, "created_at"),
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

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required field '${name}'.`);
  return value;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  return String(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
