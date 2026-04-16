import type { ApiNodeCard, MetaResponse, BundleResponse, SearchResponse } from '@okm/types';

export async function fetchJson<T = unknown>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchOptionalJson<T = unknown>(path: string): Promise<T | null> {
  const response = await fetch(path);
  if (!response.ok) {
    return null;
  }
  return response.json() as Promise<T>;
}

export async function loadMeta(): Promise<MetaResponse> {
  return fetchJson<MetaResponse>('/api/meta');
}

export async function loadBundle(sourceKey: string): Promise<BundleResponse> {
  return fetchJson<BundleResponse>(`/api/source/${encodeURIComponent(sourceKey)}/bundle`);
}

export async function loadNodeCard(
  nodeCardPath: string,
  nodeId: string,
): Promise<ApiNodeCard | null> {
  return fetchOptionalJson<ApiNodeCard>(
    `${nodeCardPath}/${encodeURIComponent(nodeId)}`,
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
