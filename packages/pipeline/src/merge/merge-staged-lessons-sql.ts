import type { SqlStatement } from "../staging/staging-sql.js";
import { formatPgvector } from "./merge-nodes.js";
import type { EdgeMergePlan, DomainProfileMergePlan, EvidenceMergePlan, MentionMergePlan, NodeCardMergePlan, StagedNodeMergePlan } from "./merge-nodes.js";
import type { StagedLessonMergePlan, StagedLessonsMergePlan } from "./merge-staged-lesson.js";
import { buildNodeTermsSqlPlan, type NodeTermRow } from "../shared/node-terms.js";

type SqlRow = Record<string, unknown>;

export type MergeStagedLessonsSqlPlan = {
  statements: SqlStatement[];
};

const JSONB_COLUMNS = new Set([
  "aliases_json",
  "curriculum_roles_json",
  "domains_json",
  "external_ids_json",
  "knowledge_form_json",
  "learning_mode_json",
  "normalized_claims_json",
  "properties_json",
  "rationale_json",
  "school_stages_json",
  "sections_json",
  "selection_json",
  "source_refs_json",
  "stats_json",
  "tags_json",
]);

export function buildMergeStagedLessonsSqlPlan(
  plan: StagedLessonsMergePlan,
  options: { datasetId: string; now: string; nodeTermRows?: NodeTermRow[] },
): MergeStagedLessonsSqlPlan {
  const statements: SqlStatement[] = [];
  if (plan.merge_run_id) {
    statements.push(buildMergeRunStartStatement(options.datasetId, plan.merge_run_id, plan.selection_json, options.now));
  }

  for (const lesson of plan.lessons) {
    statements.push(buildLessonStatusStatement(options.datasetId, lesson.lesson_run_id, "merging", options.now));
    statements.push(...buildLessonMergeStatements(lesson));
    statements.push(buildLessonStatusStatement(options.datasetId, lesson.lesson_run_id, "merged", options.now));
  }

  if (options.nodeTermRows) {
    statements.push(...buildNodeTermsSqlPlan(options.datasetId, options.nodeTermRows).statements);
  }

  if (plan.merge_run_id) {
    statements.push(buildMergeRunCompleteStatement(options.datasetId, plan.merge_run_id, plan.stats, options.now));
  }

  return { statements };
}

function buildLessonMergeStatements(lesson: StagedLessonMergePlan): SqlStatement[] {
  const statements: SqlStatement[] = [];
  for (const node of lesson.nodes) {
    statements.push(buildNodeUpsertStatement(node));
    statements.push(buildCanonicalNodeMapStatement(node));
  }
  for (const evidence of lesson.evidence) statements.push(buildEvidenceInsertStatement(evidence));
  for (const edge of lesson.edges) {
    statements.push(buildEdgeUpsertStatement(edge));
    statements.push(...buildEvidenceLinkStatements(edge.evidence_links.statements, `edge-${edge.payload.id}`));
  }
  for (const profile of lesson.domain_profiles) {
    statements.push(buildDomainProfileUpsertStatement(profile));
    statements.push(...buildEvidenceLinkStatements(profile.evidence_links.statements, `domain-profile-${profile.payload.id}`));
  }
  for (const mention of lesson.mentions) {
    statements.push(buildMentionUpsertStatement(mention));
    statements.push(...buildEvidenceLinkStatements(mention.evidence_links.statements, `mention-${mention.payload.id}`));
  }
  for (const card of lesson.node_cards) {
    statements.push(buildNodeCardUpsertStatement(card));
    statements.push(...buildEvidenceLinkStatements(card.evidence_links.statements, `node-card-${card.payload.id}`));
    for (const section of card.section_evidence_links) {
      statements.push(...buildEvidenceLinkStatements(section.evidence_links.statements, `node-card-section-${section.owner_id}`));
    }
  }
  return statements;
}

function buildMergeRunStartStatement(datasetId: string, mergeRunId: string, selection: string[], now: string): SqlStatement {
  return {
    name: "upsert-world-merge-run-start",
    sql: [
      "INSERT INTO world_merge_runs (dataset_id, merge_run_id, selection_json, stats_json, status, created_at, updated_at)",
      "VALUES ($1, $2, $3::jsonb, '{}'::jsonb, 'in_progress', $4, $5)",
      "ON CONFLICT (dataset_id, merge_run_id) DO UPDATE SET",
      "selection_json = EXCLUDED.selection_json,",
      "status = 'in_progress',",
      "updated_at = EXCLUDED.updated_at",
    ].join("\n"),
    params: [datasetId, mergeRunId, selection, now, now],
  };
}

function buildMergeRunCompleteStatement(datasetId: string, mergeRunId: string, stats: SqlRow, now: string): SqlStatement {
  return {
    name: "complete-world-merge-run",
    sql: [
      "UPDATE world_merge_runs",
      "SET stats_json = $1::jsonb, status = 'completed', updated_at = $2",
      "WHERE dataset_id = $3 AND merge_run_id = $4",
    ].join("\n"),
    params: [stats, now, datasetId, mergeRunId],
  };
}

function buildLessonStatusStatement(datasetId: string, lessonRunId: string, status: "merging" | "merged", now: string): SqlStatement {
  return {
    name: `mark-world-lesson-run-${status}`,
    sql: "UPDATE world_lesson_runs SET status = $1, updated_at = $2 WHERE dataset_id = $3 AND lesson_run_id = $4",
    params: [status, now, datasetId, lessonRunId],
  };
}

function buildNodeUpsertStatement(plan: StagedNodeMergePlan): SqlStatement {
  const row = {
    dataset_id: plan.canonical_node_map_payload.dataset_id,
    id: plan.node_payload.id,
    name: plan.node_payload.name,
    kind: plan.node_payload.kind,
    subkind: plan.node_payload.subkind,
    definition: plan.node_payload.definition,
    aliases_json: plan.node_payload.aliases,
    domains_json: plan.node_payload.domains,
    knowledge_form_json: plan.node_payload.knowledge_form,
    learning_mode_json: plan.node_payload.learning_mode,
    scope: plan.node_payload.scope,
    properties_json: plan.node_payload.properties,
    external_ids_json: plan.node_payload.external_ids,
    tags_json: plan.node_payload.tags,
    embedding: formatPgvector(plan.node_payload.embedding),
    status: plan.node_payload.status ?? "active",
    deprecated_by: null,
    created_at: plan.node_payload.created_at,
    updated_at: plan.node_payload.updated_at,
    notes: plan.node_payload.notes ?? "",
  };
  return buildStatement({
    name: "upsert-world-node",
    table: "world_nodes",
    columns: [
      "dataset_id",
      "id",
      "name",
      "kind",
      "subkind",
      "definition",
      "aliases_json",
      "domains_json",
      "knowledge_form_json",
      "learning_mode_json",
      "scope",
      "properties_json",
      "external_ids_json",
      "tags_json",
      "embedding",
      "status",
      "deprecated_by",
      "created_at",
      "updated_at",
      "notes",
    ],
    row,
    conflict: [
      "ON CONFLICT (dataset_id, id) DO UPDATE SET",
      "name = EXCLUDED.name,",
      "definition = EXCLUDED.definition,",
      "aliases_json = EXCLUDED.aliases_json,",
      "domains_json = EXCLUDED.domains_json,",
      "knowledge_form_json = EXCLUDED.knowledge_form_json,",
      "learning_mode_json = EXCLUDED.learning_mode_json,",
      "scope = EXCLUDED.scope,",
      "properties_json = EXCLUDED.properties_json,",
      "external_ids_json = EXCLUDED.external_ids_json,",
      "tags_json = EXCLUDED.tags_json,",
      "embedding = COALESCE(EXCLUDED.embedding, world_nodes.embedding),",
      "status = EXCLUDED.status,",
      "updated_at = EXCLUDED.updated_at,",
      "notes = EXCLUDED.notes",
    ],
  });
}

function buildCanonicalNodeMapStatement(plan: StagedNodeMergePlan): SqlStatement {
  return buildStatement({
    name: "upsert-world-canonical-node-map",
    table: "world_canonical_node_map",
    columns: ["dataset_id", "merge_run_id", "lesson_run_id", "raw_node_id", "canonical_node_id", "resolution", "similarity", "rationale_json", "created_at"],
    row: plan.canonical_node_map_payload,
    conflict: [
      "ON CONFLICT (dataset_id, merge_run_id, lesson_run_id, raw_node_id) DO UPDATE SET",
      "canonical_node_id = EXCLUDED.canonical_node_id,",
      "resolution = EXCLUDED.resolution,",
      "similarity = EXCLUDED.similarity,",
      "rationale_json = EXCLUDED.rationale_json",
    ],
  });
}

function buildEvidenceInsertStatement(plan: EvidenceMergePlan): SqlStatement {
  return buildStatement({
    name: "insert-world-evidence",
    table: "world_evidence",
    columns: [
      "dataset_id",
      "id",
      "source_type",
      "source_id",
      "anchor_ref",
      "source_path",
      "page_start",
      "page_end",
      "excerpt",
      "locator",
      "modality",
      "extraction_method",
      "normalized_claims_json",
      "properties_json",
      "created_at",
      "updated_at",
    ],
    row: plan.payload,
    conflict: ["ON CONFLICT (dataset_id, id) DO NOTHING"],
  });
}

function buildEdgeUpsertStatement(plan: EdgeMergePlan): SqlStatement {
  return buildStatement({
    name: "upsert-world-edge",
    table: "world_edges",
    columns: ["dataset_id", "id", "type", "from_id", "to_id", "directionality", "confidence", "source_refs_json", "properties_json", "status", "created_at", "updated_at", "notes"],
    row: plan.payload,
    conflict: [
      "ON CONFLICT (dataset_id, id) DO UPDATE SET",
      "source_refs_json = EXCLUDED.source_refs_json,",
      "properties_json = EXCLUDED.properties_json,",
      "confidence = GREATEST(world_edges.confidence, EXCLUDED.confidence),",
      "updated_at = EXCLUDED.updated_at,",
      "notes = EXCLUDED.notes",
    ],
  });
}

function buildDomainProfileUpsertStatement(plan: DomainProfileMergePlan): SqlStatement {
  return buildStatement({
    name: "upsert-world-domain-profile",
    table: "world_domain_profiles",
    columns: [
      "dataset_id",
      "id",
      "node_id",
      "domain",
      "school_stages_json",
      "curriculum_roles_json",
      "source_refs_json",
      "properties_json",
      "status",
      "created_at",
      "updated_at",
      "notes",
    ],
    row: plan.payload,
    conflict: [
      "ON CONFLICT (dataset_id, id) DO UPDATE SET",
      "school_stages_json = EXCLUDED.school_stages_json,",
      "curriculum_roles_json = EXCLUDED.curriculum_roles_json,",
      "source_refs_json = EXCLUDED.source_refs_json,",
      "properties_json = EXCLUDED.properties_json,",
      "updated_at = EXCLUDED.updated_at,",
      "notes = EXCLUDED.notes",
    ],
  });
}

function buildMentionUpsertStatement(plan: MentionMergePlan): SqlStatement {
  return buildStatement({
    name: "upsert-world-mention",
    table: "world_mentions",
    columns: ["dataset_id", "id", "source_type", "source_id", "anchor_ref", "target_type", "target_id", "role", "source_refs_json", "confidence", "properties_json", "created_at", "updated_at"],
    row: plan.payload,
    conflict: [
      "ON CONFLICT (dataset_id, id) DO UPDATE SET",
      "source_refs_json = EXCLUDED.source_refs_json,",
      "confidence = EXCLUDED.confidence,",
      "properties_json = EXCLUDED.properties_json,",
      "updated_at = EXCLUDED.updated_at",
    ],
  });
}

function buildNodeCardUpsertStatement(plan: NodeCardMergePlan): SqlStatement {
  return buildStatement({
    name: "upsert-world-node-card",
    table: "world_node_cards",
    columns: ["dataset_id", "node_id", "id", "title", "summary", "source_refs_json", "sections_json", "properties_json", "status", "created_at", "updated_at"],
    row: plan.payload,
    conflict: [
      "ON CONFLICT (dataset_id, node_id) DO UPDATE SET",
      "title = EXCLUDED.title,",
      "summary = EXCLUDED.summary,",
      "source_refs_json = EXCLUDED.source_refs_json,",
      "sections_json = EXCLUDED.sections_json,",
      "properties_json = EXCLUDED.properties_json,",
      "updated_at = EXCLUDED.updated_at",
    ],
  });
}

function buildEvidenceLinkStatements(statements: Array<{ sql: string; params: unknown[] }>, namePrefix: string): SqlStatement[] {
  return statements.map((statement, index) => ({
    name: index === 0 ? `delete-evidence-links-${namePrefix}` : `upsert-evidence-link-${namePrefix}`,
    sql: replacePercentPlaceholders(statement.sql),
    params: statement.params,
  }));
}

function buildStatement(input: { name: string; table: string; columns: string[]; row: SqlRow; conflict: string[] }): SqlStatement {
  const params = input.columns.map((column) => input.row[column]);
  const placeholders = input.columns.map((column, index) => placeholder(index + 1, column)).join(", ");
  return {
    name: input.name,
    sql: [`INSERT INTO ${input.table} (${input.columns.join(", ")})`, `VALUES (${placeholders})`, ...input.conflict].join("\n"),
    params,
  };
}

function placeholder(index: number, column: string): string {
  const cast = JSONB_COLUMNS.has(column) ? "::jsonb" : "";
  return `$${index}${cast}`;
}

function replacePercentPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/%s/g, () => `$${++index}`).trim();
}
