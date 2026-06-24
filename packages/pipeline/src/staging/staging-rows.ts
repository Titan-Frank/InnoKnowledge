import { VALID_SCOPE } from "../shared/knowledge.js";
import type {
  NormalizedDomainProfile,
  NormalizedEdge,
  NormalizedEvidence,
  NormalizedLessonArtifacts,
  NormalizedMention,
  NormalizedNode,
  NormalizedNodeCard,
} from "./staging.js";

export type StagingWriteContext = {
  datasetId: string;
  lessonRunId: string;
  bookId: string;
  batchAnchor: string;
  now: string;
};

export type LessonRunRow = {
  dataset_id: string;
  lesson_run_id: string;
  book_id: string;
  batch_anchor: string;
  status: "staged";
  counts_json: NormalizedLessonArtifacts["counts"];
  properties_json: Record<string, never>;
  created_at: string;
  updated_at: string;
};

export type StagingNodeRow = {
  dataset_id: string;
  lesson_run_id: string;
  raw_node_id: string;
  book_id: string;
  batch_anchor: string;
  name: string;
  kind: string;
  subkind: string | null;
  definition: string;
  aliases_json: string[];
  domains_json: string[];
  knowledge_form_json: string[];
  learning_mode_json: string[];
  scope: string;
  properties_json: Record<string, unknown>;
  external_ids_json: Record<string, unknown>;
  tags_json: string[];
  semantic_key: string;
  embedding: unknown;
  source_refs_json: string[];
  status: string;
  created_at: string;
  updated_at: string;
  notes: string;
};

export type StagingEdgeRow = {
  dataset_id: string;
  lesson_run_id: string;
  raw_edge_id: string;
  book_id: string;
  batch_anchor: string;
  type: string;
  from_raw_node_id: string;
  to_raw_node_id: string;
  directionality: string;
  confidence: number;
  source_refs_json: string[];
  properties_json: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
  notes: string;
};

export type StagingDomainProfileRow = {
  dataset_id: string;
  lesson_run_id: string;
  raw_profile_id: string;
  raw_node_id: string;
  domain: string;
  school_stages_json: string[];
  curriculum_roles_json: string[];
  source_refs_json: string[];
  properties_json: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
  notes: string;
};

export type StagingMentionRow = {
  dataset_id: string;
  lesson_run_id: string;
  raw_mention_id: string;
  source_type: string;
  source_id: string;
  anchor_ref: string;
  target_type: string;
  target_raw_id: string;
  role: string;
  source_refs_json: string[];
  confidence: number;
  properties_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type StagingEvidenceRow = {
  dataset_id: string;
  lesson_run_id: string;
  raw_evidence_id: string;
  source_type: string;
  source_id: string;
  anchor_ref: string;
  source_path: string;
  page_start: unknown;
  page_end: unknown;
  excerpt: string;
  locator: string;
  modality: string;
  extraction_method: string;
  normalized_claims_json: string[];
  properties_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type StagingNodeCardRow = {
  dataset_id: string;
  lesson_run_id: string;
  raw_card_id: string;
  raw_node_id: string;
  title: string;
  summary: string;
  source_refs_json: string[];
  sections_json: NormalizedNodeCard["sections_json"];
  properties_json: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
};

export type StagingTableRows = {
  lesson_run: LessonRunRow;
  nodes: StagingNodeRow[];
  edges: StagingEdgeRow[];
  domain_profiles: StagingDomainProfileRow[];
  mentions: StagingMentionRow[];
  evidence: StagingEvidenceRow[];
  node_cards: StagingNodeCardRow[];
};

export function buildStagingTableRows(context: StagingWriteContext, artifacts: NormalizedLessonArtifacts): StagingTableRows {
  return {
    lesson_run: buildLessonRunRow(context, artifacts.counts),
    nodes: artifacts.nodes.map((node) => buildStagingNodeRow(context, node)),
    edges: artifacts.edges.map((edge) => buildStagingEdgeRow(context, edge)),
    domain_profiles: artifacts.domain_profiles.map((profile) => buildStagingDomainProfileRow(context, profile)),
    mentions: artifacts.mentions.map((mention) => buildStagingMentionRow(context, mention)),
    evidence: artifacts.evidence.map((item) => buildStagingEvidenceRow(context, item)),
    node_cards: artifacts.node_cards.map((card) => buildStagingNodeCardRow(context, card)),
  };
}

export function buildLessonRunRow(context: StagingWriteContext, counts: NormalizedLessonArtifacts["counts"]): LessonRunRow {
  return {
    dataset_id: context.datasetId,
    lesson_run_id: context.lessonRunId,
    book_id: context.bookId,
    batch_anchor: context.batchAnchor,
    status: "staged",
    counts_json: counts,
    properties_json: {},
    created_at: context.now,
    updated_at: context.now,
  };
}

export function buildStagingNodeRow(context: StagingWriteContext, node: NormalizedNode): StagingNodeRow {
  return {
    dataset_id: context.datasetId,
    lesson_run_id: context.lessonRunId,
    raw_node_id: node.raw_node_id,
    book_id: context.bookId,
    batch_anchor: context.batchAnchor,
    name: node.name,
    kind: node.kind,
    subkind: node.subkind,
    definition: node.definition,
    aliases_json: node.aliases_json,
    domains_json: node.domains_json,
    knowledge_form_json: node.knowledge_form_json,
    learning_mode_json: node.learning_mode_json,
    scope: VALID_SCOPE.has(node.scope) ? node.scope : "domain-specific",
    properties_json: node.properties_json,
    external_ids_json: node.external_ids_json,
    tags_json: node.tags_json,
    semantic_key: node.semantic_key,
    embedding: node.embedding_json,
    source_refs_json: node.source_refs_json,
    status: node.status,
    created_at: context.now,
    updated_at: context.now,
    notes: node.notes,
  };
}

export function buildStagingEdgeRow(context: StagingWriteContext, edge: NormalizedEdge): StagingEdgeRow {
  return {
    dataset_id: context.datasetId,
    lesson_run_id: context.lessonRunId,
    raw_edge_id: edge.raw_edge_id,
    book_id: context.bookId,
    batch_anchor: context.batchAnchor,
    type: edge.type,
    from_raw_node_id: edge.from_raw_node_id,
    to_raw_node_id: edge.to_raw_node_id,
    directionality: edge.directionality,
    confidence: edge.confidence,
    source_refs_json: edge.source_refs_json,
    properties_json: edge.properties_json,
    status: edge.status,
    created_at: context.now,
    updated_at: context.now,
    notes: edge.notes,
  };
}

export function buildStagingDomainProfileRow(context: StagingWriteContext, profile: NormalizedDomainProfile): StagingDomainProfileRow {
  return {
    dataset_id: context.datasetId,
    lesson_run_id: context.lessonRunId,
    raw_profile_id: profile.raw_profile_id,
    raw_node_id: profile.raw_node_id,
    domain: profile.domain,
    school_stages_json: profile.school_stages_json,
    curriculum_roles_json: profile.curriculum_roles_json,
    source_refs_json: profile.source_refs_json,
    properties_json: profile.properties_json,
    status: profile.status,
    created_at: context.now,
    updated_at: context.now,
    notes: profile.notes,
  };
}

export function buildStagingMentionRow(context: StagingWriteContext, mention: NormalizedMention): StagingMentionRow {
  return {
    dataset_id: context.datasetId,
    lesson_run_id: context.lessonRunId,
    raw_mention_id: mention.raw_mention_id,
    source_type: mention.source_type,
    source_id: mention.source_id,
    anchor_ref: mention.anchor_ref,
    target_type: mention.target_type,
    target_raw_id: mention.target_raw_id,
    role: mention.role,
    source_refs_json: mention.source_refs_json,
    confidence: mention.confidence,
    properties_json: mention.properties_json,
    created_at: context.now,
    updated_at: context.now,
  };
}

export function buildStagingEvidenceRow(context: StagingWriteContext, item: NormalizedEvidence): StagingEvidenceRow {
  return {
    dataset_id: context.datasetId,
    lesson_run_id: context.lessonRunId,
    raw_evidence_id: item.raw_evidence_id,
    source_type: item.source_type,
    source_id: item.source_id,
    anchor_ref: item.anchor_ref,
    source_path: item.source_path,
    page_start: item.page_start,
    page_end: item.page_end,
    excerpt: item.excerpt,
    locator: item.locator,
    modality: item.modality,
    extraction_method: item.extraction_method,
    normalized_claims_json: item.normalized_claims_json,
    properties_json: item.properties_json,
    created_at: context.now,
    updated_at: context.now,
  };
}

export function buildStagingNodeCardRow(context: StagingWriteContext, card: NormalizedNodeCard): StagingNodeCardRow {
  return {
    dataset_id: context.datasetId,
    lesson_run_id: context.lessonRunId,
    raw_card_id: card.raw_card_id,
    raw_node_id: card.raw_node_id,
    title: card.title,
    summary: card.summary,
    source_refs_json: card.source_refs_json,
    sections_json: card.sections_json,
    properties_json: card.properties_json,
    status: card.status,
    created_at: context.now,
    updated_at: context.now,
  };
}
