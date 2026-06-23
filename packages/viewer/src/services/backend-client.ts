import type {
  ApiNodeCard, ApiUnit, MetaResponse, BundleResponse, SearchResponse,
  PipelineResponse, PipelineStartRequest, PipelineStartResponse,
  TextbookMetadataRequest, TextbookMetadataResponse,
} from '@okm/types';

export interface EnrichBookSummary {
  path: string;
  filename: string;
  title: string;
  subject?: string;
  stage?: string;
  grade?: string;
  course?: string;
  publisher?: string;
  volume?: string;
  root_count?: number;
  node_count?: number;
  max_depth?: number;
}

export interface EnrichIndexResponse {
  generated_at?: string;
  book_count: number;
  subject_count: number;
  node_count: number;
  books: EnrichBookSummary[];
}

export interface EnrichNode {
  id: string;
  title?: string;
  depth: number;
  order_path: string;
  title_path: string[];
  child_count: number;
  enrichment?: {
    definition?: string;
    content?: string;
    academic_requirements?: string;
    academic_quality?: string;
    [key: string]: unknown;
  };
  child_nodes: EnrichNode[];
  [key: string]: unknown;
}

export interface EnrichBookResponse {
  book: EnrichBookSummary;
  tree: EnrichNode[];
}

export class BackendError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function fetchJson<T = unknown>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new BackendError(`Failed to load ${path}`, response.status, 'server');
  }
  return response.json() as Promise<T>;
}

export async function fetchOptionalJson<T = unknown>(path: string): Promise<T | null> {
  const response = await fetch(path);
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

export async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new BackendError(`Failed to post ${path}`, response.status, 'server');
  }
  return response.json() as Promise<T>;
}

export async function loadMeta(): Promise<MetaResponse> {
  return fetchJson<MetaResponse>('/api/meta');
}

export async function loadBundle(sourceKey: string): Promise<BundleResponse> {
  return fetchJson<BundleResponse>(`/api/source/${encodeURIComponent(sourceKey)}/bundle`);
}

export async function loadEnrichBooks(): Promise<EnrichIndexResponse> {
  return fetchJson<EnrichIndexResponse>('/api/enrich/books');
}

export async function loadEnrichBook(path: string): Promise<EnrichBookResponse> {
  const params = new URLSearchParams({ path });
  return fetchJson<EnrichBookResponse>(`/api/enrich/book?${params}`);
}

export async function loadNodeCard(
  nodeCardPath: string,
  nodeId: string,
): Promise<ApiNodeCard | null> {
  return fetchOptionalJson<ApiNodeCard>(
    `${nodeCardPath}/${encodeURIComponent(nodeId)}`,
  );
}

export async function loadUnit(
  sourceKey: string,
  nodeId: string,
): Promise<ApiUnit | null> {
  return fetchOptionalJson<ApiUnit>(
    `/api/source/${encodeURIComponent(sourceKey)}/unit/${encodeURIComponent(nodeId)}`,
  );
}

export async function searchNodes(
  sourceKey: string,
  query: string,
  limit?: number,
): Promise<SearchResponse | null> {
  const params = new URLSearchParams({ q: query });
  if (limit) params.set('limit', String(limit));
  try {
    return await fetchJson<SearchResponse>(
      `/api/source/${encodeURIComponent(sourceKey)}/search?${params}`,
    );
  } catch {
    return null;
  }
}

export async function loadPipeline(sourceKey: string): Promise<PipelineResponse | null> {
  return fetchOptionalJson<PipelineResponse>(
    `/api/source/${encodeURIComponent(sourceKey)}/pipeline`,
  );
}

export async function startPipeline(
  sourceKey: string,
  payload: PipelineStartRequest,
): Promise<PipelineStartResponse> {
  return postJson<PipelineStartResponse>(
    `/api/source/${encodeURIComponent(sourceKey)}/pipeline/start`,
    payload,
  );
}

export async function inferTextbookMetadata(
  sourceKey: string,
  payload: TextbookMetadataRequest,
): Promise<TextbookMetadataResponse> {
  return postJson<TextbookMetadataResponse>(
    `/api/source/${encodeURIComponent(sourceKey)}/pipeline/infer-textbook`,
    payload,
  );
}
