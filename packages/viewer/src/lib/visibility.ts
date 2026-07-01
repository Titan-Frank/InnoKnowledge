import type { OKMNode, OKMEdge, LayerMode } from '@/core/graph/types';
import type { ApiEvidence } from '@okm/types';
import { isBackboneNode, isSupportNode } from '@/core/graph/knowledge-data';

export interface VisibilityState {
  knowledgeGraph: {
    nodes: OKMNode[];
    edges: OKMEdge[];
    nodeById: Map<string, OKMNode>;
    evidenceById: Map<string, ApiEvidence>;
  } | null;
  selectedTypes: Set<string>;
  selectedBook: string;
  layerMode: LayerMode;
  expandedBackboneNodeId: string | null;
  focusConnected: boolean;
  selectedNodeId: string | null;
  searchTerm: string;
  serverSearchHits: Map<string, { score: number }>;
}

export function getExpandedSupportNodeIds(state: VisibilityState): Set<string> {
  if (state.layerMode !== 'backbone-expand' || !state.expandedBackboneNodeId) {
    return new Set();
  }

  const expandedIds = new Set<string>();
  state.knowledgeGraph!.edges.forEach((edge) => {
    if (!edge.backboneExpand) return;
    if (edge.from === state.expandedBackboneNodeId) {
      const node = state.knowledgeGraph!.nodeById.get(edge.to);
      if (node && isSupportNode(node)) expandedIds.add(node.id);
    }
    if (edge.to === state.expandedBackboneNodeId) {
      const node = state.knowledgeGraph!.nodeById.get(edge.from);
      if (node && isSupportNode(node)) expandedIds.add(node.id);
    }
  });
  return expandedIds;
}

export function getNeighborEntries(
  node: OKMNode,
  state: VisibilityState,
): Array<{ edge: OKMEdge; otherNode: OKMNode }> {
  return state.knowledgeGraph!.edges
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .map((edge) => {
      const otherId = edge.from === node.id ? edge.to : edge.from;
      const otherNode = state.knowledgeGraph!.nodeById.get(otherId);
      return { edge, otherNode: otherNode! };
    })
    .filter((entry) => entry.otherNode);
}

export function getBackboneNeighbors(nodeId: string, state: VisibilityState): OKMNode[] {
  const node = state.knowledgeGraph?.nodeById.get(nodeId);
  if (!node) return [];

  return getNeighborEntries(node, state)
    .filter((entry) => entry.edge.backboneExpand)
    .map((entry) => entry.otherNode)
    .filter((otherNode) => isBackboneNode(otherNode));
}

function nodePassesBaseFilters(
  node: OKMNode,
  state: VisibilityState,
  options: { ignoreTypeFilter?: boolean } = {},
): boolean {
  const { ignoreTypeFilter = false } = options;

  if (!node || (!ignoreTypeFilter && !state.selectedTypes.has(node.nodeType))) {
    return false;
  }

  if (state.selectedBook !== 'all') {
    return node.scopeBookIds?.has(state.selectedBook) || false;
  }

  return true;
}

export function getVisibleNodes(state: VisibilityState, options: { ignoreTypeFilter?: boolean } = {}): OKMNode[] {
  const { ignoreTypeFilter = false } = options;

  let nodes = state.knowledgeGraph!.nodes.filter((node) =>
    nodePassesBaseFilters(node, state, { ignoreTypeFilter }),
  );

  if (state.layerMode === 'backbone-expand') {
    const expandedRootNode =
      state.expandedBackboneNodeId && state.knowledgeGraph!.nodeById.get(state.expandedBackboneNodeId);
    const expandedSupportIds =
      expandedRootNode &&
      nodePassesBaseFilters(expandedRootNode, state, { ignoreTypeFilter })
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
    state.knowledgeGraph!.edges.forEach((edge) => {
      if (edge.from === state.selectedNodeId) connected.add(edge.to);
      if (edge.to === state.selectedNodeId) connected.add(edge.from);
    });
    nodes = nodes.filter((node) => connected.has(node.id));
  }

  return nodes;
}

export function getVisibleEdges(visibleNodeIds: Set<string>, state: VisibilityState): OKMEdge[] {
  return state.knowledgeGraph!.edges.filter(
    (edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to),
  );
}

export function getSearchMatches(state: VisibilityState): OKMNode[] {
  const visibleNodes = getVisibleNodes(state);
  if (!state.searchTerm) {
    return visibleNodes
      .slice()
      .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name, 'zh-CN'));
  }

  if (state.serverSearchHits.size > 0) {
    return visibleNodes
      .filter((node) => state.serverSearchHits.has(node.id))
      .sort((a, b) => {
        const aHit = state.serverSearchHits.get(a.id)!;
        const bHit = state.serverSearchHits.get(b.id)!;
        return bHit.score - aHit.score || a.name.localeCompare(b.name, 'zh-CN');
      });
  }

  const lowerTerm = state.searchTerm.toLowerCase();
  return visibleNodes
    .filter((node) => {
      const haystack = [node.id, node.name, node.description, ...(node.aliases || [])]
        .join(' ')
        .toLowerCase();
      return haystack.includes(lowerTerm);
    })
    .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name, 'zh-CN'));
}

export function resolveExpandedBackboneNodeId(nodeId: string | null, state: VisibilityState): string | null {
  if (state.layerMode !== 'backbone-expand' || !nodeId) return null;

  const node = state.knowledgeGraph?.nodeById.get(nodeId);
  if (!node) return null;

  if (isBackboneNode(node)) return node.id;

  if (isSupportNode(node) && state.expandedBackboneNodeId) {
    const currentRoot = state.knowledgeGraph!.nodeById.get(state.expandedBackboneNodeId);
    if (currentRoot) {
      const relatedBackboneIds = new Set(getBackboneNeighbors(node.id, state).map((item) => item.id));
      if (relatedBackboneIds.has(currentRoot.id)) return currentRoot.id;
    }
  }

  return getBackboneNeighbors(node.id, state)[0]?.id || null;
}

export function getVisibleMentions(node: OKMNode, state: VisibilityState) {
  return (node.mentions || [])
    .filter((mention) => state.selectedBook === 'all' || (mention as Record<string, unknown>).book_id === state.selectedBook)
    .sort((a, b) => ((a.properties as Record<string, unknown>)?.page as number || 0) - ((b.properties as Record<string, unknown>)?.page as number || 0));
}

export function getVisibleEvidence(node: OKMNode, state: VisibilityState): ApiEvidence[] {
  const mentions = getVisibleMentions(node, state);
  const evidenceIds = [...new Set(mentions.flatMap((mention) => mention.source_refs || []))];
  return evidenceIds
    .map((id) => state.knowledgeGraph!.evidenceById.get(id))
    .filter((e): e is ApiEvidence => e != null)
    .sort((a, b) => {
      const aPage = a.page_start as number ?? Number.MAX_SAFE_INTEGER;
      const bPage = b.page_start as number ?? Number.MAX_SAFE_INTEGER;
      return aPage - bPage;
    });
}
