import { useEffect } from 'react';
import { useAppState } from './useAppState';
import { loadMeta, loadBundle } from '@/services/backend-client';
import { prepareGraphData } from '@/core/graph/knowledge-data';
import { API_BASE } from '@/lib/constants';
import type { MetaResponse } from '@okm/types';
import type { SourceConfig } from '@/core/graph/types';

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
  if (meta.active_source && configs.has(meta.active_source)) return meta.active_source;
  return configs.keys().next().value!;
}

export function useBootData() {
  const { setSourceConfigs, setKnowledgeGraph, setSelectedTypes, setSelectedBook, setSelectedNodeId, setHoverNodeId, setExpandedBackboneNodeId, setSourceLoading, setSelectedSourceKey } = useAppState();

  useEffect(() => {
    let cancelled = false;
    let done = false;

    async function boot() {
      if (done) return;
      done = true;
      const meta = await loadMeta();
      if (cancelled) return;

      const manifest = (meta as unknown as Record<string, unknown>).manifest as Record<string, unknown> | null || {};
      const configs = resolveApiSourceConfigs(meta);
      setSourceConfigs(configs, manifest);

      if (configs.size === 0) {
        const kg = prepareGraphData({
          nodes: [], edges: [], profiles: [],
          framework: { domains: [] }, patterns: { patterns: [] },
          books: [],
          loadWarnings: ['当前 PostgreSQL 中还没有可用数据集，请先初始化 schema 并导入数据。'],
          source: { key: 'empty', label: 'EMPTY', description: 'No dataset loaded', hasProfiles: false, isActive: false, rootPath: '', nodeCardPath: '' },
          manifest,
        });
        setKnowledgeGraph(kg);
        setSelectedTypes(new Set(kg.availableTypes));
        setSelectedBook('all');
        return;
      }

      const initialKey = resolveInitialSourceKey(meta, configs);
      const config = configs.get(initialKey);
      if (!config) return;

      setSelectedSourceKey(initialKey);
      setSelectedNodeId(null);
      setHoverNodeId(null);
      setExpandedBackboneNodeId(null);
      setSourceLoading(true);

      let data;
      try {
        data = await loadBundle(initialKey);
      } catch {
        data = {
          nodes: [], edges: [], profiles: [],
          framework: { domains: [] }, patterns: { patterns: [] },
          books: [], loadWarnings: ['数据源读取失败'],
          source: {} as Record<string, unknown>,
        };
      }

      const kg = prepareGraphData({
        ...data,
        manifest,
        source: { ...config, ...(data.source || {}) } as Record<string, unknown> & { nodeCardPath?: string },
      });

      setKnowledgeGraph(kg);
      setSelectedBook('all');
      setSelectedTypes(new Set(kg.availableTypes));
      setSourceLoading(false);

      const url = new URL(window.location.href);
      url.searchParams.set('source', initialKey);
      window.history.replaceState({}, '', url);
    }

    boot().catch((error) => {
      if (!cancelled) console.error('Boot failed:', error);
    });

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
