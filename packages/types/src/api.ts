import type {
  ApiNode, ApiEdge, ApiProfile, ApiMention, ApiEvidence, ApiNodeCard,
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

// ── Error ─────────────────────────────────────────────────

export interface ApiErrorResponse {
  error: string;
}
