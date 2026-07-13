import type { EdgeType, RelationScope } from './relations.js';

// ── Node ──────────────────────────────────────────────────

export type NodeKind =
  | 'entity' | 'concept' | 'property' | 'process' | 'event'
  | 'method' | 'rule' | 'representation' | 'resource';

export type NodeSubkind = 'substance' | 'equipment' | string;

export type NodeLayer = 'backbone' | 'support';

export type LearningMode =
  | 'factual' | 'conceptual' | 'procedural' | 'metacognitive';

export type NodeStatus = 'draft' | 'active' | 'deprecated';

export interface SemanticCoreProperties {
  core_claims?: string[];
  formal_expressions?: string[];
  conditions?: string[];
  boundaries?: string[];
  counterexamples?: string[];
  misconceptions?: string[];
}

export interface NodeProperties {
  [key: string]: unknown;
  semantic_core?: SemanticCoreProperties;
  domains?: string[];
  knowledge_form?: Array<'propositional' | 'practical'>;
  scope?: 'universal' | 'domain-specific' | 'culture-specific' | '';
  tags?: string[];
  learning_modes?: LearningMode[];
  bridge_tags?: string[];
  bridge_role?: 'semantic_bridge' | 'method_bridge' | 'analogy_bridge';
}

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
  properties: NodeProperties;
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

export type EdgeLayer = 'backbone' | 'support';

export interface EdgeProperties {
  [key: string]: unknown;
  relation_scope?: RelationScope;
  qualifiers?: Record<string, unknown>;
  bridge_object_ids?: string[];
  interdisciplinary?: Record<string, unknown>;
}

export interface ApiEdge {
  [key: string]: unknown;
  id: string;
  dataset_id: string;
  edge_type: EdgeType;
  edge_type_label_zh: string;
  edge_layer: EdgeLayer;
  from_id: string;
  to_id: string;
  from: string;
  to: string;
  directionality: 'directed' | 'undirected';
  confidence: number;
  backbone_expand: boolean;
  source_refs: string[];
  properties: EdgeProperties;
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
  domain: string;
  schema_id: string;
  schema_version: string;
  domain_role: string;
  source_refs: string[];
  properties: Record<string, unknown>;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  notes?: string | null;
  framework_refs?: string[];
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
  node_id?: string;
  format: 'markdown';
  content: string;
  media_refs: Array<Record<string, unknown>>;
  source_refs: string[];
  generated_from: 'manual' | 'card_expansion' | 'imported_unit' | 'model_generation';
  properties: Record<string, unknown>;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
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

export interface ApiUnitNode {
  [key: string]: unknown;
  id: string;
  dataset_id: string;
  name: string;
  kind: NodeKind;
  subkind: string | null;
  definition: string;
  aliases: string[];
  domains: string[];
  knowledge_form: Array<'propositional' | 'practical'>;
  learning_mode: LearningMode[];
  scope: 'universal' | 'domain-specific' | 'culture-specific' | null;
  properties: NodeProperties;
  external_ids: Record<string, string>;
  tags: string[];
  status: NodeStatus;
  deprecated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  notes: string | null;
}

export interface ApiUnitRelation {
  [key: string]: unknown;
  id: string;
  dataset_id: string;
  type: EdgeType;
  edge_type?: EdgeType;
  type_label_zh: string;
  from_id: string;
  to_id: string;
  directionality: 'directed' | 'undirected';
  confidence: number;
  source_refs: string[];
  properties: EdgeProperties;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  notes?: string | null;
}

export type PedagogicalDifficultyLevel = 'introductory' | 'basic' | 'intermediate' | 'advanced' | 'expert';

export type PedagogicalProfileReviewStatus = 'pending' | 'approved' | 'rejected';

export type PedagogicalSchoolStage = 'primary' | 'junior-secondary' | 'senior-secondary' | 'higher';

export interface PedagogicalProfileContent {
  learning_objectives?: string[];
  difficulty_level?: PedagogicalDifficultyLevel;
  diagnostic_questions?: string[];
  common_errors?: string[];
  assessment_tasks?: string[];
  remediation_suggestions?: string[];
  extension_suggestions?: string[];
}

export interface PedagogicalProfileProperties extends PedagogicalProfileContent {}

export interface PedagogicalModelProfileGeneration {
  generated_from: 'model_generation';
  model: string;
  prompt_version: string;
  generated_at: string;
  input_fingerprint: string;
  review_status: PedagogicalProfileReviewStatus;
  confidence: number;
  source_refs: string[];
}

export interface PedagogicalManualProfileGeneration {
  generated_from: 'manual';
  review_status?: PedagogicalProfileReviewStatus;
  source_refs?: string[];
}

export type PedagogicalProfileGeneration = PedagogicalModelProfileGeneration | PedagogicalManualProfileGeneration;

export interface PedagogicalStageProfileProperties {
  school_stage: PedagogicalSchoolStage;
  grade_band?: string;
  learning_objectives: string[];
  difficulty_level: PedagogicalDifficultyLevel;
  diagnostic_questions: string[];
  common_errors: string[];
  assessment_tasks: string[];
  remediation_suggestions: string[];
  extension_suggestions: string[];
  generation?: PedagogicalProfileGeneration;
}

export interface DomainProfileProperties {
  [key: string]: unknown;
}

export interface ApiUnitDomainProfile {
  [key: string]: unknown;
  id: string;
  dataset_id: string;
  node_id: string;
  domain: string;
  schema_id: string;
  schema_version: string;
  domain_role: string;
  source_refs: string[];
  properties: DomainProfileProperties;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  notes?: string | null;
}

export interface CurriculumProjectionProperties {
  [key: string]: unknown;
  pedagogical_profile?: PedagogicalStageProfileProperties;
}

export interface ApiUnitCurriculumProjection {
  [key: string]: unknown;
  id: string;
  dataset_id: string;
  node_id: string;
  domain: string;
  curriculum_id: string;
  school_stage: PedagogicalSchoolStage;
  grade_band: string | null;
  curriculum_roles: string[];
  source_refs: string[];
  properties: CurriculumProjectionProperties;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  notes?: string | null;
}

export interface ApiUnitSourceFragment {
  [key: string]: unknown;
  source_id: string;
  anchor_ref: string;
  source_type?: string;
  source_path?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  modalities: string[];
  excerpts: ApiEvidence[];
}

export type ApiUnitCompletenessSeverity = 'required' | 'recommended';

export interface ApiUnitCompletenessSignal {
  key: string;
  label: string;
  passed: boolean;
  severity: ApiUnitCompletenessSeverity;
  message: string;
}

export interface ApiUnitCompleteness {
  score: number;
  passed: number;
  total: number;
  signals: ApiUnitCompletenessSignal[];
}

export interface ApiUnit {
  node: ApiUnitNode;
  relations: {
    outgoing: ApiUnitRelation[];
    incoming: ApiUnitRelation[];
  };
  domain_profiles: ApiUnitDomainProfile[];
  curriculum_projections: ApiUnitCurriculumProjection[];
  mentions: ApiMention[];
  evidence: ApiEvidence[];
  media: ApiUnitMedia[];
  source_fragments: ApiUnitSourceFragment[];
  card: ApiNodeCard | null;
  body: ApiUnitBody | null;
  completeness: ApiUnitCompleteness;
}
