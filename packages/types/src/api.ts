import type {
  ApiNode, ApiEdge, ApiProfile, ApiMention, ApiEvidence, ApiNodeCard, ApiUnit, ApiUnitCurriculumProjection, NodeKind,
} from './models.js';
import type { EdgeType } from './relations.js';
import type { Framework } from './framework.js';
import type { PatternLibrary } from './patterns.js';
import type { OutlineData } from './outline.js';

// ── GET /api/health ───────────────────────────────────────

export interface HealthResponse {
  ok: true;
  db: string;
}

// ── GET /api/meta ─────────────────────────────────────────

export interface SourceSummary {
  [key: string]: unknown;
  key: string;
  label: string;
  description: string;
  has_profiles: boolean;
  book_count: number;
  books: Array<{ book_id: string }>;
  is_active: boolean;
  root_path: string;
}

export interface MetaResponse {
  active_source: string | null;
  sources: SourceSummary[];
}

// ── GET /api/source/:key/bundle ───────────────────────────

export interface BundleSourceInfo {
  key: string;
  label: string;
  description: string;
  hasProfiles: boolean;
  isActive: boolean;
  rootPath: string;
  nodeCardPath: string;
}

export interface ApiBookBundle {
  [key: string]: unknown;
  bookId: string;
  outline: OutlineData | null;
  mentions: ApiMention[];
  evidence: ApiEvidence[];
}

export interface BundleResponse {
  source: BundleSourceInfo;
  nodes: ApiNode[];
  edges: ApiEdge[];
  profiles: ApiProfile[];
  curriculum_projections: ApiUnitCurriculumProjection[];
  framework: Framework;
  patterns: PatternLibrary;
  books: ApiBookBundle[];
  loadWarnings: string[];
}

// ── GET /api/annotation/textbooks ────────────────────────

export interface AnnotationLessonSummary {
  lesson_id: string;
  title: string;
  label: string;
  source_path: string;
  md_start: number;
  md_end: number;
  line_count: number;
  page_start: number | null;
  page_end: number | null;
  preview: string;
}

export interface AnnotationTextbookSummary {
  book_id: string;
  title: string;
  source_path: string;
  line_count: number;
  lesson_count: number;
  lessons: AnnotationLessonSummary[];
}

export interface AnnotationTextbookListResponse {
  generated_at: string;
  books: AnnotationTextbookSummary[];
}

export interface AnnotationLessonTextResponse {
  book: Omit<AnnotationTextbookSummary, 'lessons'>;
  lesson: AnnotationLessonSummary & {
    source_text: string;
    lines: string[];
  };
}

// ── GET /api/source/:key/node-card/:node_id ───────────────

export type NodeCardResponse = ApiNodeCard;

// ── GET /api/source/:key/unit/:node_id ──────────────────────

export type UnitResponse = ApiUnit;

// ── GET /api/source/:key/search ───────────────────────────

export interface SearchHit {
  id: string;
  canonical_name: string;
  node_kind: string;
  node_layer: string;
  score: number;
  text_match: boolean;
  vector_match: boolean;
  similarity: number | null;
}

export interface SearchResponse {
  query: string;
  source: string;
  hits: SearchHit[];
  mode: 'full' | 'text_only';
}

// ── Runtime retrieval and grounded generation ─────────────

export type UnitRetrievalMode = 'hybrid' | 'text' | 'vector';
export type UnitRetrievalExecutionMode = 'full' | 'text_only';

export interface UnitRetrievalHit {
  node_id: string;
  canonical_name: string;
  node_kind: string;
  node_layer: string;
  score: number;
  text_match: boolean;
  vector_match: boolean;
  similarity: number | null;
  reasons: string[];
  unit: ApiUnit;
}

export interface UnitRetrievalResponse {
  query: string;
  source: string;
  mode: UnitRetrievalExecutionMode;
  requested_mode: UnitRetrievalMode;
  hits: UnitRetrievalHit[];
}

export interface GroundedGenerationRequest {
  question: string;
  limit?: number;
  retrieval_mode?: UnitRetrievalMode;
}

export interface GroundedGenerationCitation {
  node_id: string;
  evidence_id: string;
  note?: string;
}

export interface GroundedGenerationInvalidCitation extends GroundedGenerationCitation {
  reason: string;
}

export interface GroundedGenerationResponse {
  question: string;
  source: string;
  answer: string;
  citations: GroundedGenerationCitation[];
  unsupported_claims: string[];
  used_node_ids: string[];
  retrieval: UnitRetrievalResponse;
  grounding: {
    status: 'grounded' | 'partial' | 'insufficient_context' | 'model_error';
    valid_citation_count: number;
    invalid_citation_count: number;
    invalid_citations: GroundedGenerationInvalidCitation[];
    cited_evidence_ids: string[];
  };
  model: string;
}

export type GroundedGenerationStreamEvent =
  | {
      type: 'retrieval';
      retrieval: UnitRetrievalResponse;
    }
  | {
      type: 'answer_delta';
      delta: string;
    }
  | {
      type: 'complete';
      response: GroundedGenerationResponse;
    }
  | {
      type: 'error';
      error: string;
    };

// ── GET /api/source/:key/pipeline ────────────────────────

export interface PipelineLessonRun {
  lesson_run_id: string;
  book_id: string;
  batch_anchor: string;
  status: string;
  counts: Record<string, unknown>;
  quality_issues: string[];
  created_at: string | null;
  updated_at: string | null;
}

export interface PipelineMergeRun {
  merge_run_id: string;
  status: string;
  selection: string[];
  stats: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
}

export interface PipelineReviewItem {
  merge_run_id: string;
  lesson_run_id: string;
  raw_node_id: string;
  canonical_node_id: string;
  similarity: number;
  rationale: Record<string, unknown>;
  created_at: string | null;
}

export interface PipelineResponse {
  dataset_id: string;
  summary: {
    lesson_runs: number;
    staged: number;
    merging: number;
    merged: number;
    qa_passed: number;
    blocked: number;
    review_items: number;
  };
  lesson_runs: PipelineLessonRun[];
  merge_runs: PipelineMergeRun[];
  review_items: PipelineReviewItem[];
}

export interface PipelineQualityLessonRow {
  lesson_run_id: string;
  book_id: string;
  batch_anchor: string;
  status: string;
  node_count: number;
  relation_count: number;
  evidence_count: number;
  evidence_coverage: number;
  isolated_node_count: number;
  isolated_node_ratio: number;
  disconnected_components: number;
  image_review_count: number;
  merge_review_count: number;
  quality_review_count: number;
  manual_pending_items: number;
  quality_issues: string[];
  quality_warnings: string[];
  quality_review_required: boolean;
  review_node_ids: string[];
  updated_at: string | null;
}

export interface PipelineQualityDashboardResponse {
  dataset_id: string;
  generated_at: string;
  summary: {
    lesson_count: number;
    node_count: number;
    relation_count: number;
    evidence_count: number;
    evidence_coverage: number;
    isolated_node_count: number;
    isolated_node_ratio: number;
    disconnected_components: number;
    image_review_count: number;
    merge_review_count: number;
    quality_review_count: number;
    interdisciplinary_review_count: number;
    blocked_lesson_count: number;
    manual_pending_items: number;
  };
  lessons: PipelineQualityLessonRow[];
}

export type InterdisciplinaryCandidateKind = 'node_alignment' | 'relation' | 'bridge_path';
export type InterdisciplinaryCandidateStatus = 'pending' | 'approved' | 'rejected' | 'applied';

export interface InterdisciplinaryRun {
  run_id: string;
  domains: string[];
  config: Record<string, unknown>;
  stats: Record<string, unknown>;
  status: 'in_progress' | 'completed' | 'blocked';
  created_at: string;
  completed_at: string | null;
}

export interface InterdisciplinaryCandidate {
  candidate_id: string;
  run_id: string;
  candidate_kind: InterdisciplinaryCandidateKind;
  from_node_id: string;
  from_node_name: string;
  from_node_kind: NodeKind;
  from_node_definition: string;
  to_node_id: string;
  to_node_name: string;
  to_node_kind: NodeKind;
  to_node_definition: string;
  bridge_node_id: string | null;
  bridge_node_name: string | null;
  bridge_node_kind: NodeKind | null;
  bridge_node_definition: string | null;
  bridge_node_domains: string[];
  proposed_edge_type: EdgeType | null;
  directionality: 'directed' | 'undirected' | null;
  proposed_path: InterdisciplinaryPathSegment[];
  confidence: number;
  source_domains: string[];
  target_domains: string[];
  evidence_refs: string[];
  evidence: InterdisciplinaryEvidenceSummary[];
  rationale: Record<string, unknown>;
  status: InterdisciplinaryCandidateStatus;
  reviewer: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  applied_edge_id: string | null;
  applied_edge_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface InterdisciplinaryEvidenceSummary {
  evidence_id: string;
  source_type: string;
  source_type_label_zh: string;
  source_id: string;
  anchor_ref: string;
  excerpt: string;
  locator: string;
  modality: string | null;
  page_start: number | null;
  page_end: number | null;
}

export interface InterdisciplinaryPathSegment {
  from_node_id: string;
  from_node_name?: string;
  to_node_id: string;
  to_node_name?: string;
  relation_type: EdgeType;
  relation_type_label_zh: string;
  directionality: 'directed' | 'undirected';
  evidence_refs: string[];
}

export interface InterdisciplinaryBridgeNode {
  node_id: string;
  name: string;
  kind: string;
  domains: string[];
  degree: number;
  evidence_count: number;
}

export interface InterdisciplinaryDomainSummary {
  domain: string;
  node_count: number;
  bridge_node_count: number;
}

export interface InterdisciplinaryDomainPairSummary {
  source_domain: string;
  target_domain: string;
  shared_node_count: number;
  cross_domain_edge_count: number;
  pending_candidate_count: number;
}

export interface InterdisciplinaryOverviewResponse {
  dataset_id: string;
  generated_at: string;
  summary: {
    domain_count: number;
    bridge_node_count: number;
    cross_domain_edge_count: number;
    pending_alignment_count: number;
    pending_relation_count: number;
    pending_bridge_path_count: number;
    approved_candidate_count: number;
  };
  domains: InterdisciplinaryDomainSummary[];
  domain_pairs: InterdisciplinaryDomainPairSummary[];
  bridge_nodes: InterdisciplinaryBridgeNode[];
  candidates: InterdisciplinaryCandidate[];
  latest_run: InterdisciplinaryRun | null;
}

export interface InterdisciplinaryAnalyzeRequest {
  domains?: string[];
  minimum_alignment_score?: number;
  minimum_relation_score?: number;
  maximum_candidates?: number;
  replace_pending?: boolean;
}

export interface InterdisciplinaryAnalyzeResponse {
  run: InterdisciplinaryRun;
  candidates_created: number;
  alignment_candidates: number;
  relation_candidates: number;
  bridge_path_candidates: number;
}

export interface InterdisciplinaryReviewRequest {
  decision: 'approve' | 'reject';
  relation_type?: string;
  directionality?: 'directed' | 'undirected';
  reverse_direction?: boolean;
  evidence_ids?: string[];
  path?: Array<{
    from_node_id: string;
    to_node_id: string;
    relation_type: string;
    directionality: 'directed' | 'undirected';
    evidence_ids: string[];
  }>;
  reviewer?: string;
  notes?: string;
}

export interface InterdisciplinaryReviewResponse {
  candidate: InterdisciplinaryCandidate;
}

export interface InterdisciplinaryApplyResponse {
  dataset_id: string;
  applied: number;
  alignments_applied: number;
  relations_applied: number;
  bridge_paths_applied: number;
  skipped: number;
  candidates: Array<{
    candidate_id: string;
    candidate_kind: InterdisciplinaryCandidateKind;
    canonical_node_id?: string;
    deprecated_node_ids?: string[];
    edge_id?: string;
    edge_ids?: string[];
    status: 'applied' | 'skipped';
  }>;
}

export type PipelineLessonBackendKind = 'openai_responses' | 'openai_chat_completions';
export type PipelineExtractionTemplateId = 'auto' | string;

export interface PipelineStartRequest {
  book_id?: string;
  pdf_path?: string;
  book_title?: string;
  outline_start_page?: number;
  outline_end_page?: number;
  mineru_file_url?: string;
  mineru_base_url?: string;
  mineru_model_version?: string;
  mineru_language?: string;
  mineru_page_ranges?: string;
  mineru_force?: boolean;
  dataset_id?: string;
  output_root?: string;
  parallelism?: number;
  extraction_template?: PipelineExtractionTemplateId;
  quality_retry_count?: number;
  model_retry_count?: number;
  lesson_backend_kind?: PipelineLessonBackendKind;
  lesson_subject?: string;
  lesson_school_stage?: string;
  lesson_grade_band?: string;
  openai_base_url?: string;
  openai_model?: string;
  vlm_api_url?: string;
  vlm_api_key?: string;
  vlm_model?: string;
}

export interface PipelineStartResponse {
  job_id: string;
  status: 'started';
  command: string[];
  log_path: string;
}

export interface PipelineJobStage {
  id: string;
  status: string;
  label: string;
  progress: Record<string, unknown>;
  error?: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}

export interface PipelineWorkerState {
  worker_slot: number;
  stage_id: string;
  status: string;
  lesson_run_id: string | null;
  batch_anchor: string | null;
  error: string | null;
  data: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}

export interface PipelineJobEvent {
  event_id: string;
  stage_id: string;
  event_type: string;
  status: string | null;
  worker_slot: number | null;
  lesson_run_id: string | null;
  batch_anchor: string | null;
  detail: string | null;
  data: Record<string, unknown>;
  created_at: string | null;
}

export interface PipelineJobStatusResponse {
  job_id: string;
  book_id: string;
  status: 'unknown' | 'running' | 'completed' | 'blocked';
  log_path: string;
  progress: Record<string, unknown>;
  stages: PipelineJobStage[];
  current_stage: PipelineJobStage | null;
  worker_states: PipelineWorkerState[];
  recent_events: PipelineJobEvent[];
  updated_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface TextbookMetadataRequest {
  book_id?: string;
  pdf_path?: string;
  mineru_file_url?: string;
}

export interface TextbookMetadataResponse {
  book_id: string;
  title: string;
  lesson_subject: string;
  lesson_school_stage: string;
  lesson_grade_band: string;
  mineru_language: string;
  mineru_page_ranges: string;
  outline_start_page: number;
  outline_end_page: number;
  extraction_template: PipelineExtractionTemplateId;
  confidence: number;
  signals: string[];
}

// ── Image Review ─────────────────────────────────────────

export type ImageReviewRelevance = 'core_content' | 'supporting' | 'decorative' | 'mismatch' | 'uncertain';
export type ImageReviewStatus = 'auto' | 'pending' | 'approved' | 'confirmed' | 'rejected';
export type ImageReviewAction = 'keep' | 'drop' | 'core_content' | 'supporting' | 'uncertain';

export interface ImageReviewDecision {
  keep: boolean;
  relevance: ImageReviewRelevance;
  reason: string;
  source: 'vlm' | 'fallback' | 'manual';
  visual_summary?: string;
  confidence?: number;
  path?: string;
  width?: number;
  height?: number;
  review_status?: ImageReviewStatus;
  reviewed_at?: string;
  reviewed_by?: string;
  manual_action?: ImageReviewAction;
}

export interface ImageReviewContext {
  source_path: string;
  source_line: number | null;
  heading_path: string[];
  before: string[];
  image_line: string;
  after: string[];
}

export interface ImageReviewItem {
  evidence_id: string;
  source_id: string;
  anchor_ref: string;
  source_path: string;
  locator: string;
  excerpt: string;
  page_start: number | null;
  page_end: number | null;
  image_url: string;
  image_path: string;
  context: ImageReviewContext;
  decision: ImageReviewDecision;
  updated_at: string | null;
}

export interface ImageReviewResponse {
  dataset_id: string;
  pending: number;
  items: ImageReviewItem[];
}

export interface ImageReviewUpdateRequest {
  action: ImageReviewAction;
  reason?: string;
}

export interface ImageReviewUpdateResponse {
  status: 'success';
  item: ImageReviewItem | null;
}

// ── Error ─────────────────────────────────────────────────

export interface ApiErrorResponse {
  error: string;
}
