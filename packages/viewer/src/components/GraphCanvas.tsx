import { useEffect, useMemo, useState, useCallback } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useG6 } from '@/hooks/useG6';
import { okmKnowledgeGraphToG6 } from '@/lib/graph-adapter';
import { getVisibleNodes } from '@/lib/visibility';
import { getNodeTypeLabel } from '@/core/graph/knowledge-data';
import { ZoomIn, ZoomOut, Maximize2, Play, Pause, RotateCcw } from '@/lib/lucide-icons';

const EMPTY_SEARCH_HIT_IDS = new Set<string>();

export function GraphCanvas() {
  const appState = useAppState();
  const {
    knowledgeGraph, selectedNodeId, selectedTypes, selectedBook,
    layerMode, expandedBackboneNodeId, showLabels, hoverNodeId,
    themeMode, setSelectedNodeId, setExpandedBackboneNodeId, setHoverNodeId,
    setCommunityInfo, setIsLayoutRunning,
    serverSearchHits,
  } = appState;

  const [hoveredNode, setHoveredNode] = useState<{ id: string; name: string } | null>(null);

  // Compute visible node IDs — only structural filters (not selection)
  const structuralVisibility = useMemo(() => ({
    knowledgeGraph,
    selectedTypes,
    selectedBook,
    layerMode,
    expandedBackboneNodeId,
    focusConnected: false,
    selectedNodeId: null,
    searchTerm: '',
    serverSearchHits: new Map<string, { score: number }>(),
  }), [knowledgeGraph, selectedTypes, selectedBook, layerMode, expandedBackboneNodeId]);

  const visibleNodeIds = useMemo(() => {
    if (!knowledgeGraph) return new Set<string>();
    const nodes = getVisibleNodes(structuralVisibility);
    return new Set(nodes.map((n) => n.id));
  }, [structuralVisibility, knowledgeGraph]);

  useEffect(() => {
    setHoveredNode((current) => current && visibleNodeIds.has(current.id) ? current : null);
  }, [visibleNodeIds]);

  // Handle node click — only updates state, no graph rebuild
  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    const node = knowledgeGraph?.nodeById.get(nodeId);
    if (node && node.nodeLayer === 'backbone' && layerMode === 'backbone-expand') {
      setExpandedBackboneNodeId(nodeId);
    }
  }, [setSelectedNodeId, setExpandedBackboneNodeId, knowledgeGraph, layerMode]);

  const handleNodeHover = useCallback((nodeId: string | null) => {
    if (!nodeId || !knowledgeGraph) {
      setHoveredNode(null);
      return;
    }
    const node = knowledgeGraph.nodeById.get(nodeId);
    setHoveredNode(node ? { id: node.id, name: node.name } : null);
  }, [knowledgeGraph]);

  const handleStageClick = useCallback(() => {
    setSelectedNodeId(null);
    setHoverNodeId(null);
  }, [setSelectedNodeId, setHoverNodeId]);

  const searchHitIds = useMemo(
    () => serverSearchHits.size > 0 ? new Set(serverSearchHits.keys()) : EMPTY_SEARCH_HIT_IDS,
    [serverSearchHits],
  );
  const selectedNode = selectedNodeId && knowledgeGraph ? knowledgeGraph.nodeById.get(selectedNodeId) ?? null : null;
  const canvasSummary = selectedNode
    ? getNodeTypeLabel(selectedNode)
    : searchHitIds.size > 0
      ? `${searchHitIds.size} 个检索命中`
      : `${visibleNodeIds.size} 个可见节点`;

  const {
    containerRef, setGraph, zoomIn, zoomOut, fitToScreen,
    focusNode, startLayout, stopLayout, containerReady,
  } = useG6({
    onNodeClick: handleNodeClick,
    onNodeHover: handleNodeHover,
    onStageClick: handleStageClick,
    onLayoutRunningChange: setIsLayoutRunning,
    selectedNodeId,
    searchHitIds,
    previewNodeId: hoveredNode?.id ?? hoverNodeId,
    themeMode,
    showLabels,
  });

  // Build and set graph ONLY when data or structural filters change
  useEffect(() => {
    if (!knowledgeGraph || !containerReady) return;
    if (visibleNodeIds.size === 0) return;

    const result = okmKnowledgeGraphToG6(knowledgeGraph, visibleNodeIds, themeMode);
    setCommunityInfo(result.communityCount, result.communities, result.communityMap);
    void setGraph({
      data: result.data,
      nodeIds: result.nodeIds,
      edgePairs: result.edgePairs,
    });
  }, [knowledgeGraph, visibleNodeIds, themeMode, containerReady, setGraph, setCommunityInfo]);

  // Focus on selected node
  const handleFocusSelected = useCallback(() => {
    if (selectedNodeId) focusNode(selectedNodeId);
  }, [selectedNodeId, focusNode]);

  // Clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedNodeId(null);
    fitToScreen();
  }, [setSelectedNodeId, fitToScreen]);

  const isLayoutRunning = appState.isLayoutRunning;

  return (
    <div className="relative h-full w-full bg-void">
      <div className="okm-canvas-grid" />
      <div className="okm-canvas-spotlight" />

      {/* G6 container */}
      <div
        ref={containerRef}
        className="g6-container h-full w-full cursor-grab active:cursor-grabbing"
      />

      <div className="absolute left-4 top-4 z-20 flex max-w-[min(660px,calc(100%-2rem))] animate-slide-up items-center gap-2 rounded-lg border border-border-subtle bg-elevated/95 px-3 py-2 shadow-panel backdrop-blur-sm">
        <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${selectedNode ? 'bg-accent shadow-glow' : 'bg-node-process'}`} />
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold text-text-primary">
            {selectedNode?.name ?? '图谱画布'}
          </span>
          <span className="block truncate text-[11px] text-text-muted">{canvasSummary}</span>
        </div>
        <div className="ml-1 flex shrink-0 items-center gap-1">
          {selectedNode ? (
            <>
              <button
                onClick={handleFocusSelected}
                className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
              >
                聚焦
              </button>
              <button
                onClick={handleClearSelection}
                className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
              >
                清除
              </button>
            </>
          ) : (
            <button
              onClick={fitToScreen}
              className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
            >
              适应
            </button>
          )}
        </div>
      </div>

      {/* Hovered node tooltip */}
      {hoveredNode && !selectedNodeId && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 animate-fade-in rounded-lg border border-border-subtle bg-elevated/95 px-3 py-1.5 shadow-panel backdrop-blur-sm">
          <span className="font-mono text-sm text-text-primary">{hoveredNode.name}</span>
        </div>
      )}

      {knowledgeGraph && visibleNodeIds.size === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
          <div className="max-w-sm rounded-lg border border-border-subtle bg-elevated/95 px-4 py-3 text-center shadow-panel backdrop-blur-sm">
            <div className="text-sm font-semibold text-text-primary">没有可见节点</div>
            <div className="mt-1 text-xs leading-5 text-text-muted">调整左侧筛选条件后会重新显示图谱</div>
          </div>
        </div>
      )}

      {/* Graph Controls - Bottom Right */}
      <div className="okm-tool-dock absolute bottom-4 right-4 z-10 flex flex-col gap-1 rounded-lg border border-border-subtle bg-elevated/95 p-1 shadow-panel backdrop-blur-sm">
        <button onClick={zoomIn} aria-label="放大图谱" className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-hover hover:text-text-primary" title="放大">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button onClick={zoomOut} aria-label="缩小图谱" className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-hover hover:text-text-primary" title="缩小">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button onClick={fitToScreen} aria-label="让图谱适应屏幕" className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-hover hover:text-text-primary" title="适应屏幕">
          <Maximize2 className="h-4 w-4" />
        </button>
        <div className="my-1 h-px bg-border-subtle" />
        {selectedNodeId && (
          <button onClick={handleFocusSelected} aria-label="聚焦选中节点" className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/15 text-accent transition-colors hover:bg-accent/25" title="聚焦选中节点">
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
        <div className="my-1 h-px bg-border-subtle" />
        <button
          onClick={isLayoutRunning ? stopLayout : startLayout}
          aria-label={isLayoutRunning ? '停止布局优化' : '重新开始布局优化'}
          aria-pressed={isLayoutRunning}
          className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
            isLayoutRunning
              ? 'animate-pulse bg-accent text-white shadow-glow'
              : 'text-text-secondary hover:bg-hover hover:text-text-primary'
          }`}
          title={isLayoutRunning ? '停止布局优化' : '重新开始布局优化'}
        >
          {isLayoutRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
