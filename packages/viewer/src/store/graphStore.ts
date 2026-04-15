import { create } from 'zustand';
import type { ApiNodeCard } from '@okm/types';
import type { AppState, GraphData, SourceConfig } from './types.js';
import type { LayerMode } from '../constants/index.js';
import type { CommunityInfo } from '../graph/graph-adapter.js';
import type { ThemeMode } from '../components/aiwc/styles/tokens.js';
import { resolveExpandedBackboneNodeId, syncSelectionWithVisibility } from '../graph/visibility.js';

function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem('okm-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export const useGraphStore = create<AppState>()(() => ({
  manifest: null,
  sourceConfigs: new Map(),
  selectedSourceKey: null,
  sourceLoading: false,
  sourceRequestId: 0,
  data: null,
  selectedNodeId: null,
  hoverNodeId: null,
  searchTerm: '',
  selectedBook: 'all',
  selectedTypes: new Set(),
  focusConnected: false,
  layerMode: 'backbone-expand' as LayerMode,
  expandedBackboneNodeId: null,
  showLabels: true,
  transform: { x: 0, y: 0, scale: 1 },
  dragNodeId: null,
  panning: false,
  lastPointer: null,
  raf: null,
  cardCache: new Map<string, ApiNodeCard | null>(),
  detailRequestId: 0,
  visibleNodesCache: { key: null, nodes: [] },
  communityCount: 0,
  communities: [],
  communityMap: new Map(),
  themeMode: getInitialThemeMode(),
}));

// --- Actions (mutate store imperatively, called from components/hooks) ---

export function setSourceConfigs(configs: Map<string, SourceConfig>, meta: Record<string, unknown>): void {
  useGraphStore.setState({ sourceConfigs: configs, manifest: meta });
}

export function switchSourceStart(sourceKey: string): void {
  const s = useGraphStore.getState();
  useGraphStore.setState({
    selectedSourceKey: sourceKey,
    sourceLoading: true,
    sourceRequestId: s.sourceRequestId + 1,
    cardCache: new Map(),
    selectedNodeId: null,
    hoverNodeId: null,
    expandedBackboneNodeId: null,
  });
}

export function switchSourceComplete(data: GraphData): void {
  useGraphStore.setState({
    sourceLoading: false,
    data,
    visibleNodesCache: { key: null, nodes: [] },
    selectedBook: 'all',
    selectedTypes: new Set(data.availableTypes),
  });
}

export function switchSourceFailed(): void {
  useGraphStore.setState({ sourceLoading: false });
}

export function selectNode(nodeId: string | null, recenter = false): void {
  const state = useGraphStore.getState();
  const expandedId = resolveExpandedBackboneNodeId(nodeId, state);
  useGraphStore.setState({
    selectedNodeId: nodeId,
    expandedBackboneNodeId: expandedId,
  });
  syncSelectionWithVisibility(useGraphStore.getState());
  useGraphStore.setState({
    visibleNodesCache: { key: null, nodes: [] },
  });
  void recenter;
}

export function setHoverNodeId(id: string | null): void {
  useGraphStore.setState({ hoverNodeId: id });
}

export function setSearchTerm(term: string): void {
  useGraphStore.setState({ searchTerm: term });
}

export function setSelectedBook(bookId: string): void {
  useGraphStore.setState({ selectedBook: bookId });
  syncSelectionWithVisibility(useGraphStore.getState());
  useGraphStore.setState({ visibleNodesCache: { key: null, nodes: [] } });
}

export function toggleType(type: string): void {
  const state = useGraphStore.getState();
  const next = new Set(state.selectedTypes);
  if (next.has(type)) next.delete(type);
  else next.add(type);
  useGraphStore.setState({ selectedTypes: next });
  syncSelectionWithVisibility(useGraphStore.getState());
  useGraphStore.setState({ visibleNodesCache: { key: null, nodes: [] } });
}

export function resetTypes(): void {
  const state = useGraphStore.getState();
  useGraphStore.setState({ selectedTypes: new Set(state.data?.availableTypes || []) });
  syncSelectionWithVisibility(useGraphStore.getState());
  useGraphStore.setState({ visibleNodesCache: { key: null, nodes: [] } });
}

export function setFocusConnected(focused: boolean): void {
  useGraphStore.setState({ focusConnected: focused });
  syncSelectionWithVisibility(useGraphStore.getState());
  useGraphStore.setState({ visibleNodesCache: { key: null, nodes: [] } });
}

export function setLayerMode(mode: LayerMode): void {
  const state = useGraphStore.getState();
  const expandedId = mode === 'all'
    ? null
    : resolveExpandedBackboneNodeId(state.selectedNodeId, state);
  useGraphStore.setState({ layerMode: mode, expandedBackboneNodeId: expandedId });
  syncSelectionWithVisibility(useGraphStore.getState());
  useGraphStore.setState({ visibleNodesCache: { key: null, nodes: [] } });
}

export function collapseSupport(): void {
  const state = useGraphStore.getState();
  const expandedRootId = state.expandedBackboneNodeId;
  let selectedNodeId = state.selectedNodeId;
  if (selectedNodeId) {
    const selectedNode = state.data?.nodeById.get(selectedNodeId);
    if (selectedNode && selectedNode.node_layer === 'support') {
      selectedNodeId = expandedRootId || null;
    }
  }
  useGraphStore.setState({
    expandedBackboneNodeId: null,
    selectedNodeId,
  });
  syncSelectionWithVisibility(useGraphStore.getState());
  useGraphStore.setState({ visibleNodesCache: { key: null, nodes: [] } });
}

export function setShowLabels(show: boolean): void {
  useGraphStore.setState({ showLabels: show });
}

export function invalidateVisibleNodesCache(): void {
  useGraphStore.setState({ visibleNodesCache: { key: null, nodes: [] } });
}

export function setCommunityInfo(communityCount: number, communities: CommunityInfo[], communityMap: Map<string, number>): void {
  useGraphStore.setState({ communityCount, communities, communityMap });
}

export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem('okm-theme', mode);
  useGraphStore.setState({ themeMode: mode });
}
