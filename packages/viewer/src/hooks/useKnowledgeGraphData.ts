import { useMemo, useRef, useCallback } from 'react';
import { useGraphStore } from '../store/graphStore.js';
import { getVisibleNodes, getVisibleEdges } from '../graph/visibility.js';
import { getTypeLabel } from '../graph/layout.js';
import { NODE_LAYER_LABELS } from '../constants/index.js';
import type { KnowledgeNode, KnowledgeEdge } from '../components/aiwc/index.js';

export function useKnowledgeGraphData() {
  const data = useGraphStore((s) => s.data);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectedTypes = useGraphStore((s) => s.selectedTypes);
  const selectedBook = useGraphStore((s) => s.selectedBook);
  const layerMode = useGraphStore((s) => s.layerMode);
  const expandedBackboneNodeId = useGraphStore((s) => s.expandedBackboneNodeId);
  const focusConnected = useGraphStore((s) => s.focusConnected);

  // Preserve user-dragged positions across re-renders
  const draggedPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  const handleNodeDragStop = useCallback((nodeId: string, position: { x: number; y: number }) => {
    draggedPositions.current.set(nodeId, position);
  }, []);

  // When filters change, clear dragged positions so layout recalculates
  const prevFilterKey = useRef<string>('');
  const filterKey = `${selectedTypes}|${selectedBook}|${layerMode}|${expandedBackboneNodeId}|${focusConnected}`;
  if (prevFilterKey.current !== filterKey) {
    prevFilterKey.current = filterKey;
    draggedPositions.current.clear();
  }

  return useMemo(() => {
    if (!data) {
      return { nodes: [], edges: [], activeNodeId: undefined, draggedPositions: draggedPositions.current, handleNodeDragStop, status: 'idle' as const };
    }

    const state = useGraphStore.getState();
    const visibleNodes = getVisibleNodes(state);
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = getVisibleEdges(visibleNodeIds, state);

    const kgNodes: KnowledgeNode[] = visibleNodes.map((node) => ({
      id: node.id,
      label: node.name,
      category: node.node_type,
      nodeLayer: node.node_layer,
      description: node.description,
      meta: `${node.degree} 条关联 · ${NODE_LAYER_LABELS[node.node_layer] ?? ''}`,
      badge: getTypeLabel(node.node_type),
    }));

    const kgEdges: KnowledgeEdge[] = visibleEdges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: edge.edge_type,
      edgeType: edge.edge_type,
      description: (edge.properties as Record<string, unknown>)?.relation as string || undefined,
    }));

    return {
      nodes: kgNodes,
      edges: kgEdges,
      activeNodeId: selectedNodeId ?? undefined,
      draggedPositions: draggedPositions.current,
      handleNodeDragStop,
      status: 'idle' as const,
    };
  }, [data, selectedNodeId, selectedTypes, selectedBook, layerMode, expandedBackboneNodeId, focusConnected]);
}
