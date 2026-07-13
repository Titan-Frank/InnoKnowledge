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
  bridge_path_candidates: number;
  plan: InterdisciplinaryAnalysisPlan;
};

export type InterdisciplinaryApplyDatabaseOutput = {
  dataset_id: string;
  applied: number;
  alignments_applied: number;
  relations_applied: number;
  bridge_paths_applied: number;
  skipped: number;
  candidates: Array<{
    candidate_id: string;
    candidate_kind: string;
    canonical_node_id?: string;
    deprecated_node_ids?: string[];
    edge_id?: string;
    edge_ids?: string[];
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
        bridge_path_candidates: plan.bridge_path_candidates,
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
            "  dataset_id, candidate_id, run_id, candidate_kind, from_node_id, to_node_id, bridge_node_id,",
            "  proposed_edge_type, directionality, proposed_path_json, confidence, source_domains_json, target_domains_json,",
            "  evidence_refs_json, rationale_json, status, created_at, updated_at",
            ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, 'pending', $16, $16)",
            "ON CONFLICT (dataset_id, candidate_id) DO UPDATE SET",
            "  run_id = EXCLUDED.run_id, bridge_node_id = EXCLUDED.bridge_node_id, proposed_edge_type = EXCLUDED.proposed_edge_type, directionality = EXCLUDED.directionality,",
            "  proposed_path_json = EXCLUDED.proposed_path_json,",
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
            candidate.bridge_node_id,
            candidate.proposed_edge_type,
            candidate.directionality,
            json(candidate.proposed_path),
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
      bridge_path_candidates: plan.bridge_path_candidates,
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
    bridge_paths_applied: 0,
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
          await markCandidateApplied(tx, input.datasetId, candidateId, [], now);
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

        if (candidateKind === "relation") {
          const edgeType = requireValidEdgeType(requiredString(candidate.proposed_edge_type, "proposed_edge_type"));
          const evidenceRefs = uniqueStable(stringArray(candidate.evidence_refs_json));
          await requireEligibleRelationEvidence(tx, input.datasetId, candidateId, evidenceRefs);
          const fromId = await resolveActiveNodeId(tx, input.datasetId, requiredString(candidate.from_node_id, "from_node_id"));
          const toId = await resolveActiveNodeId(tx, input.datasetId, requiredString(candidate.to_node_id, "to_node_id"));
          if (fromId === toId) {
            await rejectSelfLoopCandidate(tx, input.datasetId, candidateId, now);
            output.skipped += 1;
            output.candidates.push({ candidate_id: candidateId, candidate_kind: candidateKind, status: "skipped" });
            continue;
          }
          const directionality = stringValue(candidate.directionality) === "directed" ? "directed" : "undirected";
          const edgeId = await upsertInterdisciplinaryEdge(tx, {
            datasetId: input.datasetId,
            candidate,
            candidateId,
            edgeType,
            fromId,
            toId,
            directionality,
            evidenceRefs,
            bridgeNodeId: null,
            now,
          });
          await markCandidateApplied(tx, input.datasetId, candidateId, [edgeId], now);
          output.applied += 1;
          output.relations_applied += 1;
          output.candidates.push({ candidate_id: candidateId, candidate_kind: candidateKind, edge_id: edgeId, edge_ids: [edgeId], status: "applied" });
          continue;
        }

        if (candidateKind === "bridge_path") {
          const bridgeNodeId = await resolveActiveNodeId(tx, input.datasetId, requiredString(candidate.bridge_node_id, "bridge_node_id"));
          const sourceNodeId = await resolveActiveNodeId(tx, input.datasetId, requiredString(candidate.from_node_id, "from_node_id"));
          const targetNodeId = await resolveActiveNodeId(tx, input.datasetId, requiredString(candidate.to_node_id, "to_node_id"));
          const path = recordArray(candidate.proposed_path_json);
          if (path.length !== 2) throw new Error(`桥接路径候选“${candidateId}”必须恰好包含两段关系。`);
          const expectedSegments = [[sourceNodeId, bridgeNodeId], [bridgeNodeId, targetNodeId]] as const;
          const edgeIds: string[] = [];
          for (const [index, segment] of path.entries()) {
            const fromId = await resolveActiveNodeId(tx, input.datasetId, requiredString(segment.from_node_id, `proposed_path[${index}].from_node_id`));
            const toId = await resolveActiveNodeId(tx, input.datasetId, requiredString(segment.to_node_id, `proposed_path[${index}].to_node_id`));
            const [expectedLeft, expectedRight] = expectedSegments[index]!;
            if (new Set([fromId, toId]).size < 2 || ![fromId, toId].includes(expectedLeft) || ![fromId, toId].includes(expectedRight)) {
              throw new Error(`桥接路径候选“${candidateId}”的第 ${index + 1} 段端点不合法。`);
            }
            const edgeType = requireValidEdgeType(requiredString(segment.relation_type, `proposed_path[${index}].relation_type`));
            const evidenceRefs = uniqueStable(stringArray(segment.evidence_refs));
            await requireEligibleRelationEvidence(tx, input.datasetId, `${candidateId}#${index + 1}`, evidenceRefs);
            const edgeId = await upsertInterdisciplinaryEdge(tx, {
              datasetId: input.datasetId,
              candidate,
              candidateId,
              edgeType,
              fromId,
              toId,
              directionality: stringValue(segment.directionality) === "directed" ? "directed" : "undirected",
              evidenceRefs,
              bridgeNodeId,
              pathIndex: index,
              now,
            });
            edgeIds.push(edgeId);
          }
          await markCandidateApplied(tx, input.datasetId, candidateId, edgeIds, now);
          output.applied += 1;
          output.bridge_paths_applied += 1;
          output.relations_applied += edgeIds.length;
          output.candidates.push({ candidate_id: candidateId, candidate_kind: candidateKind, edge_ids: edgeIds, status: "applied" });
          continue;
        }

        throw new Error(`Unsupported interdisciplinary candidate kind '${candidateKind}'.`);
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
  const [nodeRows, profileRows, projectionRows, mentionRows, cardRows, bodyRows, edgeRows, evidenceRows] = await Promise.all([
    queryRows(sql, "SELECT id, name, kind, subkind, definition, scope, aliases_json, domains_json, tags_json, properties_json, embedding FROM world_nodes WHERE dataset_id = $1 AND status = 'active' ORDER BY id", [datasetId]),
    queryRows(sql, "SELECT node_id, domain, source_refs_json FROM world_domain_profiles WHERE dataset_id = $1 AND status = 'active' ORDER BY node_id, domain", [datasetId]),
    queryRows(sql, "SELECT node_id, domain, source_refs_json FROM world_curriculum_projections WHERE dataset_id = $1 AND status = 'active' ORDER BY node_id, domain", [datasetId]),
    queryRows(sql, "SELECT target_id AS node_id, source_refs_json FROM world_mentions WHERE dataset_id = $1 AND target_type = 'node' ORDER BY target_id", [datasetId]),
    queryRows(sql, "SELECT node_id, source_refs_json, sections_json FROM world_node_cards WHERE dataset_id = $1 AND status = 'active' ORDER BY node_id", [datasetId]),
    queryRows(sql, "SELECT node_id, source_refs_json FROM world_node_bodies WHERE dataset_id = $1 AND status = 'active' ORDER BY node_id", [datasetId]),
    queryRows(sql, "SELECT id, from_id, to_id, type, status FROM world_edges WHERE dataset_id = $1 AND status != 'deprecated' ORDER BY id", [datasetId]),
    queryRows(sql, [
      "SELECT evidence.id FROM world_evidence AS evidence",
      "JOIN world_source_policies AS policy ON policy.source_type = evidence.source_type",
      "WHERE evidence.dataset_id = $1",
      "  AND policy.status = 'active' AND policy.relation_evidence_allowed = 1",
      "  AND (policy.requires_explicit_review = 0 OR evidence.properties_json->>'review_status' = 'approved')",
      "  AND COALESCE(evidence.properties_json->>'synthetic', 'false') != 'true'",
      "  AND COALESCE(evidence.properties_json->>'quality_excluded', 'false') != 'true'",
      "  AND COALESCE(evidence.properties_json->>'review_status', 'approved') NOT IN ('pending', 'rejected')",
    ].join("\n"), [datasetId]),
  ]);
  const eligibleEvidenceIds = new Set(evidenceRows.map((row) => stringValue(row.id)).filter(Boolean));
  const domainsByNode = new Map<string, string[]>();
  const evidenceByNode = new Map<string, string[]>();
  for (const row of profileRows) {
    append(domainsByNode, stringValue(row.node_id), [stringValue(row.domain)]);
    append(evidenceByNode, stringValue(row.node_id), stringArray(row.source_refs_json));
  }
  for (const row of projectionRows) {
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
        definition: requiredString(row.definition, "definition"),
        kind: requiredString(row.kind, "kind"),
        subkind: optionalString(row.subkind),
        aliases: stringArray(row.aliases_json),
        domains: uniqueStable([...stringArray(row.domains_json), ...(domainsByNode.get(stringValue(row.id)) ?? [])]),
        tags: stringArray(row.tags_json),
        bridgeTags: explicitBridgeTags.length > 0 ? explicitBridgeTags : stringArray(row.tags_json),
        scope: optionalString(row.scope),
        bridgeRole: isBridgeRole(properties.bridge_role) ? properties.bridge_role : null,
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

async function requireEligibleRelationEvidence(
  sql: UnsafeSqlClient,
  datasetId: string,
  candidateId: string,
  evidenceRefs: string[],
): Promise<void> {
  if (evidenceRefs.length === 0) throw new Error(`关系候选“${candidateId}”没有经过审核的证据。`);
  const eligible = new Set((await queryRows(sql, [
    "SELECT evidence.id",
    "FROM world_evidence AS evidence",
    "JOIN world_source_policies AS policy ON policy.source_type = evidence.source_type",
    "WHERE evidence.dataset_id = $1 AND evidence.id = ANY($2::text[])",
    "  AND policy.status = 'active' AND policy.relation_evidence_allowed = 1",
    "  AND (policy.requires_explicit_review = 0 OR evidence.properties_json->>'review_status' = 'approved')",
    "  AND COALESCE(evidence.properties_json->>'synthetic', 'false') != 'true'",
    "  AND COALESCE(evidence.properties_json->>'quality_excluded', 'false') != 'true'",
    "  AND COALESCE(evidence.properties_json->>'review_status', 'approved') NOT IN ('pending', 'rejected')",
  ].join("\n"), [datasetId, evidenceRefs])).map((row) => stringValue(row.id)));
  const missing = evidenceRefs.filter((id) => !eligible.has(id));
  if (missing.length > 0) {
    throw new Error(`关系候选“${candidateId}”包含不存在或不符合来源策略的证据：${missing.join("、")}。`);
  }
}

async function upsertInterdisciplinaryEdge(sql: UnsafeSqlClient, input: {
  datasetId: string;
  candidate: RawRecord;
  candidateId: string;
  edgeType: string;
  fromId: string;
  toId: string;
  directionality: "directed" | "undirected";
  evidenceRefs: string[];
  bridgeNodeId: string | null;
  pathIndex?: number;
  now: string;
}): Promise<string> {
  const edgeId = makeEdgeId(input.fromId, input.edgeType, input.toId);
  const properties = {
    relation_scope: "cross_domain",
    ...(input.bridgeNodeId ? { bridge_object_ids: [input.bridgeNodeId] } : {}),
    interdisciplinary: {
      candidate_id: input.candidateId,
      run_id: input.candidate.run_id,
      source_domains: stringArray(input.candidate.source_domains_json),
      target_domains: stringArray(input.candidate.target_domains_json),
      discovery_method: input.bridgeNodeId ? "reviewed_bridge_path" : "governed_candidate_review",
      ...(input.pathIndex === undefined ? {} : { path_index: input.pathIndex }),
      review_status: "approved",
      reviewer: optionalString(input.candidate.reviewer),
      reviewed_at: optionalString(input.candidate.reviewed_at) ?? input.now,
      evidence_refs: input.evidenceRefs,
    },
  };
  await sql.unsafe(
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
      input.edgeType,
      input.fromId,
      input.toId,
      input.directionality,
      numberValue(input.candidate.confidence, 0.8),
      json(input.evidenceRefs),
      json(properties),
      input.now,
      optionalString(input.candidate.review_notes),
    ],
  );
  return edgeId;
}

async function rejectSelfLoopCandidate(sql: UnsafeSqlClient, datasetId: string, candidateId: string, now: string): Promise<void> {
  await sql.unsafe(
    [
      "UPDATE world_interdisciplinary_candidates",
      "SET status = 'rejected', review_notes = trim(concat_ws(' ', review_notes, $1::text)), reviewed_at = COALESCE(reviewed_at, $2), updated_at = $2",
      "WHERE dataset_id = $3 AND candidate_id = $4",
    ].join("\n"),
    ["候选两端已归并为同一节点，不能生成自环关系。", now, datasetId, candidateId],
  );
}

async function markCandidateApplied(sql: UnsafeSqlClient, datasetId: string, candidateId: string, edgeIds: string[], now: string): Promise<void> {
  await sql.unsafe(
    [
      "UPDATE world_interdisciplinary_candidates",
      "SET status = 'applied', applied_edge_id = $1, applied_edge_ids_json = $2::jsonb, updated_at = $3",
      "WHERE dataset_id = $4 AND candidate_id = $5",
    ].join("\n"),
    [edgeIds.length === 1 ? edgeIds[0] : null, json(edgeIds), now, datasetId, candidateId],
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

function recordArray(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
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

function isBridgeRole(value: unknown): value is "semantic_bridge" | "method_bridge" | "analogy_bridge" {
  return value === "semantic_bridge" || value === "method_bridge" || value === "analogy_bridge";
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
