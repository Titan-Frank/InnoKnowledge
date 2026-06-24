import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { KnowledgeGraph, LayerMode, ThemeMode } from '@/core/graph/types';
import type { CommunityInfo } from '@/lib/graph-adapter';

interface GraphState {
  knowledgeGraph: KnowledgeGraph | null;
  selectedNodeId: string | null;
  hoverNodeId: string | null;
  selectedTypes: Set<string>;
  selectedBook: string;
  layerMode: LayerMode;
  expandedBackboneNodeId: string | null;
  focusConnected: boolean;
  showLabels: boolean;
  themeMode: ThemeMode;
  communityCount: number;
  communities: CommunityInfo[];
  communityMap: Map<string, number>;
}

interface GraphActions {
  setKnowledgeGraph: (kg: KnowledgeGraph | null) => void;
  setSelectedNodeId: (id: string | null) => void;
  setHoverNodeId: (id: string | null) => void;
  setSelectedTypes: (types: Set<string>) => void;
  toggleType: (type: string) => void;
  resetTypes: () => void;
  setSelectedBook: (book: string) => void;
  setLayerMode: (mode: LayerMode) => void;
  setExpandedBackboneNodeId: (id: string | null) => void;
  setFocusConnected: (v: boolean) => void;
  setShowLabels: (v: boolean) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setCommunityInfo: (count: number, communities: CommunityInfo[], map: Map<string, number>) => void;
}

type GraphContextValue = GraphState & GraphActions;

const GraphStateContext = createContext<GraphContextValue | null>(null);

export function GraphStateProvider({ children }: { children: ReactNode }) {
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraph | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedBook, setSelectedBook] = useState('all');
  const [layerMode, setLayerMode] = useState<LayerMode>('backbone-expand');
  const [expandedBackboneNodeId, setExpandedBackboneNodeId] = useState<string | null>(null);
  const [focusConnected, setFocusConnected] = useState(false);
  const [showLabels, setShowLabels] = useState(true);

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = localStorage.getItem('okm-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  const setThemeMode = useCallback((mode: ThemeMode) => {
    localStorage.setItem('okm-theme', mode);
    document.documentElement.dataset.theme = mode;
    setThemeModeState(mode);
  }, []);

  const [communityCount, setCommunityCount] = useState(0);
  const [communities, setCommunities] = useState<CommunityInfo[]>([]);
  const [communityMap, setCommunityMap] = useState<Map<string, number>>(new Map());

  const setCommunityInfo = useCallback((count: number, comms: CommunityInfo[], map: Map<string, number>) => {
    setCommunityCount(count);
    setCommunities(comms);
    setCommunityMap(map);
  }, []);

  const toggleType = useCallback((type: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const resetTypes = useCallback(() => {
    setSelectedTypes((prev) => {
      const available = knowledgeGraph?.availableTypes;
      return available ? new Set(available) : prev;
    });
  }, [knowledgeGraph?.availableTypes]);

  const value: GraphContextValue = {
    knowledgeGraph,
    selectedNodeId,
    hoverNodeId,
    selectedTypes,
    selectedBook,
    layerMode,
    expandedBackboneNodeId,
    focusConnected,
    showLabels,
    themeMode,
    communityCount,
    communities,
    communityMap,
    setKnowledgeGraph,
    setSelectedNodeId,
    setHoverNodeId,
    setSelectedTypes,
    toggleType,
    resetTypes,
    setSelectedBook,
    setLayerMode,
    setExpandedBackboneNodeId,
    setFocusConnected,
    setShowLabels,
    setThemeMode,
    setCommunityInfo,
  };

  return (
    <GraphStateContext.Provider value={value}>
      {children}
    </GraphStateContext.Provider>
  );
}

export function useGraphState(): GraphContextValue {
  const ctx = useContext(GraphStateContext);
  if (!ctx) throw new Error('useGraphState must be used within GraphStateProvider');
  return ctx;
}
