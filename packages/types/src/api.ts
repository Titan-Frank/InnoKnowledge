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

export type PipelineLessonBackendKind = 'openai_responses' | 'openai_chat_completions';
export type PipelineExtractionStrategy = 'hybrid' | 'single_pass';
export type PipelineNodeBodyMode = 'card' | 'model';
export type PipelineExtractionTemplateId = 'auto' | string;

export interface PipelineStartRequest {
  book_id: string;
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
  extraction_strategy?: PipelineExtractionStrategy;
  extraction_template?: PipelineExtractionTemplateId;
  quality_retry_count?: number;
  model_retry_count?: number;
  node_body_mode?: PipelineNodeBodyMode;
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
  book_id: string;
  pdf_path?: string;
}

export interface TextbookMetadataResponse {
  book_id: string;
  title: string;
  lesson_subject: string;
  lesson_school_stage: string;
  lesson_grade_band: string;
  confidence: number;
  signals: string[];
}

// ── Image Review ─────────────────────────────────────────

export type ImageReviewRelevance = 'core_content' | 'supporting' | 'decorative' | 'mismatch' | 'uncertain';
export type ImageReviewStatus = 'auto' | 'pending' | 'confirmed' | 'rejected';
export type ImageReviewAction = 'keep' | 'drop' | 'core_content' | 'supporting' | 'uncertain';

export interface ImageReviewDecision {
  keep: boolean;
  relevance: ImageReviewRelevance;
  reason: string;
  source: 'vlm' | 'fallback' | 'manual';
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
