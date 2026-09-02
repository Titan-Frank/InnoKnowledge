import { normalizeTerm } from "./pathing.js";
import type { SqlStatement } from "../staging/staging-sql.js";

export type NodeTermRow = {
  dataset_id: string;
  node_id: string;
  term: string;
  term_norm: string;
  term_type: "canonical" | "alias" | "tag";
};

export type NodeTermsPlan = {
  rows: NodeTermRow[];
  count: number;
};

export type NodeTermsSqlPlan = {
  delete: SqlStatement;
  insert: SqlStatement | null;
  inserts: SqlStatement[];
  statements: SqlStatement[];
};

export const NODE_TERM_UPSERT_BATCH_SIZE = 10_000;

export function planNodeTerms(datasetId: string, nodes: Array<Record<string, unknown>>): NodeTermsPlan {
  const rows: NodeTermRow[] = [];
  for (const node of nodes) {
    if (node.status === "deprecated") continue;
    const nodeId = stringValue(node.id);
    if (!nodeId) continue;
    const terms: Array<{ term: unknown; term_type: NodeTermRow["term_type"] }> = [{ term: stringValue(node.name) ?? "", term_type: "canonical" }];
    for (const alias of listValue(node.aliases_json)) terms.push({ term: alias, term_type: "alias" });
    for (const tag of listValue(node.tags_json)) terms.push({ term: tag, term_type: "tag" });

    for (const item of terms) {
      if (typeof item.term !== "string") continue;
      const termNorm = normalizeTerm(item.term);
      if (!termNorm) continue;
      rows.push({
        dataset_id: datasetId,
        node_id: nodeId,
        term: item.term,
        term_norm: termNorm,
        term_type: item.term_type,
      });
    }
  }
  const uniqueRows = deduplicateNodeTermRows(rows);
  return {
    rows: uniqueRows,
    count: uniqueRows.length,
  };
}

export function buildNodeTermsSqlPlan(datasetId: string, rows: NodeTermRow[]): NodeTermsSqlPlan {
  const deleteStatement: SqlStatement = {
    name: "delete-world-node-terms",
    sql: "DELETE FROM world_node_terms WHERE dataset_id = $1",
    params: [datasetId],
  };
  const insertStatements = buildNodeTermsUpsertStatements(rows);
  return {
    delete: deleteStatement,
    insert: insertStatements[0] ?? null,
    inserts: insertStatements,
    statements: [deleteStatement, ...insertStatements],
  };
}

export function buildNodeTermsUpsertStatements(
  rows: NodeTermRow[],
  batchSize = NODE_TERM_UPSERT_BATCH_SIZE,
): SqlStatement[] {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new Error("Node term upsert batch size must be a positive safe integer.");
  }
  const uniqueRows = deduplicateNodeTermRows(rows);
  const statements: SqlStatement[] = [];
  for (let offset = 0; offset < uniqueRows.length; offset += batchSize) {
    statements.push(buildNodeTermsInsertStatement(uniqueRows.slice(offset, offset + batchSize)));
  }
  return statements;
}

export function buildNodeTermsUpsertStatement(rows: NodeTermRow[]): SqlStatement | null {
  const uniqueRows = deduplicateNodeTermRows(rows);
  return uniqueRows.length > 0 ? buildNodeTermsInsertStatement(uniqueRows) : null;
}

export function buildSelectNodesForNodeTermsQuery(datasetId: string): SqlStatement {
  return {
    name: "select-world-nodes-for-node-terms",
    sql: ["SELECT id, name, aliases_json, tags_json", "FROM world_nodes", "WHERE dataset_id = $1 AND status != 'deprecated'"].join("\n"),
    params: [datasetId],
  };
}

function buildNodeTermsInsertStatement(rows: NodeTermRow[]): SqlStatement {
  const columns = ["dataset_id", "node_id", "term", "term_norm", "term_type"] as const;
  const params: unknown[] = [];
  const valueGroups = rows.map((row) => {
    const placeholders = columns.map((column) => {
      params.push(row[column]);
      return `$${params.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  return {
    name: "upsert-world-node-terms",
    sql: [
      `INSERT INTO world_node_terms (${columns.join(", ")})`,
      `VALUES ${valueGroups.join(", ")}`,
      "ON CONFLICT (dataset_id, node_id, term_norm, term_type)",
      "DO UPDATE SET term = EXCLUDED.term",
    ].join("\n"),
    params,
  };
}

function deduplicateNodeTermRows(rows: NodeTermRow[]): NodeTermRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = JSON.stringify([row.dataset_id, row.node_id, row.term_norm, row.term_type]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
