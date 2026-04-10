import type { GraphNode, GraphEdge, AppState } from '../store/types.js';
import type { ApiEvidence } from '@okm/types';
import { isBackboneNode, isSupportNode } from './layout.js';

export function getExpandedSupportNodeIds(state: AppState): Set<string> {
  if (state.layerMode !== 'backbone-expand' || !state.expandedBackboneNodeId) {
    return new Set();
  }

  const expandedIds = new Set<string>();
  state.data!.edges.forEach((edge) => {
    if (!edge.backbone_expand) return;
    if (edge.from === state.expandedBackboneNodeId) {
      const node = state.data!.nodeById.get(edge.to);
      if (node && isSupportNode(node)) expandedIds.add(node.id);
    }
    if (edge.to === state.expandedBackboneNodeId) {
      const node = state.data!.nodeById.get(edge.from);
      if (node && isSupportNode(node)) expandedIds.add(node.id);
    }
  });
  return expandedIds;
}

export function getNeighborEntries(
  node: GraphNode,
  state: AppState,
): Array<{ edge: GraphEdge; otherNode: GraphNode }> {
  return state.data!.edges
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .map((edge) => {
      const otherId = edge.from === node.id ? edge.to : edge.from;
      const otherNode = state.data!.nodeById.get(otherId);
      return { edge, otherNode: otherNode! };
    })
    .filter((entry) => entry.otherNode);
}

export function getBackboneNeighbors(nodeId: string, state: AppState): GraphNode[] {
  const node = state.data?.nodeById.get(nodeId);
  if (!node) return [];

  return getNeighborEntries(node, state)
    .filter((entry) => entry.edge.backbone_expand)
    .map((entry) => entry.otherNode)
    .filter((otherNode) => isBackboneNode(otherNode));
}

function nodePassesBaseFiltersWithOptions(
  node: GraphNode,
  state: AppState,
  options: { ignoreTypeFilter?: boolean } = {},
): boolean {
  const { ignoreTypeFilter = false } = options;

  if (!node || (!ignoreTypeFilter && !state.selectedTypes.has(node.node_type))) {
    return false;
  }

  if (state.selectedBook !== 'all') {
    return node.scopeBookIds?.has(state.selectedBook) || false;
  }

  return true;
}

export function getVisibleNodes(state: AppState, options: { ignoreTypeFilter?: boolean } = {}): GraphNode[] {
  const { ignoreTypeFilter = false } = options;
  const cacheKey = [
    state.data?.source?.key || 'default',
    ignoreTypeFilter ? 'all-types' : Array.from(state.selectedTypes).sort().join(','),
    state.selectedBook,
    state.layerMode,
    state.expandedBackboneNodeId || '',
    state.focusConnected ? 'focused' : 'all',
    state.selectedNodeId || '',
  ].join('|');

  if (state.visibleNodesCache.key === cacheKey) {
    return state.visibleNodesCache.nodes;
  }

  let nodes = state.data!.nodes.filter((node) =>
    nodePassesBaseFiltersWithOptions(node, state, { ignoreTypeFilter }),
  );

  if (state.layerMode === 'backbone-expand') {
    const expandedRootNode =
      state.expandedBackboneNodeId && state.data!.nodeById.get(state.expandedBackboneNodeId);
    const expandedSupportIds =
      expandedRootNode &&
      nodePassesBaseFiltersWithOptions(expandedRootNode, state, { ignoreTypeFilter })
        ? getExpandedSupportNodeIds(state)
        : new Set<string>();
    nodes = nodes.filter((node) => {
      if (isBackboneNode(node)) return true;
      if (expandedSupportIds.has(node.id)) return true;
      return node.id === state.selectedNodeId;
    });
  }

  if (state.focusConnected && state.selectedNodeId) {
    const connected = new Set([state.selectedNodeId]);
    state.data!.edges.forEach((edge) => {
      if (edge.from === state.selectedNodeId) connected.add(edge.to);
      if (edge.to === state.selectedNodeId) connected.add(edge.from);
    });
    nodes = nodes.filter((node) => connected.has(node.id));
  }

  state.visibleNodesCache = { key: cacheKey, nodes };
  return nodes;
}

export function getVisibleEdges(visibleNodeIds: Set<string>, state: AppState): GraphEdge[] {
  return state.data!.edges.filter(
    (edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to),
  );
}

export function syncSelectionWithVisibility(state: AppState): void {
  const expandedRoot =
    state.expandedBackboneNodeId && state.data?.nodeById.get(state.expandedBackboneNodeId);
  if (expandedRoot && !nodePassesBaseFiltersWithOptions(expandedRoot, state)) {
    state.expandedBackboneNodeId = null;
  }

  const visibleNodeIds = new Set(getVisibleNodes(state).map((node) => node.id));
  if (state.selectedNodeId && !visibleNodeIds.has(state.selectedNodeId)) {
    state.selectedNodeId = null;
    state.hoverNodeId = null;
  }
}

export function getSearchMatches(state: AppState): GraphNode[] {
  const visibleNodes = getVisibleNodes(state);
  if (!state.searchTerm) {
    return visibleNodes
      .slice()
      .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name, 'zh-CN'));
  }

  return visibleNodes
    .filter((node) => {
      const haystack = [
        node.id,
        node.name,
        node.description,
        ...(node.aliases || []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(state.searchTerm);
    })
    .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name, 'zh-CN'));
}

export function resolveExpandedBackboneNodeId(nodeId: string | null, state: AppState): string | null {
  if (state.layerMode !== 'backbone-expand' || !nodeId) return null;

  const node = state.data?.nodeById.get(nodeId);
  if (!node) return null;

  if (isBackboneNode(node)) return node.id;

  if (isSupportNode(node) && state.expandedBackboneNodeId) {
    const currentRoot = state.data!.nodeById.get(state.expandedBackboneNodeId);
    if (currentRoot) {
      const relatedBackboneIds = new Set(getBackboneNeighbors(node.id, state).map((item) => item.id));
      if (relatedBackboneIds.has(currentRoot.id)) return currentRoot.id;
    }
  }

  return getBackboneNeighbors(node.id, state)[0]?.id || state.expandedBackboneNodeId || null;
}

export function getVisibleMentions(node: GraphNode, state: AppState) {
  return (node.mentions || [])
    .filter((mention) => state.selectedBook === 'all' || (mention as Record<string, unknown>).book_id === state.selectedBook)
    .sort((a, b) => ((a.properties as Record<string, unknown>)?.page as number || 0) - ((b.properties as Record<string, unknown>)?.page as number || 0));
}

export function getVisibleEvidence(node: GraphNode, state: AppState): ApiEvidence[] {
  const mentions = getVisibleMentions(node, state);
  const evidenceIds = [...new Set(mentions.flatMap((mention) => mention.source_refs || []))];
  return evidenceIds
    .map((id) => state.data!.evidenceById.get(id))
    .filter((e): e is ApiEvidence => e != null)
    .sort((a, b) => {
      const aPage = a.page_start as number ?? Number.MAX_SAFE_INTEGER;
      const bPage = b.page_start as number ?? Number.MAX_SAFE_INTEGER;
      return aPage - bPage;
    });
}
