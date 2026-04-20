import { useEffect, useRef, useCallback, useState } from 'react';
import Sigma from 'sigma';
import { createEdgeCurveProgram } from '@sigma/edge-curve';
import { createNodeBorderProgram } from '@sigma/node-border';
import Graph from 'graphology';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';
import type { SigmaNodeAttributes, SigmaEdgeAttributes } from '@/lib/graph-adapter';
import { dimColor, brightenColor } from '@/lib/utils';
import type { ThemeMode } from '@/core/graph/types';

// Drag state (module-level)
let dragNodeId: string | null = null;
let dragStartX = 0;
let dragStartY = 0;
let dragMoved = false;
let dragCameraPanningWasEnabled = true;
const DRAG_LERP = 0.22;
const DRAG_SNAP_EPSILON = 0.4;
const DRAG_START_THRESHOLD = 5;
const INERTIA_MIN_SPEED = 0.015;
const INERTIA_MAX_SPEED = 1.2;
const INERTIA_DAMPING = 0.92;
const INERTIA_STOP_SPEED = 0.01;

interface UseSigmaOptions {
  onNodeClick?: (nodeId: string) => void;
  onNodeHover?: (nodeId: string | null) => void;
  onStageClick?: () => void;
  selectedNodeId: string | null;
  visibleNodeIds: Set<string>;
  themeMode: ThemeMode;
  showLabels: boolean;
}

const NOVERLAP_SETTINGS = {
  maxIterations: 20,
  ratio: 1.1,
  margin: 10,
  expansion: 1.05,
};

function getVisibleNodeScale(visibleCount: number): number {
  if (visibleCount > 120) return 0.5;
  if (visibleCount > 80) return 0.55;
  if (visibleCount > 50) return 0.6;
  if (visibleCount > 30) return 0.7;
  if (visibleCount > 16) return 0.8;
  return 1.0;
}

function makeNodeProgram(mode: ThemeMode) {
  const darkBg = mode === 'light' ? '#c8c8d4' : '#ffffff';
  const defaultColor = mode === 'light' ? '#9A9AB0' : '#6b7280';

  return createNodeBorderProgram({
    borders: [
      { color: { attribute: 'borderColor', defaultValue: darkBg }, size: { value: 2, mode: 'pixels' } },
      { color: { attribute: 'color', defaultValue: defaultColor }, size: { fill: true } },
    ],
    drawLabel: undefined,
    drawHover: makeDrawNodeHover(mode),
  });
}

function makeDrawNodeHover(mode: ThemeMode) {
  const bgColor = mode === 'light' ? '#f0f0f5' : '#12121c';
  const textColor = mode === 'light' ? '#1a1a2e' : '#f5f5f7';

  return (context: CanvasRenderingContext2D, data: { x: number; y: number; size?: number; label?: string | null; color?: string }, settings: { labelSize?: number; labelFont?: string; labelWeight?: string }) => {
    const label = data.label;
    if (!label) return;

    const size = settings.labelSize || 11;
    const font = settings.labelFont || "'PingFang SC', 'Microsoft YaHei', monospace";
    const weight = settings.labelWeight || '500';

    context.font = `${weight} ${size}px ${font}`;
    const textWidth = context.measureText(label).width;

    const nodeSize = data.size || 8;
    const x = data.x;
    const y = data.y - nodeSize - 10;
    const paddingX = 8;
    const paddingY = 5;
    const height = size + paddingY * 2;
    const width = textWidth + paddingX * 2;
    const radius = 4;

    context.fillStyle = bgColor;
    context.beginPath();
    context.roundRect(x - width / 2, y - height / 2, width, height, radius);
    context.fill();

    context.strokeStyle = data.color || '#7c3aed';
    context.lineWidth = 2;
    context.stroke();

    context.fillStyle = textColor;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, x, y);

    // Glow ring
    context.beginPath();
    context.arc(data.x, data.y, nodeSize + 4, 0, Math.PI * 2);
    context.strokeStyle = data.color || '#7c3aed';
    context.lineWidth = 2;
    context.globalAlpha = 0.5;
    context.stroke();
    context.globalAlpha = 1;
  };
}

function getFA2Settings(nodeCount: number) {
  const isSmall = nodeCount < 500;
  const isMedium = nodeCount >= 500 && nodeCount < 2000;
  const isLarge = nodeCount >= 2000 && nodeCount < 10000;

  return {
    gravity: isSmall ? 0.4 : isMedium ? 0.25 : isLarge ? 0.15 : 0.08,
    scalingRatio: isSmall ? 15 : isMedium ? 30 : isLarge ? 60 : 100,
    slowDown: isSmall ? 1 : isMedium ? 2 : isLarge ? 3 : 5,
    barnesHutOptimize: nodeCount > 200,
    barnesHutTheta: nodeCount > 2000 ? 0.8 : 0.6,
    nodeMassAttribute: 'mass',
    strongGravityMode: false,
    outboundAttractionDistribution: true,
    linLogMode: false,
    adjustSizes: true,
    edgeWeightInfluence: 1,
  };
}

function getLayoutDuration(nodeCount: number): number {
  if (nodeCount > 10000) return 45000;
  if (nodeCount > 5000) return 35000;
  if (nodeCount > 1000) return 25000;
  if (nodeCount > 500) return 20000;
  return 15000;
}

function runNoverlap(graph: Graph) {
  noverlap.assign(graph, {
    maxIterations: NOVERLAP_SETTINGS.maxIterations,
    settings: {
      ratio: NOVERLAP_SETTINGS.ratio,
      margin: NOVERLAP_SETTINGS.margin,
      expansion: NOVERLAP_SETTINGS.expansion,
    },
    inputReducer: (_, attrs) => ({
      ...attrs,
      size: ((attrs as Record<string, unknown>).collisionRadius as number || ((attrs as Record<string, unknown>).size as number || 8) * 1.8 + 10) * 1.15,
    }),
  });
}

function runNoverlapHeavy(graph: Graph) {
  noverlap.assign(graph, {
    maxIterations: 100,
    settings: { ratio: 1.2, margin: 18, expansion: 1.1 },
    inputReducer: (_, attrs) => ({
      ...attrs,
      size: ((attrs as Record<string, unknown>).collisionRadius as number || ((attrs as Record<string, unknown>).size as number || 8) * 1.8 + 10) * 1.15,
    }),
  });
}

function normalizePositions(graph: Graph) {
  let minX = Infinity;
  let minY = Infinity;
  graph.forEachNode((_, attrs) => {
    if (attrs.x < minX) minX = attrs.x;
    if (attrs.y < minY) minY = attrs.y;
  });
  if (isFinite(minX) && isFinite(minY)) {
    const offsetX = minX - 50;
    const offsetY = minY - 50;
    graph.forEachNode((node, attrs) => {
      graph.setNodeAttribute(node, 'x', attrs.x - offsetX);
      graph.setNodeAttribute(node, 'y', attrs.y - offsetY);
    });
  }
}

function ensureSeedPositions(graph: Graph) {
  graph.forEachNode((node, attrs) => {
    if (typeof attrs.x !== 'number' || !isFinite(attrs.x)) {
      graph.setNodeAttribute(node, 'x', Math.random() * 100);
    }
    if (typeof attrs.y !== 'number' || !isFinite(attrs.y)) {
      graph.setNodeAttribute(node, 'y', Math.random() * 100);
    }
  });
}

function fanOutCoincidentNodes(graph: Graph) {
  const buckets = new Map<string, string[]>();
  graph.forEachNode((id, attrs) => {
    const key = `${Math.round((attrs.x as number) * 10) / 10}:${Math.round((attrs.y as number) * 10) / 10}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(id);
  });

  for (const nodes of buckets.values()) {
    if (nodes.length < 2) continue;
    const firstAttrs = graph.getNodeAttributes(nodes[0]);
    const size = (firstAttrs.collisionRadius as number) || 20;
    const spreadRadius = size * 1.6 + 12;
    nodes.forEach((nodeId, index) => {
      const attrs = graph.getNodeAttributes(nodeId);
      const angle = (index / nodes.length) * Math.PI * 2;
      graph.setNodeAttribute(nodeId, 'x', (attrs.x as number) + Math.cos(angle) * spreadRadius);
      graph.setNodeAttribute(nodeId, 'y', (attrs.y as number) + Math.sin(angle) * spreadRadius);
    });
  }
}

export function useSigma(options: UseSigmaOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sigmaRef = useRef<Sigma<any, any, any> | null>(null);
  const graphRef = useRef<Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null);
  const layoutRef = useRef<FA2Layout | null>(null);
  const layoutTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const visibleNodeIdsRef = useRef<Set<string>>(new Set());
  const themeModeRef = useRef<ThemeMode>('dark');
  const dragTargetRef = useRef<{ x: number; y: number } | null>(null);
  const dragAnimationFrameRef = useRef<number | null>(null);
  const inertiaAnimationFrameRef = useRef<number | null>(null);
  const dragVelocityRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const dragLayoutWasRunningRef = useRef(false);
  const suppressStageClickUntilRef = useRef(0);
  const [containerReady, setContainerReady] = useState(false);

  // Update refs when props change
  useEffect(() => {
    selectedNodeRef.current = options.selectedNodeId;
    visibleNodeIdsRef.current = options.visibleNodeIds;
    themeModeRef.current = options.themeMode;
    sigmaRef.current?.refresh();
  }, [options.selectedNodeId, options.visibleNodeIds, options.themeMode]);

  // Observe container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const check = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setContainerReady(true);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Initialize Sigma once
  useEffect(() => {
    if (!containerRef.current) return;

    const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>();
    graphRef.current = graph;

    const mode = themeModeRef.current;
    const t = {
      colorText: mode === 'light' ? '#1a1a2e' : '#e4e4ed',
      colorBorderStrong: mode === 'light' ? '#9090a8' : '#3a3a4a',
      colorAccent: '#7c3aed',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sigma = new Sigma(graph as any, containerRef.current, {
      defaultEdgeType: 'curved',
      edgeProgramClasses: { curved: createEdgeCurveProgram() as any },
      nodeProgramClasses: { bordered: makeNodeProgram(mode) as any },
      defaultNodeType: 'bordered',
      renderLabels: true,
      labelFont: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', monospace",
      labelSize: 11,
      labelWeight: '500',
      labelColor: { color: t.colorText },
      labelRenderedSizeThreshold: 5,
      labelDensity: 0.1,
      labelGridCellSize: 70,
      defaultNodeColor: mode === 'light' ? '#9A9AB0' : '#6b7280',
      defaultEdgeColor: t.colorBorderStrong,
      minCameraRatio: 0.002,
      maxCameraRatio: 50,
      hideEdgesOnMove: false,
      zIndex: true,

      nodeReducer: (node: string, attrs: Record<string, unknown>) => {
        const res = { ...attrs };
        if (!visibleNodeIdsRef.current.has(node)) {
          return { ...res, hidden: true } as Record<string, unknown>;
        }

        const baseSize = (res.size as number) || 8;
        const scaledBaseSize = Math.max(2, baseSize * getVisibleNodeScale(visibleNodeIdsRef.current.size));

        if (node === dragNodeId) {
          return { ...res, hidden: false, size: scaledBaseSize, borderColor: brightenColor((res.borderColor as string) || t.colorAccent, 1.35, mode), highlighted: true, zIndex: 3 } as Record<string, unknown>;
        }

        const selectedId = selectedNodeRef.current;
        if (!selectedId) return { ...res, hidden: false } as Record<string, unknown>;

        if (node === selectedId) {
          return { ...res, hidden: false, size: scaledBaseSize, borderColor: t.colorAccent, highlighted: true, zIndex: 2 } as Record<string, unknown>;
        }

        const currentGraph = graphRef.current;
        if (currentGraph && (currentGraph.hasEdge(node, selectedId) || currentGraph.hasEdge(selectedId, node))) {
          return { ...res, hidden: false, size: scaledBaseSize, borderColor: brightenColor((res.borderColor as string) || t.colorBorderStrong, 1.2, mode), zIndex: 1 } as Record<string, unknown>;
        }

        return {
          ...res,
          hidden: false,
          color: dimColor((res.color as string) || '#6b7280', 0.25, mode),
          borderColor: dimColor((res.borderColor as string) || t.colorBorderStrong, 0.25, mode),
          size: scaledBaseSize * 0.92,
          label: '',
          zIndex: 0,
        } as Record<string, unknown>;
      },

      edgeReducer: (edge: string, attrs: Record<string, unknown>) => {
        const res = { ...attrs };
        const currentGraph = graphRef.current;
        if (!currentGraph) return res;

        const src = currentGraph.source(edge) as string;
        const tgt = currentGraph.target(edge) as string;

        if (!visibleNodeIdsRef.current.has(src) || !visibleNodeIdsRef.current.has(tgt)) {
          return { ...res, hidden: true } as Record<string, unknown>;
        }

        const selectedId = selectedNodeRef.current;
        if (!selectedId) return { ...res, hidden: false } as Record<string, unknown>;

        const isConnected = src === selectedId || tgt === selectedId;
        const baseSize = (res.size as number) || 1;

        if (isConnected) {
          return { ...res, hidden: false, color: brightenColor((res.color as string) || t.colorBorderStrong, 1.5, mode), size: Math.max(3, baseSize * 4), zIndex: 2 } as Record<string, unknown>;
        }
        return { ...res, hidden: false, color: dimColor((res.color as string) || t.colorBorderStrong, 0.1, mode), size: 0.3, zIndex: 0 } as Record<string, unknown>;
      },
    });

    sigmaRef.current = sigma;

    // Event handlers
    sigma.on('clickNode', ({ node }) => {
      suppressStageClickUntilRef.current = performance.now() + 250;
      options.onNodeClick?.(node);
    });

    sigma.on('clickStage', () => {
      if (performance.now() < suppressStageClickUntilRef.current) return;
      options.onStageClick?.();
    });

    sigma.on('enterNode', ({ node }) => {
      options.onNodeHover?.(node);
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });

    sigma.on('leaveNode', () => {
      options.onNodeHover?.(null);
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });

    // Drag handlers
    const stopDragAnimation = () => {
      if (dragAnimationFrameRef.current !== null) {
        cancelAnimationFrame(dragAnimationFrameRef.current);
        dragAnimationFrameRef.current = null;
      }
    };

    const stopInertiaAnimation = () => {
      if (inertiaAnimationFrameRef.current !== null) {
        cancelAnimationFrame(inertiaAnimationFrameRef.current);
        inertiaAnimationFrameRef.current = null;
      }
    };

    const animateDraggedNode = () => {
      const activeSigma = sigmaRef.current;
      const activeGraph = graphRef.current;
      const target = dragTargetRef.current;
      if (!activeSigma || !activeGraph || !target || dragNodeId === null || !activeGraph.hasNode(dragNodeId)) {
        dragAnimationFrameRef.current = null;
        return;
      }

      const attrs = activeGraph.getNodeAttributes(dragNodeId);
      const currentX = (attrs.x as number) || 0;
      const currentY = (attrs.y as number) || 0;
      const nextX = currentX + (target.x - currentX) * DRAG_LERP;
      const nextY = currentY + (target.y - currentY) * DRAG_LERP;
      const distance = Math.hypot(target.x - currentX, target.y - currentY);

      activeGraph.setNodeAttribute(dragNodeId, 'x', distance <= DRAG_SNAP_EPSILON ? target.x : nextX);
      activeGraph.setNodeAttribute(dragNodeId, 'y', distance <= DRAG_SNAP_EPSILON ? target.y : nextY);
      activeSigma.refresh();
      dragAnimationFrameRef.current = requestAnimationFrame(animateDraggedNode);
    };

    const ensureDragAnimation = () => {
      if (dragAnimationFrameRef.current !== null) return;
      dragAnimationFrameRef.current = requestAnimationFrame(animateDraggedNode);
    };

    const finalizeNodeDrag = (nodeId: string) => {
      const activeGraph = graphRef.current;
      if (activeGraph && activeGraph.hasNode(nodeId)) {
        const target = dragTargetRef.current;
        if (target) {
          activeGraph.setNodeAttribute(nodeId, 'x', target.x);
          activeGraph.setNodeAttribute(nodeId, 'y', target.y);
        }
      }
      sigmaRef.current?.refresh();
      // Nudge edge refresh
      const camera = sigmaRef.current?.getCamera();
      if (camera) {
        camera.animate({ ratio: camera.getBoundedRatio(camera.ratio * 1.0001) }, { duration: 50 });
      }
      if (dragLayoutWasRunningRef.current && activeGraph) {
        startLayoutWorker(activeGraph);
      }
      dragLayoutWasRunningRef.current = false;
      dragVelocityRef.current = null;
    };

    const startInertiaAnimation = (nodeId: string, velocity: { x: number; y: number }) => {
      const initialSpeed = Math.hypot(velocity.x, velocity.y);
      if (initialSpeed < INERTIA_MIN_SPEED) { finalizeNodeDrag(nodeId); return; }

      let vx = Math.max(-INERTIA_MAX_SPEED, Math.min(INERTIA_MAX_SPEED, velocity.x));
      let vy = Math.max(-INERTIA_MAX_SPEED, Math.min(INERTIA_MAX_SPEED, velocity.y));
      let lastTime = performance.now();

      const step = (now: number) => {
        const activeGraph = graphRef.current;
        const activeSigma = sigmaRef.current;
        if (!activeGraph || !activeSigma || !activeGraph.hasNode(nodeId)) {
          inertiaAnimationFrameRef.current = null;
          dragLayoutWasRunningRef.current = false;
          return;
        }

        const dt = Math.min(now - lastTime, 32);
        lastTime = now;

        const attrs = activeGraph.getNodeAttributes(nodeId);
        const nextX = (attrs.x as number) + vx * dt;
        const nextY = (attrs.y as number) + vy * dt;
        activeGraph.setNodeAttribute(nodeId, 'x', nextX);
        activeGraph.setNodeAttribute(nodeId, 'y', nextY);
        dragTargetRef.current = { x: nextX, y: nextY };
        activeSigma.refresh();

        vx *= INERTIA_DAMPING;
        vy *= INERTIA_DAMPING;

        if (Math.hypot(vx, vy) <= INERTIA_STOP_SPEED) {
          inertiaAnimationFrameRef.current = null;
          finalizeNodeDrag(nodeId);
          return;
        }

        inertiaAnimationFrameRef.current = requestAnimationFrame(step);
      };

      stopInertiaAnimation();
      inertiaAnimationFrameRef.current = requestAnimationFrame(step);
    };

    sigma.on('downNode', (e) => {
      stopInertiaAnimation();
      suppressStageClickUntilRef.current = performance.now() + 300;
      dragNodeId = e.node;
      const orig = e.event.original;
      if ('clientX' in orig) {
        dragStartX = orig.clientX;
        dragStartY = orig.clientY;
      }
      const attrs = graph.getNodeAttributes(e.node);
      dragTargetRef.current = { x: attrs.x as number, y: attrs.y as number };
      dragVelocityRef.current = null;
      dragMoved = false;
      dragCameraPanningWasEnabled = sigma.getCamera().enabledPanning;
      sigma.getCamera().enabledPanning = false;
      sigma.refresh();
    });

    const onMove = (e: MouseEvent) => {
      if (dragNodeId === null || !sigmaRef.current || !graphRef.current || !containerRef.current) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (!dragMoved && Math.abs(dx) < DRAG_START_THRESHOLD && Math.abs(dy) < DRAG_START_THRESHOLD) return;

      const currentSigma = sigmaRef.current;
      const currentGraph = graphRef.current;
      if (!currentGraph.hasNode(dragNodeId)) return;

      if (!dragMoved) {
        dragMoved = true;
        (currentGraph as Graph).setNodeAttribute(dragNodeId, 'fixed', true);
        dragLayoutWasRunningRef.current = layoutRef.current !== null;
        if (layoutRef.current) {
          layoutRef.current.kill();
          layoutRef.current = null;
        }
      }

      const rect = containerRef.current.getBoundingClientRect();
      const pos = currentSigma.viewportToGraph({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      const now = performance.now();
      const previousTarget = dragTargetRef.current;
      if (previousTarget) {
        const dt = Math.max(now - (dragVelocityRef.current?.at ?? now), 1);
        const nextVx = (pos.x - previousTarget.x) / dt;
        const nextVy = (pos.y - previousTarget.y) / dt;
        const prev = dragVelocityRef.current;
        dragVelocityRef.current = {
          x: prev ? prev.x * 0.55 + nextVx * 0.45 : nextVx,
          y: prev ? prev.y * 0.55 + nextVy * 0.45 : nextVy,
          at: now,
        };
      }
      dragTargetRef.current = { x: pos.x, y: pos.y };
      ensureDragAnimation();
      if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
    };

    const onUp = () => {
      if (dragNodeId === null) return;
      stopDragAnimation();
      if (sigmaRef.current) sigmaRef.current.getCamera().enabledPanning = dragCameraPanningWasEnabled;
      const currentNodeId = dragNodeId;
      const activeGraph = graphRef.current;
      const target = dragTargetRef.current;
      if (dragMoved && activeGraph && target && activeGraph.hasNode(currentNodeId)) {
        activeGraph.setNodeAttribute(currentNodeId, 'x', target.x);
        activeGraph.setNodeAttribute(currentNodeId, 'y', target.y);
        sigmaRef.current?.refresh();
        const velocity = dragVelocityRef.current;
        if (velocity) startInertiaAnimation(currentNodeId, velocity);
        else finalizeNodeDrag(currentNodeId);
      }
      if (!dragMoved) {
        suppressStageClickUntilRef.current = performance.now() + 250;
        options.onNodeClick?.(dragNodeId);
      }
      dragNodeId = null;
      dragTargetRef.current = null;
      dragMoved = false;
      sigmaRef.current?.refresh();
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      stopDragAnimation();
      stopInertiaAnimation();
      dragTargetRef.current = null;
      dragVelocityRef.current = null;
      if (layoutTimeoutRef.current) clearTimeout(layoutTimeoutRef.current);
      if (layoutRef.current) { layoutRef.current.kill(); layoutRef.current = null; }
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update label visibility
  useEffect(() => {
    sigmaRef.current?.setSetting('renderLabels', options.showLabels);
  }, [options.showLabels]);

  // Layout functions
  const startLayoutWorker = useCallback((targetGraph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>, hasSemanticLayout = false) => {
    const nodeCount = targetGraph.order;
    if (nodeCount === 0) return;

    if (layoutRef.current) { layoutRef.current.kill(); layoutRef.current = null; }
    if (layoutTimeoutRef.current) { clearTimeout(layoutTimeoutRef.current); layoutTimeoutRef.current = null; }

    if (hasSemanticLayout) {
      runNoverlapHeavy(targetGraph);
      normalizePositions(targetGraph);
      sigmaRef.current?.refresh();
      return;
    }

    ensureSeedPositions(targetGraph);
    fanOutCoincidentNodes(targetGraph);

    const inferredSettings = forceAtlas2.inferSettings(targetGraph);
    const customSettings = getFA2Settings(nodeCount);
    const settings = { ...inferredSettings, ...customSettings };

    const layout = new FA2Layout(targetGraph, { settings });
    layoutRef.current = layout;
    layout.start();

    // Convergence detection
    const CONVERGENCE_SAMPLE_INTERVAL = 2000;
    const CONVERGENCE_THRESHOLD = 0.5;
    const CONVERGENCE_ROUNDS_NEEDED = 2;

    const sampleSize = Math.min(nodeCount, 50);
    const allNodeIds = targetGraph.nodes();
    const sampleStep = Math.max(1, Math.floor(allNodeIds.length / sampleSize));
    const sampleIds: string[] = [];
    for (let i = 0; i < allNodeIds.length; i += sampleStep) sampleIds.push(allNodeIds[i]);

    let convergenceCount = 0;
    let prevPositions = new Map<string, { x: number; y: number }>();
    let stopped = false;

    const convergenceInterval = setInterval(() => {
      if (stopped) return;
      let totalMovement = 0;
      let count = 0;
      sampleIds.forEach((id) => {
        if (!targetGraph.hasNode(id)) return;
        const attrs = targetGraph.getNodeAttributes(id);
        const x = attrs.x as number;
        const y = attrs.y as number;
        const prev = prevPositions.get(id);
        if (prev) { totalMovement += Math.hypot(x - prev.x, y - prev.y); count += 1; }
        prevPositions.set(id, { x, y });
      });
      if (count === 0) return;
      const avgMovement = totalMovement / count;
      if (avgMovement < CONVERGENCE_THRESHOLD) { convergenceCount++; if (convergenceCount >= CONVERGENCE_ROUNDS_NEEDED) doStop(); }
      else convergenceCount = 0;
    }, CONVERGENCE_SAMPLE_INTERVAL);

    const doStop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(convergenceInterval);
      if (layoutTimeoutRef.current) { clearTimeout(layoutTimeoutRef.current); layoutTimeoutRef.current = null; }
      layout.stop();
      runNoverlap(targetGraph);
      normalizePositions(targetGraph);
      sigmaRef.current?.refresh();
    };

    const maxDuration = getLayoutDuration(nodeCount);
    layoutTimeoutRef.current = setTimeout(doStop, maxDuration);
  }, []);

  const setGraph = useCallback((newGraph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>, hasSemanticLayout = false) => {
    const sigma = sigmaRef.current;
    if (!sigma) return;

    if (layoutRef.current) { layoutRef.current.kill(); layoutRef.current = null; }
    if (layoutTimeoutRef.current) { clearTimeout(layoutTimeoutRef.current); layoutTimeoutRef.current = null; }

    graphRef.current = newGraph;
    sigma.setGraph(newGraph);
    sigma.refresh();

    startLayoutWorker(newGraph, hasSemanticLayout);
    sigma.getCamera().animatedReset({ duration: 600 });
  }, [startLayoutWorker]);

  const zoomIn = useCallback(() => {
    const camera = sigmaRef.current?.getCamera();
    if (!camera) return;
    camera.animate({ ratio: camera.getBoundedRatio(camera.ratio / 1.5) }, { duration: 300 });
  }, []);

  const zoomOut = useCallback(() => {
    const camera = sigmaRef.current?.getCamera();
    if (!camera) return;
    camera.animate({ ratio: camera.getBoundedRatio(camera.ratio * 1.5) }, { duration: 300 });
  }, []);

  const resetZoom = useCallback(() => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 600 });
  }, []);

  const focusNode = useCallback((nodeId: string) => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph || !graph.hasNode(nodeId)) return;
    const attrs = graph.getNodeAttributes(nodeId);
    sigma.getCamera().animate(
      { x: attrs.x, y: attrs.y, ratio: 0.15 },
      { duration: 500 },
    );
  }, []);

  const fitToScreen = useCallback(() => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 600 });
  }, []);

  const startLayout = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || graph.order === 0) return;
    startLayoutWorker(graph);
  }, [startLayoutWorker]);

  const stopLayout = useCallback(() => {
    if (layoutTimeoutRef.current) { clearTimeout(layoutTimeoutRef.current); layoutTimeoutRef.current = null; }
    if (layoutRef.current) {
      layoutRef.current.stop();
      layoutRef.current = null;
      const graph = graphRef.current;
      if (graph) { runNoverlap(graph); normalizePositions(graph); sigmaRef.current?.refresh(); }
    }
  }, []);

  return {
    containerRef,
    sigmaRef,
    graphRef,
    setGraph,
    zoomIn,
    zoomOut,
    resetZoom,
    focusNode,
    fitToScreen,
    startLayout,
    stopLayout,
    containerReady,
  };
}
