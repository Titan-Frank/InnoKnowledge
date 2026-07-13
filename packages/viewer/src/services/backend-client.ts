import type {
  ApiNodeCard, ApiUnit, MetaResponse, BundleResponse, SearchResponse,
  GroundedGenerationRequest, GroundedGenerationResponse, GroundedGenerationStreamEvent,
  UnitRetrievalMode, UnitRetrievalResponse,
  AnnotationLessonTextResponse, AnnotationTextbookListResponse,
  PipelineJobStatusResponse, PipelineQualityDashboardResponse, PipelineResponse, PipelineStartRequest, PipelineStartResponse,
  TextbookMetadataRequest, TextbookMetadataResponse,
  ImageReviewResponse, ImageReviewUpdateRequest, ImageReviewUpdateResponse,
} from '@okm/types';
import { PUBLIC_ARTIFACT_MODE, publicArtifactPath } from '@/lib/runtime';
import {
  createPublicArtifactBundle,
  createPublicArtifactMeta,
  findPublicArtifactUnitFile,
  isPublicArtifactUnit,
  searchPublicArtifactNodes,
  type PublicArtifactGraph,
  type PublicArtifactManifest,
  type PublicArtifactUnitIndex,
} from './public-artifact';

let artifactManifestPromise: Promise<PublicArtifactManifest> | null = null;
let artifactGraphPromise: Promise<PublicArtifactGraph> | null = null;
let artifactUnitIndexPromise: Promise<PublicArtifactUnitIndex> | null = null;
const artifactUnitPromises = new Map<string, Promise<ApiUnit | null>>();

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

async function backendErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  } catch {
    return text;
  }
  return fallback;
}

export async function fetchJson<T = unknown>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new BackendError(await backendErrorMessage(response, `Failed to load ${path}`), response.status, 'server');
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
    throw new BackendError(await backendErrorMessage(response, `Failed to post ${path}`), response.status, 'server');
  }
  return response.json() as Promise<T>;
}

export async function loadMeta(): Promise<MetaResponse> {
  if (PUBLIC_ARTIFACT_MODE) {
    const [manifest, graph] = await Promise.all([
      loadArtifactManifest(),
      loadArtifactGraph(),
    ]);
    return createPublicArtifactMeta(manifest, graph);
  }
  return fetchJson<MetaResponse>('/api/meta');
}

export async function loadBundle(sourceKey: string): Promise<BundleResponse> {
  if (PUBLIC_ARTIFACT_MODE) {
    const graph = await loadArtifactGraph();
    return createPublicArtifactBundle(graph, publicArtifactPath('data/units'));
  }
  return fetchJson<BundleResponse>(`/api/source/${encodeURIComponent(sourceKey)}/bundle`);
}

export async function loadEnrichBooks(sourceKey: string): Promise<EnrichIndexResponse> {
  const params = new URLSearchParams({ source: sourceKey });
  return fetchJson<EnrichIndexResponse>(`/api/enrich/books?${params}`);
}

export async function loadEnrichBook(sourceKey: string, path: string): Promise<EnrichBookResponse> {
  const params = new URLSearchParams({ source: sourceKey, path });
  return fetchJson<EnrichBookResponse>(`/api/enrich/book?${params}`);
}

export async function loadAnnotationTextbooks(): Promise<AnnotationTextbookListResponse> {
  return fetchJson<AnnotationTextbookListResponse>('/api/annotation/textbooks');
}

export async function loadAnnotationLessonText(
  bookId: string,
  lessonId: string,
): Promise<AnnotationLessonTextResponse> {
  return fetchJson<AnnotationLessonTextResponse>(
    `/api/annotation/textbooks/${encodeURIComponent(bookId)}/lessons/${encodeURIComponent(lessonId)}`,
  );
}

export async function loadNodeCard(
  nodeCardPath: string,
  nodeId: string,
): Promise<ApiNodeCard | null> {
  if (PUBLIC_ARTIFACT_MODE) {
    const unit = await loadArtifactUnit(nodeId);
    return unit?.card ?? null;
  }
  return fetchOptionalJson<ApiNodeCard>(
    `${nodeCardPath}/${encodeURIComponent(nodeId)}`,
  );
}

export async function loadUnit(
  sourceKey: string,
  nodeId: string,
): Promise<ApiUnit | null> {
  if (PUBLIC_ARTIFACT_MODE) return loadArtifactUnit(nodeId);
  return fetchOptionalJson<ApiUnit>(
    `/api/source/${encodeURIComponent(sourceKey)}/unit/${encodeURIComponent(nodeId)}`,
  );
}

export async function searchNodes(
  sourceKey: string,
  query: string,
  limit?: number,
): Promise<SearchResponse | null> {
  if (PUBLIC_ARTIFACT_MODE) {
    return searchPublicArtifactNodes(await loadArtifactGraph(), query, sourceKey, limit);
  }
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

function loadArtifactManifest(): Promise<PublicArtifactManifest> {
  artifactManifestPromise ??= fetchJson<PublicArtifactManifest>(publicArtifactPath('manifest.json'));
  return artifactManifestPromise;
}

function loadArtifactGraph(): Promise<PublicArtifactGraph> {
  artifactGraphPromise ??= fetchJson<PublicArtifactGraph>(publicArtifactPath('data/graph.json'));
  return artifactGraphPromise;
}

function loadArtifactUnitIndex(): Promise<PublicArtifactUnitIndex> {
  artifactUnitIndexPromise ??= fetchJson<PublicArtifactUnitIndex>(publicArtifactPath('data/units/index.json'));
  return artifactUnitIndexPromise;
}

function loadArtifactUnit(nodeId: string): Promise<ApiUnit | null> {
  const cached = artifactUnitPromises.get(nodeId);
  if (cached) return cached;

  const request = loadArtifactUnitIndex()
    .then(async (index) => {
      const file = findPublicArtifactUnitFile(index, nodeId);
      if (!file) return null;
      const unit = await fetchJson<unknown>(publicArtifactPath(`data/units/${file}`));
      return isPublicArtifactUnit(unit) ? unit : null;
    })
    .catch(() => null);
  artifactUnitPromises.set(nodeId, request);
  return request;
}

export async function searchApiUnits(
  sourceKey: string,
  query: string,
  limit?: number,
  mode?: UnitRetrievalMode,
): Promise<UnitRetrievalResponse> {
  const params = new URLSearchParams({ q: query });
  if (limit) params.set('limit', String(limit));
  if (mode) params.set('mode', mode);
  return fetchJson<UnitRetrievalResponse>(
    `/api/source/${encodeURIComponent(sourceKey)}/units/search?${params}`,
  );
}

export async function generateGroundedAnswer(
  sourceKey: string,
  payload: GroundedGenerationRequest,
): Promise<GroundedGenerationResponse> {
  return postJson<GroundedGenerationResponse>(
    `/api/source/${encodeURIComponent(sourceKey)}/grounded-generate`,
    payload,
  );
}

export async function generateGroundedAnswerStream(
  sourceKey: string,
  payload: GroundedGenerationRequest,
  handlers: {
    onRetrieval?: (retrieval: UnitRetrievalResponse) => void;
    onAnswerDelta?: (delta: string) => void;
  } = {},
  signal?: AbortSignal,
): Promise<GroundedGenerationResponse> {
  const path = `/api/source/${encodeURIComponent(sourceKey)}/grounded-generate/stream`;
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    throw new BackendError(await backendErrorMessage(response, `Failed to post ${path}`), response.status, 'server');
  }
  if (!response.body) {
    throw new BackendError('生成接口没有返回流数据。', 502, 'stream');
  }

  let completedResponse: GroundedGenerationResponse | null = null;
  await readSseEvents(response.body, (event) => {
    switch (event.type) {
      case 'retrieval':
        handlers.onRetrieval?.(event.retrieval);
        break;
      case 'answer_delta':
        handlers.onAnswerDelta?.(event.delta);
        break;
      case 'complete':
        completedResponse = event.response;
        break;
      case 'error':
        throw new BackendError(event.error, 502, 'stream');
    }
  });

  if (!completedResponse) {
    throw new BackendError('生成流提前结束，没有收到完整结果。', 502, 'stream');
  }
  return completedResponse;
}

async function readSseEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: GroundedGenerationStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = findSseBoundary(buffer);
    while (boundary) {
      const block = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      dispatchSseBlock(block, onEvent);
      boundary = findSseBoundary(buffer);
    }
    if (done) break;
  }

  if (buffer.trim()) dispatchSseBlock(buffer, onEvent);
}

function findSseBoundary(value: string): { index: number; length: number } | null {
  const match = /\r?\n\r?\n/.exec(value);
  return match ? { index: match.index, length: match[0].length } : null;
}

function dispatchSseBlock(
  block: string,
  onEvent: (event: GroundedGenerationStreamEvent) => void,
): void {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data) return;
  try {
    onEvent(JSON.parse(data) as GroundedGenerationStreamEvent);
  } catch (error) {
    if (error instanceof BackendError) throw error;
    throw new BackendError('生成接口返回了无法解析的流数据。', 502, 'stream');
  }
}

export async function loadPipeline(sourceKey: string): Promise<PipelineResponse | null> {
  return fetchOptionalJson<PipelineResponse>(
    `/api/source/${encodeURIComponent(sourceKey)}/pipeline`,
  );
}

export async function loadPipelineQuality(sourceKey: string): Promise<PipelineQualityDashboardResponse | null> {
  return fetchOptionalJson<PipelineQualityDashboardResponse>(
    `/api/source/${encodeURIComponent(sourceKey)}/pipeline/quality`,
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

export async function loadPipelineJobStatus(
  sourceKey: string,
  jobId: string,
): Promise<PipelineJobStatusResponse> {
  return fetchJson<PipelineJobStatusResponse>(
    `/api/source/${encodeURIComponent(sourceKey)}/pipeline/jobs/${encodeURIComponent(jobId)}`,
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

export async function loadImageReviews(sourceKey: string): Promise<ImageReviewResponse> {
  return fetchJson<ImageReviewResponse>(
    `/api/source/${encodeURIComponent(sourceKey)}/image-reviews?limit=200`,
  );
}

export async function updateImageReview(
  sourceKey: string,
  evidenceId: string,
  payload: ImageReviewUpdateRequest,
): Promise<ImageReviewUpdateResponse> {
  return postJson<ImageReviewUpdateResponse>(
    `/api/source/${encodeURIComponent(sourceKey)}/image-reviews/${encodeURIComponent(evidenceId)}`,
    payload,
  );
}
