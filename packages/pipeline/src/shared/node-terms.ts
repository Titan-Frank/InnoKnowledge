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
  statements: SqlStatement[];
};

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
  return {
    rows,
    count: rows.length,
  };
}

export function buildNodeTermsSqlPlan(datasetId: string, rows: NodeTermRow[]): NodeTermsSqlPlan {
  const deleteStatement: SqlStatement = {
    name: "delete-world-node-terms",
    sql: "DELETE FROM world_node_terms WHERE dataset_id = $1",
    params: [datasetId],
  };
  const insertStatement = rows.length > 0 ? buildNodeTermsInsertStatement(rows) : null;
  return {
    delete: deleteStatement,
    insert: insertStatement,
    statements: insertStatement ? [deleteStatement, insertStatement] : [deleteStatement],
  };
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

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
