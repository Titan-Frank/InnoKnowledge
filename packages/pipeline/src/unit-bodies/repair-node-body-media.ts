import type { SqlStatement } from "../staging/staging-sql.js";
import { resolveBodyMediaRefs, type NodeBodyInputEvidenceRow } from "./generate-node-bodies.js";

type RawRecord = Record<string, unknown>;

export type NodeBodyMediaRepairOutput = {
  selected: number;
  repaired: number;
  skipped_valid: number;
  unresolved: Array<{ node_id: string; refs: string[] }>;
};

export function buildSelectNodeBodiesForMediaRepairQuery(datasetId: string): SqlStatement {
  return {
    name: "select-node-bodies-for-media-repair",
    sql: "SELECT node_id, content, media_refs_json, source_refs_json FROM world_node_bodies WHERE dataset_id = $1 AND status != 'deprecated' ORDER BY node_id",
    params: [datasetId],
  };
}

export function buildSelectEvidenceForBodyMediaRepairQuery(datasetId: string): SqlStatement {
  return {
    name: "select-evidence-for-body-media-repair",
    sql: "SELECT id, excerpt, modality, properties_json FROM world_evidence WHERE dataset_id = $1 ORDER BY id",
    params: [datasetId],
  };
}

export function buildUpdateNodeBodyMediaRepairStatement(input: {
  datasetId: string;
  nodeId: string;
  expectedContent: string;
  mediaRefs: RawRecord[];
  now: string;
}): SqlStatement {
  return {
    name: "repair-world-node-body-media",
    sql: [
      "UPDATE world_node_bodies",
      "SET media_refs_json = $4::jsonb, updated_at = $5",
      "WHERE dataset_id = $1 AND node_id = $2 AND content = $3",
      "  AND media_refs_json IS DISTINCT FROM $4::jsonb",
      "RETURNING node_id",
    ].join("\n"),
    params: [input.datasetId, input.nodeId, input.expectedContent, input.mediaRefs, input.now],
  };
}

export async function repairNodeBodyMediaFromDatabase(input: {
  datasetId: string;
  now?: string;
  query: (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];
  executeStatement: (statement: SqlStatement) => Promise<RawRecord[] | void> | RawRecord[] | void;
}): Promise<NodeBodyMediaRepairOutput> {
  const bodies = await input.query(buildSelectNodeBodiesForMediaRepairQuery(input.datasetId));
  const evidence = (await input.query(buildSelectEvidenceForBodyMediaRepairQuery(input.datasetId))).map(toEvidenceRow);
  const now = input.now ?? new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const unresolved: NodeBodyMediaRepairOutput["unresolved"] = [];
  let repaired = 0;
  let skippedValid = 0;

  for (const body of bodies) {
    const nodeId = text(body.node_id);
    const content = text(body.content);
    const sourceRefs = strings(body.source_refs_json);
    if (!nodeId || !content.includes("![")) {
      skippedValid += 1;
      continue;
    }
    const resolved = resolveBodyMediaRefs(content, sourceRefs, evidence);
    if (resolved.unresolvedRefs.length > 0) {
      unresolved.push({ node_id: nodeId, refs: resolved.unresolvedRefs });
      continue;
    }
    if (JSON.stringify(body.media_refs_json ?? []) === JSON.stringify(resolved.mediaRefs)) {
      skippedValid += 1;
      continue;
    }
    const rows = await input.executeStatement(buildUpdateNodeBodyMediaRepairStatement({
      datasetId: input.datasetId,
      nodeId,
      expectedContent: content,
      mediaRefs: resolved.mediaRefs,
      now,
    }));
    if (rows === undefined || rows.length === 1) repaired += 1;
  }

  return { selected: bodies.length, repaired, skipped_valid: skippedValid, unresolved };
}

function toEvidenceRow(row: RawRecord): NodeBodyInputEvidenceRow {
  return {
    id: text(row.id),
    source_type: "",
    source_id: "",
    anchor_ref: "",
    excerpt: text(row.excerpt),
    locator: "",
    modality: text(row.modality),
    properties_json: row.properties_json,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}
