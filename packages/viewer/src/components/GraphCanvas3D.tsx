import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import ForceGraph3D, {
  type ForceGraphMethods,
  type NodeObject,
} from 'react-force-graph-3d';
import { Object3D } from 'three';
import SpriteText from 'three-spritetext';
import type { ThemeMode } from '@/core/graph/types';
import type { BuildResult } from '@/lib/graph-adapter';
import {
  buildGraph3DData,
  escapeGraphTooltip,
  resolveGraph3DLabelIds,
  type Graph3DLink,
  type Graph3DNode,
} from '@/lib/graph-3d';

export interface GraphCanvas3DHandle {
  fitToScreen: () => void;
  focusNode: (nodeId: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

interface GraphCanvas3DProps {
  active: boolean;
  build: BuildResult;
  selectedNodeId: string | null;
  searchHitIds: Set<string>;
  previewNodeId: string | null;
  themeMode: ThemeMode;
  showLabels: boolean;
  onNodeClick: (nodeId: string) => void;
  onNodeHover: (nodeId: string | null) => void;
  onStageClick: () => void;
  onLayoutRunningChange: (running: boolean) => void;
}

interface CameraControls {
  target?: { x: number; y: number; z: number };
}

const CAMERA_TRANSITION_MS = 420;
const NODE_SELECTION_DELAY_MS = 120;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  ));

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

const GraphCanvas3D = forwardRef<GraphCanvas3DHandle, GraphCanvas3DProps>(function GraphCanvas3D({
  active,
  build,
  selectedNodeId,
  searchHitIds,
  previewNodeId,
  themeMode,
  showLabels,
  onNodeClick,
  onNodeHover,
  onStageClick,
  onLayoutRunningChange,
}, forwardedRef) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<Graph3DNode, Graph3DLink> | undefined>(undefined);
  const pendingAutoFitRef = useRef(true);
  const engineTickRef = useRef(0);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const reducedMotion = usePrefersReducedMotion();
  const focusedGraph = 'formalNeighborIds' in build && Array.isArray(build.formalNeighborIds);
  const graphData = useMemo(() => buildGraph3DData(build), [build]);
  const labelIds = useMemo(() => resolveGraph3DLabelIds(
    graphData.nodes,
    showLabels,
    selectedNodeId,
    searchHitIds,
    previewNodeId,
  ), [graphData.nodes, previewNodeId, searchHitIds, selectedNodeId, showLabels]);
  const transitionMs = reducedMotion ? 0 : CAMERA_TRANSITION_MS;

  const fitConnectedStructure = useCallback(() => {
    const connectedNodeCount = graphData.nodes.filter((node) => node.visibleDegree > 0).length;
    const structuralNodeCount = graphData.nodes.filter((node) => node.visibleDegree >= 2).length;
    const focusStructuralCore = structuralNodeCount >= 6 && structuralNodeCount < graphData.nodes.length * 0.72;
    const focusConnected = connectedNodeCount >= 3 && connectedNodeCount < graphData.nodes.length * 0.84;
    graphRef.current?.zoomToFit(
      transitionMs,
      64,
      focusStructuralCore
        ? (node) => node.visibleDegree >= 2
        : focusConnected
          ? (node) => node.visibleDegree > 0
          : undefined,
    );
  }, [graphData.nodes, transitionMs]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      const bounds = container.getBoundingClientRect();
      setSize({
        width: Math.max(1, Math.floor(bounds.width)),
        height: Math.max(1, Math.floor(bounds.height)),
      });
    };
    updateSize();
    let resizeTimer: number | null = null;
    const scheduleSizeUpdate = () => {
      if (resizeTimer != null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(updateSize, 380);
    };
    const observer = new ResizeObserver(scheduleSizeUpdate);
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (resizeTimer != null) window.clearTimeout(resizeTimer);
    };
  }, []);

  useEffect(() => {
    pendingAutoFitRef.current = true;
    engineTickRef.current = 0;
  }, [graphData]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!active) {
      graph?.pauseAnimation();
      onLayoutRunningChange(false);
      return;
    }
    graph?.resumeAnimation();
    if (!pendingAutoFitRef.current) return;
    onLayoutRunningChange(true);
    const chargeForce = graph?.d3Force('charge');
    const linkForce = graph?.d3Force('link');
    chargeForce?.strength?.(focusedGraph ? -125 : -48);
    chargeForce?.distanceMax?.(focusedGraph ? 420 : 260);
    linkForce?.distance?.(focusedGraph ? 78 : 34);
    graph?.d3ReheatSimulation();
  }, [active, focusedGraph, graphData, onLayoutRunningChange]);

  useEffect(() => () => {
    graphRef.current?.pauseAnimation();
    onLayoutRunningChange(false);
  }, [onLayoutRunningChange]);

  const fitToScreen = useCallback(() => {
    graphRef.current?.zoomToFit(transitionMs, 72);
  }, [transitionMs]);

  const focusNode = useCallback((nodeId: string) => {
    const node = graphData.nodes.find((candidate) => String(candidate.id) === nodeId);
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) return;
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const z = node.z ?? 0;
    const distance = Math.hypot(x, y, z);
    const ratio = distance > 0 ? 1 + 92 / distance : 1;
    graphRef.current?.cameraPosition(
      { x: x * ratio, y: y * ratio, z: distance > 0 ? z * ratio : 92 },
      { x, y, z },
      transitionMs,
    );
  }, [graphData.nodes, transitionMs]);

  const zoomBy = useCallback((factor: number) => {
    const graph = graphRef.current;
    if (!graph) return;
    const position = graph.camera().position;
    const controls = graph.controls() as CameraControls;
    const target = controls.target ?? { x: 0, y: 0, z: 0 };
    graph.cameraPosition({
      x: target.x + (position.x - target.x) / factor,
      y: target.y + (position.y - target.y) / factor,
      z: target.z + (position.z - target.z) / factor,
    }, target, transitionMs);
  }, [transitionMs]);

  useImperativeHandle(forwardedRef, () => ({
    fitToScreen,
    focusNode,
    zoomIn: () => zoomBy(1.35),
    zoomOut: () => zoomBy(1 / 1.35),
  }), [fitToScreen, focusNode, zoomBy]);

  const handleEngineStop = useCallback(() => {
    onLayoutRunningChange(false);
    if (!active) return;
    if (!pendingAutoFitRef.current) return;
    pendingAutoFitRef.current = false;
    fitConnectedStructure();
  }, [active, fitConnectedStructure, onLayoutRunningChange]);

  const handleEngineTick = useCallback(() => {
    if (!active || !pendingAutoFitRef.current) return;
    engineTickRef.current += 1;
    if (engineTickRef.current === (reducedMotion ? 1 : 24)) fitConnectedStructure();
  }, [active, fitConnectedStructure, reducedMotion]);

  const nodeColor = useCallback((node: NodeObject<Graph3DNode>) => {
    const id = String(node.id);
    if (id === selectedNodeId) return themeMode === 'light' ? '#0f4fd6' : '#f8fafc';
    if (id === previewNodeId || searchHitIds.has(id)) return node.color;
    if (searchHitIds.size > 0) return themeMode === 'light' ? '#a8b2c1' : '#3e4652';
    return node.color;
  }, [previewNodeId, searchHitIds, selectedNodeId, themeMode]);

  const nodeValue = useCallback((node: NodeObject<Graph3DNode>) => {
    const base = Math.max(1.4, node.size / 8);
    if (String(node.id) === selectedNodeId) return base * 2.2;
    if (String(node.id) === previewNodeId || searchHitIds.has(String(node.id))) return base * 1.45;
    return base;
  }, [previewNodeId, searchHitIds, selectedNodeId]);

  const nodeThreeObject = useCallback((node: NodeObject<Graph3DNode>) => {
    const id = String(node.id);
    if (!labelIds.has(id)) return new Object3D();
    const selected = id === selectedNodeId;
    const sprite = new SpriteText(
      node.label,
      selected ? 7 : 5.4,
      themeMode === 'light' ? '#17202a' : '#f2f5f7',
    );
    sprite.fontFace = 'PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif';
    sprite.fontWeight = selected ? '600' : '500';
    sprite.backgroundColor = selected
      ? (themeMode === 'light' ? 'rgba(255,255,255,0.94)' : 'rgba(15,17,21,0.92)')
      : (themeMode === 'light' ? 'rgba(246,247,249,0.76)' : 'rgba(15,17,21,0.68)');
    sprite.borderColor = selected ? '#2563eb' : (themeMode === 'light' ? '#c3ccd7' : '#3e4652');
    sprite.borderWidth = selected ? 0.45 : 0.2;
    sprite.borderRadius = 2;
    sprite.padding = [1.6, 0.8];
    sprite.position.y = selected ? 11 : 8.5;
    sprite.material.depthWrite = false;
    sprite.renderOrder = selected ? 20 : 10;
    return sprite;
  }, [labelIds, selectedNodeId, themeMode]);

  const nodeLabel = useCallback((node: NodeObject<Graph3DNode>) => {
    const name = escapeGraphTooltip(node.label);
    const type = escapeGraphTooltip(node.nodeType);
    return `<div class="okm-graph-3d-tooltip"><strong>${name}</strong><span>${type}</span></div>`;
  }, []);

  return (
    <div
      ref={containerRef}
      className="okm-graph-3d absolute inset-0 overflow-hidden"
      role="application"
      aria-label="三维知识图谱。拖拽旋转，滚轮缩放，点击节点查看关联节点"
    >
      <ForceGraph3D<Graph3DNode, Graph3DLink>
        ref={graphRef}
        width={size.width}
        height={size.height}
        graphData={graphData}
        backgroundColor={themeMode === 'light' ? '#f6f7f9' : '#0f1115'}
        showNavInfo={false}
        controlType="trackball"
        nodeId="id"
        nodeLabel={nodeLabel}
        nodeColor={nodeColor}
        nodeVal={nodeValue}
        nodeRelSize={4.2}
        nodeOpacity={0.94}
        nodeResolution={12}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend
        linkSource="source"
        linkTarget="target"
        linkLabel="label"
        linkColor="color"
        linkWidth="width"
        linkOpacity={themeMode === 'light' ? 0.42 : 0.34}
        linkResolution={4}
        linkDirectionalArrowLength="arrowLength"
        linkDirectionalArrowColor="color"
        linkDirectionalArrowRelPos={0.86}
        linkDirectionalArrowResolution={5}
        warmupTicks={reducedMotion ? 110 : 36}
        cooldownTicks={reducedMotion ? 0 : 80}
        d3AlphaDecay={0.045}
        d3VelocityDecay={0.34}
        enableNodeDrag={!reducedMotion}
        showPointerCursor
        onNodeClick={(node) => {
          const nodeId = String(node.id);
          // Let the navigation controls finish pointer-up bookkeeping before
          // the focused graph replaces the current Three.js scene.
          window.setTimeout(() => onNodeClick(nodeId), NODE_SELECTION_DELAY_MS);
        }}
        onNodeHover={(node) => onNodeHover(node ? String(node.id) : null)}
        onBackgroundClick={onStageClick}
        onEngineTick={handleEngineTick}
        onEngineStop={handleEngineStop}
      />
    </div>
  );
});

export default GraphCanvas3D;
