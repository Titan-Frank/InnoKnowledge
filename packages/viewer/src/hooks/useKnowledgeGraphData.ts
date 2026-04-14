import { useMemo } from 'react';
import { useGraphStore } from '../store/graphStore.js';
import { getVisibleNodes, getVisibleEdges } from '../graph/visibility.js';
import type { GraphNode, GraphEdge } from '../store/types.js';

export function useKnowledgeGraphData() {
  const data = useGraphStore((s) => s.data);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectedTypes = useGraphStore((s) => s.selectedTypes);
  const selectedBook = useGraphStore((s) => s.selectedBook);
  const layerMode = useGraphStore((s) => s.layerMode);
  const expandedBackboneNodeId = useGraphStore((s) => s.expandedBackboneNodeId);
  const focusConnected = useGraphStore((s) => s.focusConnected);

  return useMemo(() => {
    if (!data) {
      return {
        visibleNodes: [] as GraphNode[],
        visibleEdges: [] as GraphEdge[],
        visibleNodeIds: new Set<string>(),
        activeNodeId: undefined as string | undefined,
        status: 'idle' as const,
      };
    }

    const state = useGraphStore.getState();
    const visibleNodes = getVisibleNodes(state);
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = getVisibleEdges(visibleNodeIds, state);

    return {
      visibleNodes,
      visibleEdges,
      visibleNodeIds,
      activeNodeId: selectedNodeId ?? undefined,
      status: 'idle' as const,
    };
  }, [data, selectedNodeId, selectedTypes, selectedBook, layerMode, expandedBackboneNodeId, focusConnected]);
}
