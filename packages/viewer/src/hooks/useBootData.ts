import { useEffect } from 'react';
import { useGraphStore, setSourceConfigs, switchSourceStart, switchSourceComplete, switchSourceFailed } from '../store/graphStore.js';
import { loadMeta, loadBundle } from '../api/index.js';
import { prepareGraphData } from '../graph/layout.js';
import { API_BASE } from '../constants/index.js';
import type { MetaResponse, BundleResponse } from '@okm/types';
import type { SourceConfig } from '../store/types.js';

function resolveApiSourceConfigs(meta: MetaResponse): Map<string, SourceConfig> {
  const configs = new Map<string, SourceConfig>();
  const sources = Array.isArray(meta?.sources) ? meta.sources : [];

  sources.forEach((source) => {
    const key = source?.key;
    if (!key) return;
    configs.set(key, {
      key,
      label: source.label || key.toUpperCase(),
      description: source.description || '',
      books: (source.books || []).map((b: { book_id: string }) => ({ book_id: b.book_id })),
      hasProfiles: Boolean(source.has_profiles),
      autoDiscovered: false,
      bundlePath: `${API_BASE}/source/${encodeURIComponent(key)}/bundle`,
      nodeCardPath: `${API_BASE}/source/${encodeURIComponent(key)}/node-card`,
    });
  });

  return new Map(
    Array.from(configs.entries()).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function resolveInitialSourceKey(meta: MetaResponse, configs: Map<string, SourceConfig>): string {
  const params = new URLSearchParams(window.location.search);
  const requestedKey = params.get('source');
  if (requestedKey && configs.has(requestedKey)) return requestedKey;

  if (meta.active_source && configs.has(meta.active_source)) {
    return meta.active_source;
  }

  return configs.keys().next().value!;
}

function updateSourceQuery(sourceKey: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('source', sourceKey);
  window.history.replaceState({}, '', url);
}

let booted = false;

export function useBootData() {
  useEffect(() => {
    if (booted) return;
    booted = true;

    let cancelled = false;

    async function boot() {
      const meta = await loadMeta();
      if (cancelled) return;

      const manifest = (meta as unknown as Record<string, unknown>).manifest as Record<string, unknown> | null || {};
      const configs = resolveApiSourceConfigs(meta);
      setSourceConfigs(configs, manifest);

      if (configs.size === 0) {
        const graphData = prepareGraphData({
          nodes: [],
          edges: [],
          profiles: [],
          framework: { domains: [] },
          patterns: { patterns: [] },
          books: [],
          loadWarnings: ['当前 PostgreSQL 中还没有可用数据集，请先初始化 schema 并导入数据。'],
          source: { key: 'empty', label: 'EMPTY', description: 'No dataset loaded', hasProfiles: false, isActive: false, rootPath: '', nodeCardPath: '' },
          manifest,
        });

        switchSourceComplete(graphData);
        return;
      }

      const initialKey = resolveInitialSourceKey(meta, configs);
      switchSourceStart(initialKey);

      let data;
      try {
        data = await loadBundle(initialKey);
      } catch (error) {
        if (cancelled) return;
        data = {
          nodes: [], edges: [], profiles: [],
          framework: { domains: [] }, patterns: { patterns: [] },
          books: [], loadWarnings: [(error as Error)?.message || '数据源读取失败'],
          source: {} as BundleResponse['source'],
        } as BundleResponse;
      }

      if (cancelled) return;

      const graphData = prepareGraphData({
        ...data,
        manifest,
        source: { ...configs.get(initialKey)!, ...(data.source || {}) } as Record<string, unknown> & { nodeCardPath?: string },
      });

      switchSourceComplete(graphData);
      updateSourceQuery(initialKey);
    }

    boot().catch((error) => {
      if (!cancelled) {
        switchSourceFailed();
        console.error('Boot failed:', error);
      }
    });

    return () => { cancelled = true; };
  }, []);
}

export function useSwitchSource() {
  return async (sourceKey: string) => {
    const state = useGraphStore.getState();
    const source = state.sourceConfigs.get(sourceKey);
    if (!source) return;

    switchSourceStart(sourceKey);

    let data;
    try {
      data = await loadBundle(sourceKey);
    } catch (error) {
      data = {
        nodes: [], edges: [], profiles: [],
        framework: { domains: [] }, patterns: { patterns: [] },
        books: [], loadWarnings: [(error as Error)?.message || '数据源读取失败'],
        source: {} as BundleResponse['source'],
      } as BundleResponse;
    }

    const graphData = prepareGraphData({
      ...data,
      manifest: state.manifest,
      source: { ...source, ...(data.source || {}) } as Record<string, unknown> & { nodeCardPath?: string },
    });

    switchSourceComplete(graphData);
    updateSourceQuery(sourceKey);
  };
}
