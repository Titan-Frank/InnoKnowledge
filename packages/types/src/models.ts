// ── Node ──────────────────────────────────────────────────

export type NodeKind =
  | 'concept' | 'entity' | 'activity' | 'method'
  | 'principle' | 'representation';

export type NodeSubkind = 'substance' | 'equipment' | string;

export type NodeLayer = 'backbone' | 'support';

export type LearningMode =
  | 'factual' | 'conceptual' | 'procedural' | 'metacognitive';

export type NodeStatus = 'candidate' | 'active' | 'merged' | 'deprecated';

export interface ApiNode {
  [key: string]: unknown;
  id: string;
  dataset_id: string;
  canonical_name: string;
  node_kind: NodeKind;
  node_layer: NodeLayer;
  node_subkind: string | null;
  definition: string | null;
  aliases: string[];
  learning_modes: LearningMode[];
  bridge_tags: string[];
  framework_refs: string[];
  properties: Record<string, unknown>;
  status: NodeStatus;
  deprecated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  notes: string | null;
  community_id: number | null;
  pca_x: number | null;
  pca_y: number | null;
}

// ── Edge ──────────────────────────────────────────────────

export type EdgeType =
  | 'is_a' | 'instance_of' | 'part_of' | 'contains'
  | 'prerequisite_for' | 'depends_on' | 'extends'
  | 'explains' | 'causes' | 'affects' | 'has_property'
  | 'uses' | 'measures' | 'produces' | 'consumes'
  | 'related_to';

export type EdgeLayer = 'backbone' | 'support';

export interface ApiEdge {
  [key: string]: unknown;
  id: string;
  dataset_id: string;
  edge_type: EdgeType;
  edge_layer: EdgeLayer;
  from_id: string;
  to_id: string;
  from: string;
  to: string;
  directionality: 'directed' | 'undirected';
  confidence: number;
  backbone_expand: boolean;
  source_refs: string[];
  properties: Record<string, unknown>;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

// ── Profile ───────────────────────────────────────────────

export interface ApiProfile {
  [key: string]: unknown;
  id: string;
  dataset_id: string;
  node_id: string;
  subject: string;
  school_stage: string;
  grade_band: string;
  context_key: string;
  curriculum_role: string;
  mastery_level: string;
  learning_objectives: string[];
  framework_refs: string[];
  textbook_refs: string[];
  textbook_ids: string[];
  assessment_signals: string[];
  source_refs: string[];
  properties: Record<string, unknown>;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

// ── Mention ───────────────────────────────────────────────

export interface ApiMention {
  [key: string]: unknown;
  id: string;
  dataset_id: string;
  source_type: string;
  source_id: string;
  anchor_ref: string;
  target_type: string;
  target_id: string;
  role: string;
  source_refs: string[];
  confidence: number;
  properties: Record<string, unknown>;
}

// ── Evidence ──────────────────────────────────────────────

export interface ApiEvidence {
  [key: string]: unknown;
  id: string;
  dataset_id: string;
  source_type: string;
  source_id: string;
  anchor_ref: string;
  excerpt: string;
  locator: string;
  extraction_method: string;
  normalized_claims: string[];
  properties: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
}

// ── Node Card ─────────────────────────────────────────────

export interface NodeCardSection {
  id: string;
  title: string;
  section_type: string;
  required: boolean;
  content: unknown;
  source_refs?: string[];
}

export interface ApiNodeCard {
  [key: string]: unknown;
  node_id: string;
  card_layer: string;
  title: string;
  summary: string;
  pattern_refs: string[];
  framework_refs: string[];
  profile_refs: string[];
  mention_refs: string[];
  source_refs: string[];
  sections: NodeCardSection[];
  properties: Record<string, unknown>;
  status: string;
  id?: string;
  updated_at?: string | null;
}

// ── Unit View ────────────────────────────────────────────

export interface ApiUnitBody {
  format: 'markdown';
  content: string;
  media_refs: Array<Record<string, unknown>>;
  source_refs: string[];
  generated_from: string;
}

export interface ApiUnitMedia {
  id: string;
  kind: 'image';
  url: string;
  path: string;
  caption: string;
  evidence_id: string;
  source_id: string;
  anchor_ref: string;
  page_start: number | null;
  page_end: number | null;
}

export interface ApiUnit {
  node: Record<string, unknown>;
  relations: {
    outgoing: Record<string, unknown>[];
    incoming: Record<string, unknown>[];
  };
  domain_profiles: Record<string, unknown>[];
  mentions: ApiMention[];
  evidence: ApiEvidence[];
  media: ApiUnitMedia[];
  source_fragments?: Array<Record<string, unknown>>;
  card: ApiNodeCard | null;
  body: ApiUnitBody | null;
}
