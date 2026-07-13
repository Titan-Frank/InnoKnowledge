import { randomUUID } from "node:crypto";

import postgres from "postgres";

import { mergeCanonicalNodeIds } from "../cli/dedupe-nodes.js";
import { requireValidEdgeType, utcNow } from "../shared/knowledge.js";
import { buildDatasetAdvisoryLockStatement } from "../shared/dataset-transaction.js";
import { makeEdgeId, makeStableSuffix, uniqueStable } from "../shared/pathing.js";
import {
  planInterdisciplinaryAnalysis,
  type InterdisciplinaryAnalysisPlan,
  type InterdisciplinaryEdgeInput,
  type InterdisciplinaryNodeInput,
} from "./interdisciplinary-analysis.js";

type RawRecord = Record<string, unknown>;
type JsonValue = Parameters<ReturnType<typeof postgres>['json']>[0];
type UnsafeSqlClient = {
  unsafe: (query: string, params?: any[]) => Promise<unknown> | unknown;
};

export type InterdisciplinaryAnalysisDatabaseInput = {
  dbUrl: string;
  datasetId: string;
  domains?: string[];
  minimumAlignmentScore?: number;
  minimumRelationScore?: number;
  maximumCandidates?: number;
  maximumBucketSize?: number;
  replacePending?: boolean;
  now?: string;
};

export type InterdisciplinaryAnalysisDatabaseOutput = {
  run: {
    run_id: string;
    domains: string[];
    config: Record<string, unknown>;
    stats: Record<string, unknown>;
    status: "completed";
    created_at: string;
    completed_at: string;
  };
  candidates_created: number;
  alignment_candidates: number;
  relation_candidates: number;
  plan: InterdisciplinaryAnalysisPlan;
};

export type InterdisciplinaryApplyDatabaseOutput = {
  dataset_id: string;
  applied: number;
  alignments_applied: number;
  relations_applied: number;
  skipped: number;
  candidates: Array<{
    candidate_id: string;
    candidate_kind: string;
    canonical_node_id?: string;
    deprecated_node_ids?: string[];
    edge_id?: string;
    status: "applied" | "skipped";
  }>;
};

export async function runInterdisciplinaryAnalysisFromDatabase(
  input: InterdisciplinaryAnalysisDatabaseInput,
): Promise<InterdisciplinaryAnalysisDatabaseOutput> {
  const sql = postgres(input.dbUrl, { max: 1 });
  const now = input.now ?? utcNow();
  const runId = `interdisciplinary-run:${makeStableSuffix([input.datasetId, now, randomUUID()], 12)}`;
  try {
    const { plan, config, stats } = await sql.begin(async (tx) => {
      await tx.unsafe(buildDatasetAdvisoryLockStatement(input.datasetId).sql, [input.datasetId]);
      const graph = await loadInterdisciplinaryGraphFromSql(tx, input.datasetId);
      const reviewedCandidateRows = await queryRows(tx, [
        "SELECT candidate_id, candidate_kind, from_node_id, to_node_id, status",
        "FROM world_interdisciplinary_candidates",
        "WHERE dataset_id = $1 AND status != 'pending'",
        "ORDER BY candidate_id",
      ].join("\n"), [input.datasetId]);
      const excludedCandidateIds = new Set(reviewedCandidateRows.map((row) => stringValue(row.candidate_id)).filter(Boolean));
      const blockedRelationNodePairs = reviewedCandidateRows
        .filter((row) => row.candidate_kind === "node_alignment" && (row.status === "approved" || row.status === "applied"))
        .map((row) => [stringValue(row.from_node_id), stringValue(row.to_node_id)] as const);
      const plan = planInterdisciplinaryAnalysis(graph.nodes, graph.edges, {
        domains: input.domains,
        minimumAlignmentScore: input.minimumAlignmentScore,
        minimumRelationScore: input.minimumRelationScore,
        maximumCandidates: input.maximumCandidates,
        maximumBucketSize: input.maximumBucketSize,
        excludedCandidateIds,
        blockedRelationNodePairs,
      });
      const config = {
        domains: cleanStrings(input.domains ?? []),
        minimum_alignment_score: input.minimumAlignmentScore ?? 0.74,
        minimum_relation_score: input.minimumRelationScore ?? 0.58,
        maximum_candidates: input.maximumCandidates ?? 500,
        maximum_bucket_size: input.maximumBucketSize ?? 40,
        replace_pending: input.replacePending ?? true,
        relation_candidates_are_review_only: true,
      };
      const stats = {
        ...plan.summary,
        candidates_created: plan.candidates.length,
        alignment_candidates: plan.alignment_candidates,
        relation_candidates: plan.relation_candidates,
      };
      await tx.unsafe(
        [
          "INSERT INTO world_interdisciplinary_runs (dataset_id, run_id, domains_json, config_json, stats_json, status, created_at, completed_at)",
          "VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, 'in_progress', $6, NULL)",
        ].join("\n"),
        [input.datasetId, runId, json(config.domains), json(config), json({}), now],
      );
      if (input.replacePending ?? true) {
        await tx.unsafe("DELETE FROM world_interdisciplinary_candidates WHERE dataset_id = $1 AND status = 'pending'", [input.datasetId]);
      }
      for (const candidate of plan.candidates) {
        await tx.unsafe(
          [
            "INSERT INTO world_interdisciplinary_candidates (",
            "  dataset_id, candidate_id, run_id, candidate_kind, from_node_id, to_node_id,",
            "  proposed_edge_type, directionality, confidence, source_domains_json, target_domains_json,",
            "  evidence_refs_json, rationale_json, status, created_at, updated_at",
            ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, 'pending', $14, $14)",
            "ON CONFLICT (dataset_id, candidate_id) DO UPDATE SET",
            "  run_id = EXCLUDED.run_id, proposed_edge_type = EXCLUDED.proposed_edge_type, directionality = EXCLUDED.directionality,",
            "  confidence = EXCLUDED.confidence, source_domains_json = EXCLUDED.source_domains_json,",
            "  target_domains_json = EXCLUDED.target_domains_json, evidence_refs_json = EXCLUDED.evidence_refs_json,",
            "  rationale_json = EXCLUDED.rationale_json, updated_at = EXCLUDED.updated_at",
            "WHERE world_interdisciplinary_candidates.status = 'pending'",
          ].join("\n"),
          [
            input.datasetId,
            candidate.candidate_id,
            runId,
            candidate.candidate_kind,
            candidate.from_node_id,
            candidate.to_node_id,
            candidate.proposed_edge_type,
            candidate.directionality,
            candidate.confidence,
            json(candidate.source_domains),
            json(candidate.target_domains),
            json(candidate.evidence_refs),
            json(candidate.rationale),
            now,
          ],
        );
      }
      await tx.unsafe(
        [
          "UPDATE world_interdisciplinary_runs",
          "SET stats_json = $1::jsonb, status = 'completed', completed_at = $2",
          "WHERE dataset_id = $3 AND run_id = $4",
        ].join("\n"),
        [json(stats), now, input.datasetId, runId],
      );
      return { plan, config, stats };
    });

    return {
      run: {
        run_id: runId,
        domains: config.domains,
        config,
        stats,
        status: "completed",
        created_at: now,
        completed_at: now,
      },
      candidates_created: plan.candidates.length,
      alignment_candidates: plan.alignment_candidates,
      relation_candidates: plan.relation_candidates,
      plan,
    };
  } finally {
    await sql.end();
  }
}

export async function applyApprovedInterdisciplinaryCandidates(input: {
  dbUrl: string;
  datasetId: string;
  limit?: number;
  now?: string;
}): Promise<InterdisciplinaryApplyDatabaseOutput> {
  const sql = postgres(input.dbUrl, { max: 1 });
  const now = input.now ?? utcNow();
  const limit = Number.isInteger(input.limit) && Number(input.limit) > 0 ? Number(input.limit) : 100;
  const output: InterdisciplinaryApplyDatabaseOutput = {
    dataset_id: input.datasetId,
    applied: 0,
    alignments_applied: 0,
    relations_applied: 0,
    skipped: 0,
    candidates: [],
  };
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(buildDatasetAdvisoryLockStatement(input.datasetId).sql, [input.datasetId]);
      const candidates = await queryRows(tx, [
        "SELECT *",
        "FROM world_interdisciplinary_candidates",
        "WHERE dataset_id = $1 AND status = 'approved'",
        "ORDER BY CASE candidate_kind WHEN 'node_alignment' THEN 0 ELSE 1 END, confidence DESC, created_at, candidate_id",
        "LIMIT $2",
      ].join("\n"), [input.datasetId, limit]);

      for (const candidate of candidates) {
        const candidateId = requiredString(candidate.candidate_id, "candidate_id");
        const candidateKind = requiredString(candidate.candidate_kind, "candidate_kind");
        if (candidateKind === "node_alignment") {
          const activeNodeIds = uniqueStable(await Promise.all([
            resolveActiveNodeId(tx, input.datasetId, requiredString(candidate.from_node_id, "from_node_id")),
            resolveActiveNodeId(tx, input.datasetId, requiredString(candidate.to_node_id, "to_node_id")),
          ]));
          const merged = await mergeCanonicalNodeIds(
            tx,
            input.datasetId,
            activeNodeIds,
            now,
          );
          await markCandidateApplied(tx, input.datasetId, candidateId, null, now);
          if (merged.duplicate_node_ids.length > 0) {
            await tx.unsafe(
              [
                "UPDATE world_interdisciplinary_candidates",
                "SET status = 'rejected', review_notes = trim(concat_ws(' ', review_notes, $1::text)), reviewed_at = COALESCE(reviewed_at, $2), updated_at = $2",
                "WHERE dataset_id = $3 AND candidate_id != $4 AND status = 'pending'",
                "  AND (from_node_id = ANY($5::text[]) OR to_node_id = ANY($5::text[]))",
              ].join("\n"),
              ["节点已由其他已审核对齐候选归并。", now, input.datasetId, candidateId, merged.duplicate_node_ids],
            );
          }
          output.applied += 1;
          output.alignments_applied += 1;
          output.candidates.push({
            candidate_id: candidateId,
            candidate_kind: candidateKind,
            canonical_node_id: merged.canonical_node_id,
            deprecated_node_ids: merged.duplicate_node_ids,
            status: "applied",
          });
          continue;
        }

        if (candidateKind !== "relation") throw new Error(`Unsupported interdisciplinary candidate kind '${candidateKind}'.`);
        const edgeType = requireValidEdgeType(requiredString(candidate.proposed_edge_type, "proposed_edge_type"));
        if (edgeType === "same_as") {
          throw new Error(`Approved relation candidate '${candidateId}' must use node alignment instead of a same_as edge.`);
        }
        const evidenceRefs = uniqueStable(stringArray(candidate.evidence_refs_json));
        if (evidenceRefs.length === 0) throw new Error(`Approved relation candidate '${candidateId}' has no reviewed evidence references.`);
        const existingEvidenceIds = new Set((await queryRows(tx, [
          "SELECT id FROM world_evidence",
          "WHERE dataset_id = $1 AND id = ANY($2::text[])",
          "  AND source_type = 'textbook'",
          "  AND COALESCE(properties_json->>'synthetic', 'false') != 'true'",
          "  AND COALESCE(properties_json->>'quality_excluded', 'false') != 'true'",
          "  AND COALESCE(properties_json->>'review_status', 'approved') NOT IN ('pending', 'rejected')",
        ].join("\n"), [input.datasetId, evidenceRefs])).map((row) => stringValue(row.id)));
        const missingEvidenceIds = evidenceRefs.filter((id) => !existingEvidenceIds.has(id));
        if (missingEvidenceIds.length > 0) {
          throw new Error(`Approved relation candidate '${candidateId}' references missing evidence: ${missingEvidenceIds.join(", ")}.`);
        }
        const fromId = await resolveActiveNodeId(tx, input.datasetId, requiredString(candidate.from_node_id, "from_node_id"));
        const toId = await resolveActiveNodeId(tx, input.datasetId, requiredString(candidate.to_node_id, "to_node_id"));
        if (fromId === toId) {
          await tx.unsafe(
            [
              "UPDATE world_interdisciplinary_candidates",
              "SET status = 'rejected', review_notes = trim(concat_ws(' ', review_notes, $1::text)), reviewed_at = COALESCE(reviewed_at, $2), updated_at = $2",
              "WHERE dataset_id = $3 AND candidate_id = $4",
            ].join("\n"),
            ["候选两端已归并为同一节点，不能生成自环关系。", now, input.datasetId, candidateId],
          );
          output.skipped += 1;
          output.candidates.push({ candidate_id: candidateId, candidate_kind: candidateKind, status: "skipped" });
          continue;
        }
        const directionality = stringValue(candidate.directionality) === "directed" ? "directed" : "undirected";
        const edgeId = makeEdgeId(fromId, edgeType, toId);
        const properties = {
          interdisciplinary: {
            candidate_id: candidateId,
            run_id: candidate.run_id,
            source_domains: stringArray(candidate.source_domains_json),
            target_domains: stringArray(candidate.target_domains_json),
            discovery_method: "governed_candidate_review",
            review_status: "approved",
            reviewer: optionalString(candidate.reviewer),
            reviewed_at: optionalString(candidate.reviewed_at) ?? now,
            evidence_refs: evidenceRefs,
          },
        };
        await tx.unsafe(
          [
            "INSERT INTO world_edges (dataset_id, id, type, from_id, to_id, directionality, confidence, source_refs_json, properties_json, status, created_at, updated_at, notes)",
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 'active', $10, $10, $11)",
            "ON CONFLICT (dataset_id, id) DO UPDATE SET",
            "  confidence = GREATEST(world_edges.confidence, EXCLUDED.confidence),",
            "  directionality = EXCLUDED.directionality,",
            "  source_refs_json = (SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb) FROM jsonb_array_elements(world_edges.source_refs_json || EXCLUDED.source_refs_json) AS item(value)),",
            "  properties_json = world_edges.properties_json || EXCLUDED.properties_json, status = 'active', updated_at = EXCLUDED.updated_at,",
            "  notes = trim(concat_ws(' ', world_edges.notes, EXCLUDED.notes))",
          ].join("\n"),
          [
            input.datasetId,
            edgeId,
            edgeType,
            fromId,
            toId,
            directionality,
            numberValue(candidate.confidence, 0.8),
            json(evidenceRefs),
            json(properties),
            now,
            optionalString(candidate.review_notes),
          ],
        );
        await markCandidateApplied(tx, input.datasetId, candidateId, edgeId, now);
        output.applied += 1;
        output.relations_applied += 1;
        output.candidates.push({ candidate_id: candidateId, candidate_kind: candidateKind, edge_id: edgeId, status: "applied" });
      }
    });
    return output;
  } finally {
    await sql.end();
  }
}

export async function loadInterdisciplinaryGraphFromSql(sql: UnsafeSqlClient, datasetId: string): Promise<{
  nodes: InterdisciplinaryNodeInput[];
  edges: InterdisciplinaryEdgeInput[];
}> {
  const [nodeRows, profileRows, mentionRows, cardRows, bodyRows, edgeRows, evidenceRows] = await Promise.all([
    queryRows(sql, "SELECT id, name, kind, subkind, aliases_json, domains_json, tags_json, properties_json, embedding FROM world_nodes WHERE dataset_id = $1 AND status = 'active' ORDER BY id", [datasetId]),
    queryRows(sql, "SELECT node_id, domain, source_refs_json FROM world_domain_profiles WHERE dataset_id = $1 AND status = 'active' ORDER BY node_id, domain", [datasetId]),
    queryRows(sql, "SELECT target_id AS node_id, source_refs_json FROM world_mentions WHERE dataset_id = $1 AND target_type = 'node' ORDER BY target_id", [datasetId]),
    queryRows(sql, "SELECT node_id, source_refs_json, sections_json FROM world_node_cards WHERE dataset_id = $1 AND status = 'active' ORDER BY node_id", [datasetId]),
    queryRows(sql, "SELECT node_id, source_refs_json FROM world_node_bodies WHERE dataset_id = $1 AND status = 'active' ORDER BY node_id", [datasetId]),
    queryRows(sql, "SELECT id, from_id, to_id, type, status FROM world_edges WHERE dataset_id = $1 AND status != 'deprecated' ORDER BY id", [datasetId]),
    queryRows(sql, [
      "SELECT id FROM world_evidence",
      "WHERE dataset_id = $1",
      "  AND source_type = 'textbook'",
      "  AND COALESCE(properties_json->>'synthetic', 'false') != 'true'",
      "  AND COALESCE(properties_json->>'quality_excluded', 'false') != 'true'",
      "  AND COALESCE(properties_json->>'review_status', 'approved') NOT IN ('pending', 'rejected')",
    ].join("\n"), [datasetId]),
  ]);
  const eligibleEvidenceIds = new Set(evidenceRows.map((row) => stringValue(row.id)).filter(Boolean));
  const domainsByNode = new Map<string, string[]>();
  const evidenceByNode = new Map<string, string[]>();
  for (const row of profileRows) {
    append(domainsByNode, stringValue(row.node_id), [stringValue(row.domain)]);
    append(evidenceByNode, stringValue(row.node_id), stringArray(row.source_refs_json));
  }
  for (const row of mentionRows) append(evidenceByNode, stringValue(row.node_id), stringArray(row.source_refs_json));
  for (const row of cardRows) {
    append(evidenceByNode, stringValue(row.node_id), [
      ...stringArray(row.source_refs_json),
      ...sectionSourceRefs(row.sections_json),
    ]);
  }
  for (const row of bodyRows) append(evidenceByNode, stringValue(row.node_id), stringArray(row.source_refs_json));

  return {
    nodes: nodeRows.map((row) => {
      const properties = recordValue(row.properties_json);
      const explicitBridgeTags = stringArray(properties.bridge_tags);
      return {
        id: requiredString(row.id, "id"),
        name: requiredString(row.name, "name"),
        kind: requiredString(row.kind, "kind"),
        subkind: optionalString(row.subkind),
        aliases: stringArray(row.aliases_json),
        domains: uniqueStable([...stringArray(row.domains_json), ...(domainsByNode.get(stringValue(row.id)) ?? [])]),
        tags: stringArray(row.tags_json),
        bridgeTags: explicitBridgeTags.length > 0 ? explicitBridgeTags : stringArray(row.tags_json),
        semanticKey: optionalString(properties.semantic_key),
        embedding: parseVector(row.embedding),
        evidenceRefs: uniqueStable(evidenceByNode.get(stringValue(row.id)) ?? []).filter((id) => eligibleEvidenceIds.has(id)),
      };
    }),
    edges: edgeRows.map((row) => ({
      id: requiredString(row.id, "id"),
      fromId: requiredString(row.from_id, "from_id"),
      toId: requiredString(row.to_id, "to_id"),
      type: requiredString(row.type, "type"),
      status: optionalString(row.status) ?? undefined,
    })),
  };
}

async function resolveActiveNodeId(sql: UnsafeSqlClient, datasetId: string, nodeId: string): Promise<string> {
  let current = nodeId;
  for (let depth = 0; depth < 8; depth += 1) {
    const rows = await queryRows(sql, "SELECT id, status, deprecated_by FROM world_nodes WHERE dataset_id = $1 AND id = $2 LIMIT 1", [datasetId, current]);
    const row = rows[0];
    if (!row) throw new Error(`Interdisciplinary candidate references missing node '${current}'.`);
    if (row.status !== "deprecated") return current;
    const replacement = optionalString(row.deprecated_by);
    if (!replacement) throw new Error(`Deprecated node '${current}' has no replacement.`);
    current = replacement;
  }
  throw new Error(`Deprecated-node chain for '${nodeId}' exceeds the supported depth.`);
}

async function markCandidateApplied(sql: UnsafeSqlClient, datasetId: string, candidateId: string, edgeId: string | null, now: string): Promise<void> {
  await sql.unsafe(
    [
      "UPDATE world_interdisciplinary_candidates",
      "SET status = 'applied', applied_edge_id = $1, updated_at = $2",
      "WHERE dataset_id = $3 AND candidate_id = $4",
    ].join("\n"),
    [edgeId, now, datasetId, candidateId],
  );
}

async function queryRows(sql: UnsafeSqlClient, query: string, params: unknown[]): Promise<RawRecord[]> {
  const rows = await sql.unsafe(query, params as any[]);
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

function append(target: Map<string, string[]>, key: string, values: string[]): void {
  if (!key) return;
  target.set(key, uniqueStable([...(target.get(key) ?? []), ...values.filter(Boolean)]));
}

function parseVector(value: unknown): number[] {
  if (Array.isArray(value)) {
    const parsed = value.map(Number);
    return parsed.every(Number.isFinite) ? parsed : [];
  }
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/^\[/, "").replace(/\]$/, "");
    if (!trimmed) return [];
    const parsed = trimmed.split(",").map((item) => Number(item.trim()));
    return parsed.every(Number.isFinite) ? parsed : [];
  }
  return [];
}

function json(value: unknown): JsonValue {
  return value as JsonValue;
}

function cleanStrings(values: Iterable<unknown>): string[] {
  return uniqueStable([...values].map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean)).sort();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function sectionSourceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStable(value.filter(isRecord).flatMap((section) => stringArray(section.source_refs)));
}

function recordValue(value: unknown): RawRecord {
  return isRecord(value) ? value : {};
}

function requiredString(value: unknown, field: string): string {
  const result = stringValue(value);
  if (!result) throw new Error(`Missing required field '${field}'.`);
  return result;
}

function optionalString(value: unknown): string | null {
  const result = stringValue(value).trim();
  return result || null;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
