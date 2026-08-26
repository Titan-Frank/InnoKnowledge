import type {
  ApiNode, ApiEdge, ApiProfile, ApiMention, ApiEvidence, ApiNodeCard, ApiUnit,
} from './models.js';
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
  framework: Framework;
  patterns: PatternLibrary;
  books: ApiBookBundle[];
  loadWarnings: string[];
}

export interface SemanticNeighbor {
  node_id: string;
  similarity: number;
}

export interface SemanticNeighborsResponse {
  dataset_id: string;
  node_id: string;
  neighbors: SemanticNeighbor[];
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
    blocked_lesson_count: number;
    manual_pending_items: number;
  };
  lessons: PipelineQualityLessonRow[];
}

export type PipelineQualityReviewAction = 'accept' | 'resolved';

export interface PipelineQualityReviewUpdateRequest {
  action: PipelineQualityReviewAction;
  note?: string;
}

export interface PipelineQualityReviewUpdateResponse {
  status: 'success';
  lesson_run_id: string;
  action: PipelineQualityReviewAction;
  reviewed_at: string;
}

export type PipelineLessonBackendKind = 'openai_responses' | 'openai_chat_completions';
export type PipelineExtractionTemplateId = 'auto' | string;
export type PipelineStartStage =
  | 'mineru_source_markdown'
  | 'extract_pdf_outline'
  | 'prepare_source_markdown'
  | 'ensure_outline'
  | 'prepare_outline_chunks'
  | 'lesson_plan'
  | 'lesson_staging'
  | 'staging_quality'
  | 'canonical_commit'
  | 'normalize'
  | 'node_bodies'
  | 'pedagogical_profiles'
  | 'node_embeddings'
  | 'unit_embeddings'
  | 'strict_qa'
  | 'graph_integrity'
  | 'quality_dashboard';

export interface PipelineStartRequest {
  resume_job_id?: string;
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
  start_stage?: PipelineStartStage;
}

export interface PipelineStartResponse {
  job_id: string;
  status: 'started';
  command: string[];
  log_path: string;
}

export interface PipelinePdfUploadResponse {
  pdf_path: string;
  file_name: string;
  size_bytes: number;
}

export interface PipelineFolderScanRequest {
  folder_path: string;
  recursive?: boolean;
}

export interface PipelineFolderPdf {
  pdf_path: string;
  file_name: string;
  relative_path: string;
  size_bytes: number;
}

export interface PipelineFolderScanResponse {
  folder_path: string;
  recursive: boolean;
  files: PipelineFolderPdf[];
}

export interface PipelineBookNode {
  id: string;
  name: string;
  kind: string;
  subkind: string | null;
  definition: string;
  status: string;
  ownership: 'created' | 'review' | 'matched';
  lesson_count: number;
  shared: boolean;
  updated_at: string | null;
}

export interface PipelineBookNodesResponse {
  dataset_id: string;
  book_id: string;
  total: number;
  nodes: PipelineBookNode[];
}

export interface PipelineJobSummary {
  job_id: string;
  book_id: string;
  book_title: string;
  status: 'running' | 'completed' | 'blocked';
  current_stage_id: string | null;
  current_stage_label: string | null;
  progress: Record<string, unknown>;
  log_path: string;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface PipelineJobListResponse {
  dataset_id: string;
  jobs: PipelineJobSummary[];
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
  book_title?: string;
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

export interface PgAdminColumn {
  name: string;
  data_type: string;
  udt_name: string;
  nullable: boolean;
  primary_key: boolean;
  editable: boolean;
}

export interface PgAdminTable {
  name: string;
  group: 'catalog' | 'canonical' | 'evidence' | 'pipeline' | 'staging' | 'runtime';
  mutable: boolean;
  estimated_rows: number;
  primary_key: string[];
  columns: PgAdminColumn[];
}

export interface PgAdminCatalogResponse {
  dataset_id: string;
  schema_version: string;
  export_max_bytes: number;
  tables: PgAdminTable[];
}

export interface PgAdminRowsResponse {
  dataset_id: string;
  table: PgAdminTable;
  rows: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}

export interface PgAdminUpdateRequest {
  primary_key: Record<string, unknown>;
  changes: Record<string, unknown>;
}

export interface PgAdminDeleteRequest {
  primary_key: Record<string, unknown>;
  confirmation: string;
}

export interface PgAdminMutationResponse {
  status: 'success';
  table: string;
  affected: number;
  row?: Record<string, unknown>;
}

export interface PgAdminBookSummary {
  book_id: string;
  title: string;
  lesson_runs: number;
  pipeline_jobs: number;
  running_jobs: number;
  canonical_nodes: number;
  shared_nodes: number;
  edges: number;
  evidence: number;
  mentions: number;
  updated_at: string | null;
  deletable: boolean;
  blocker?: string;
}

export interface PgAdminBooksResponse {
  dataset_id: string;
  books: PgAdminBookSummary[];
}

export interface PgAdminBookDeleteRequest {
  confirmation: string;
}

export interface PgAdminBookDeleteResponse {
  status: 'success';
  dataset_id: string;
  book_id: string;
  deleted: Record<string, number>;
}

export interface PgAdminExportRequest {
  tables: string[];
  include_books: boolean;
}

export interface PgAdminExportTable {
  columns: PgAdminColumn[];
  rows: Array<Record<string, unknown>>;
}

export interface PgAdminExportPayload {
  export_version: 'pg-admin-v1';
  exported_at: string;
  dataset_id: string;
  schema_version: string;
  books?: PgAdminBookSummary[];
  tables: Record<string, PgAdminExportTable>;
}

export interface ApiErrorResponse {
  error: string;
}
