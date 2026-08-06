import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { ApiNodeCard } from '@okm/types';
import type { SourceConfig, SearchHitMeta } from '@/core/graph/types';
import { GraphStateProvider, useGraphState } from './app-state/graph';
import { prepareGraphData } from '@/core/graph/knowledge-data';
import { loadBundle } from '@/services/backend-client';

type Workspace = 'graph' | 'textbook' | 'pipeline';

interface AppState {
  // Source management
  manifest: Record<string, unknown> | null;
  sourceConfigs: Map<string, SourceConfig>;
  selectedSourceKey: string | null;
  sourceLoading: boolean;
  workspace: Workspace;

  // Search
  searchTerm: string;
  serverSearchHits: Map<string, SearchHitMeta>;
  serverSearchLoading: boolean;
  serverSearchError: boolean;

  // Node card cache
  cardCache: Map<string, ApiNodeCard | null>;

  // Layout
  isLayoutRunning: boolean;
  setIsLayoutRunning: (v: boolean) => void;
}

interface AppActions {
  setSourceConfigs: (configs: Map<string, SourceConfig>, manifest: Record<string, unknown>) => void;
  switchSource: (key: string, configs?: Map<string, SourceConfig>, manifestOverride?: Record<string, unknown> | null) => Promise<void>;
  setSearchTerm: (term: string) => void;
  setServerSearchHits: (hits: Map<string, SearchHitMeta>) => void;
  setServerSearchLoading: (v: boolean) => void;
  setServerSearchError: (v: boolean) => void;
  setCardCache: (cache: Map<string, ApiNodeCard | null>) => void;
  setSourceLoading: (loading: boolean) => void;
  setSelectedSourceKey: (key: string | null) => void;
  setWorkspace: (workspace: Workspace) => void;
}

type AppContextValue = AppState & AppActions & ReturnType<typeof useGraphState>;

const AppStateContext = createContext<AppContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  return (
    <GraphStateProvider>
      <AppStateInner>{children}</AppStateInner>
    </GraphStateProvider>
  );
}

function AppStateInner({ children }: { children: ReactNode }) {
  const graphState = useGraphState();

  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [sourceConfigs, setSourceConfigsState] = useState<Map<string, SourceConfig>>(new Map());
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>('graph');

  const [searchTerm, setSearchTermState] = useState('');
  const [serverSearchHits, setServerSearchHitsState] = useState<Map<string, SearchHitMeta>>(new Map());
  const [serverSearchLoading, setServerSearchLoadingState] = useState(false);
  const [serverSearchError, setServerSearchErrorState] = useState(false);

  const [cardCache, setCardCacheState] = useState<Map<string, ApiNodeCard | null>>(new Map());
  const [isLayoutRunning, setIsLayoutRunning] = useState(false);

  const setSourceConfigs = useCallback((configs: Map<string, SourceConfig>, m: Record<string, unknown>) => {
    setSourceConfigsState(configs);
    setManifest(m);
  }, []);

  const switchSource = useCallback(async (key: string, configs?: Map<string, SourceConfig>, manifestOverride?: Record<string, unknown> | null) => {
    const config = (configs || sourceConfigs).get(key);
    if (!config) return;

    setSelectedSourceKey(key);
    setSourceLoading(true);
    graphState.setSelectedNodeId(null);
    graphState.setHoverNodeId(null);
    graphState.setExpandedBackboneNodeId(null);
    setCardCacheState(new Map());

    let data;
    try {
      data = await loadBundle(key);
    } catch (error) {
      data = {
        nodes: [], edges: [], profiles: [],
        framework: { domains: [] }, patterns: { patterns: [] },
        books: [], loadWarnings: [(error as Error)?.message || '数据源读取失败'],
        source: {} as Record<string, unknown>,
      };
    }

    const activeManifest = manifestOverride ?? manifest;
    const kg = prepareGraphData({
      ...data,
      manifest: activeManifest,
      source: { ...config, ...(data.source || {}) } as Record<string, unknown> & { nodeCardPath?: string },
    });

    graphState.setKnowledgeGraph(kg);
    graphState.setSelectedBook('all');
    graphState.setSelectedTypes(new Set(kg.availableTypes));
    setSourceLoading(false);

    const url = new URL(window.location.href);
    url.searchParams.set('source', key);
    window.history.replaceState({}, '', url);
  }, [sourceConfigs, manifest, graphState]);

  const setSearchTerm = useCallback((term: string) => {
    setSearchTermState(term);
    setServerSearchHitsState(new Map());
    setServerSearchLoadingState(false);
    setServerSearchErrorState(false);
  }, []);

  const value: AppContextValue = useMemo(() => ({
    // Graph state (spread)
    ...graphState,
    // App state
    manifest,
    sourceConfigs,
    selectedSourceKey,
    sourceLoading,
    workspace,
    searchTerm,
    serverSearchHits,
    serverSearchLoading,
    serverSearchError,
    cardCache,
    isLayoutRunning,
    setIsLayoutRunning,
    // Actions
    setSourceConfigs,
    switchSource,
    setSearchTerm,
    setServerSearchHits: setServerSearchHitsState,
    setServerSearchLoading: setServerSearchLoadingState,
    setServerSearchError: setServerSearchErrorState,
    setCardCache: setCardCacheState,
    setSourceLoading,
    setSelectedSourceKey,
    setWorkspace,
  }), [graphState, manifest, sourceConfigs, selectedSourceKey, sourceLoading,
    searchTerm, serverSearchHits, serverSearchLoading, serverSearchError,
    cardCache, isLayoutRunning, workspace, setSourceConfigs, switchSource, setSearchTerm]);

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
