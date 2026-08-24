import type { GraphData, LayoutOptions, NodeData } from '@antv/g6';

const MAX_GRAPH_DEVICE_PIXEL_RATIO = 1.5;
const MIN_POSITION_REUSE_RATIO = 0.5;
const MAX_INCREMENTAL_NEW_NODE_RATIO = 0.35;
const MIN_INCREMENTAL_NEW_NODE_ALLOWANCE = 12;
const DEFAULT_NODE_DIAMETER = 24;
const NODE_PLACEMENT_GAP = 10;
const NODE_PLACEMENT_ATTEMPTS = 240;
const NODES_PER_PLACEMENT_RING = 12;
const PLACEMENT_RING_START = 64;
const PLACEMENT_RING_STEP = 28;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const INITIAL_POSITION_SPACING = 54;
const INITIAL_POSITION_ATTEMPTS = 480;
const INITIAL_POSITION_PHASE_WEIGHT = 0.08;
const LARGE_GRAPH_NODE_THRESHOLD = 120;
const LARGE_GRAPH_ANIMATED_ITERATIONS = 140;

export const LIGHTWEIGHT_FORCE_LAYOUT = {
  type: 'force',
  animation: true,
  iterations: 240,
  minMovement: 0.9,
  preventOverlap: true,
  linkDistance: 140,
  maxSpeed: 80,
  damping: 0.82,
  interval: 0.03,
} as const;

export const FINAL_FORCE_LAYOUT = {
  ...LIGHTWEIGHT_FORCE_LAYOUT,
  animation: false,
  iterations: 900,
  minMovement: 0.4,
} as const;

export function resolveLightweightForceLayout(
  prefersReducedMotion: boolean,
  nodeCount = 0,
): LayoutOptions {
  if (prefersReducedMotion) return FINAL_FORCE_LAYOUT;

  const animatedIterations = nodeCount > LARGE_GRAPH_NODE_THRESHOLD
    ? LARGE_GRAPH_ANIMATED_ITERATIONS
    : LIGHTWEIGHT_FORCE_LAYOUT.iterations;
  return [
    { ...LIGHTWEIGHT_FORCE_LAYOUT, iterations: animatedIterations },
    FINAL_FORCE_LAYOUT,
  ];
}

export function clampGraphDevicePixelRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(value, MAX_GRAPH_DEVICE_PIXEL_RATIO);
}

export function resolveStyledPreviewNodeId(
  searchHitIds: ReadonlySet<string>,
  previewNodeId: string | null,
): string | null {
  return searchHitIds.size > 0 ? previewNodeId : null;
}

interface GraphPoint {
  x: number;
  y: number;
}

export type GraphPresetPositioning =
  | { type: 'embedding-overview' }
  | {
      type: 'radial-focus';
      centerNodeId: string;
      formalNeighborIds: string[];
      semanticNeighborIds: string[];
      viewportRightInset?: number;
    };

export interface GraphPositionReuseResult {
  data: GraphData;
  reusedNodeCount: number;
  shouldReusePositions: boolean;
}

function readNodePosition(node: NodeData): GraphPoint | null {
  const x = Number(node.style?.x);
  const y = Number(node.style?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function stableAngle(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash, 31) + id.charCodeAt(index);
  }
  return ((hash >>> 0) % 360) * (Math.PI / 180);
}

function readNodeRadius(node: NodeData): number {
  const rawSize = node.style?.size;
  const values = Array.isArray(rawSize) ? rawSize : [rawSize];
  const diameter = Math.max(
    ...values
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0),
    DEFAULT_NODE_DIAMETER,
  );
  return diameter / 2;
}

function readNodeDegree(node: NodeData): number {
  const degree = Number((node.data as Record<string, unknown> | undefined)?.degree);
  return Number.isFinite(degree) ? degree : 0;
}

function findInitialPosition(
  node: NodeData,
  rank: number,
  center: GraphPoint,
  occupied: Array<GraphPoint & { radius: number }>,
): GraphPoint {
  const id = String(node.id);
  const radius = readNodeRadius(node);
  const phase = stableAngle(id) * INITIAL_POSITION_PHASE_WEIGHT;

  for (let attempt = 0; attempt < INITIAL_POSITION_ATTEMPTS; attempt += 1) {
    const slot = rank + attempt;
    const distance = INITIAL_POSITION_SPACING * Math.sqrt(slot);
    const angle = slot * GOLDEN_ANGLE + phase;
    const candidate = {
      x: center.x + Math.cos(angle) * distance,
      y: center.y + Math.sin(angle) * distance,
    };
    const hasCollision = occupied.some((position) => (
      Math.hypot(candidate.x - position.x, candidate.y - position.y) <
      radius + position.radius + NODE_PLACEMENT_GAP
    ));
    if (!hasCollision) return candidate;
  }

  const fallbackSlot = rank + INITIAL_POSITION_ATTEMPTS + occupied.length;
  const fallbackDistance = INITIAL_POSITION_SPACING * Math.sqrt(fallbackSlot);
  const fallbackAngle = fallbackSlot * GOLDEN_ANGLE + phase;
  return {
    x: center.x + Math.cos(fallbackAngle) * fallbackDistance,
    y: center.y + Math.sin(fallbackAngle) * fallbackDistance,
  };
}

export function seedGraphNodePositions(data: GraphData, center: GraphPoint): GraphData {
  const sourceNodes = data.nodes ?? [];
  const missingNodes = sourceNodes
    .filter((node) => !readNodePosition(node))
    .sort((left, right) => (
      readNodeDegree(right) - readNodeDegree(left) || String(left.id).localeCompare(String(right.id))
    ));
  if (missingNodes.length === 0) return data;

  const occupied: Array<GraphPoint & { radius: number }> = sourceNodes.flatMap((node) => {
    const position = readNodePosition(node);
    return position ? [{ ...position, radius: readNodeRadius(node) }] : [];
  });
  const seededPositions = new Map<string, GraphPoint>();

  for (let rank = 0; rank < missingNodes.length; rank += 1) {
    const node = missingNodes[rank];
    const position = findInitialPosition(node, rank, center, occupied);
    seededPositions.set(String(node.id), position);
    occupied.push({ ...position, radius: readNodeRadius(node) });
  }

  return {
    ...data,
    nodes: sourceNodes.map((node) => {
      const position = seededPositions.get(String(node.id));
      return position ? { ...node, style: { ...node.style, ...position } } : node;
    }),
  };
}

function nodeCommunity(node: NodeData): number {
  const value = Number((node.data as Record<string, unknown> | undefined)?.community);
  return Number.isInteger(value) ? value : -1;
}

export function positionEmbeddingCommunities(data: GraphData, center: GraphPoint): GraphData {
  const sourceNodes = data.nodes ?? [];
  const grouped = new Map<number, NodeData[]>();
  for (const node of sourceNodes) {
    const community = nodeCommunity(node);
    grouped.set(community, [...(grouped.get(community) ?? []), node]);
  }
  const groups = [...grouped.entries()].sort((left, right) => left[0] - right[0]);
  const clusterRingRadius = Math.max(420, Math.min(720, groups.length * 92));
  const positions = new Map<string, GraphPoint>();

  groups.forEach(([community, nodes], groupIndex) => {
    const clusterAngle = groups.length === 1
      ? 0
      : (Math.PI * 2 * groupIndex) / groups.length - Math.PI / 2;
    const clusterCenter = groups.length === 1
      ? center
      : {
          x: center.x + Math.cos(clusterAngle) * clusterRingRadius,
          y: center.y + Math.sin(clusterAngle) * clusterRingRadius,
        };
    const ordered = [...nodes].sort((left, right) => (
      readNodeDegree(right) - readNodeDegree(left) || String(left.id).localeCompare(String(right.id))
    ));
    ordered.forEach((node, rank) => {
      const angle = rank * GOLDEN_ANGLE + stableAngle(`${community}:${String(node.id)}`) * 0.06;
      const distance = rank === 0 ? 0 : 44 * Math.sqrt(rank);
      positions.set(String(node.id), {
        x: clusterCenter.x + Math.cos(angle) * distance,
        y: clusterCenter.y + Math.sin(angle) * distance,
      });
    });
  });

  return {
    ...data,
    nodes: sourceNodes.map((node) => ({
      ...node,
      style: { ...node.style, ...positions.get(String(node.id)) },
    })),
  };
}

export function positionRadialFocus(
  data: GraphData,
  center: GraphPoint,
  focus: Extract<GraphPresetPositioning, { type: 'radial-focus' }>,
): GraphData {
  const formalSet = new Set(focus.formalNeighborIds);
  const semanticSet = new Set(focus.semanticNeighborIds);
  const formalRadius = Math.max(190, Math.min(300, focus.formalNeighborIds.length * 16));
  const semanticRadius = Math.max(formalRadius + 145, Math.min(470, focus.semanticNeighborIds.length * 24 + 260));
  const positions = new Map<string, GraphPoint>([[focus.centerNodeId, center]]);

  focus.formalNeighborIds.forEach((nodeId, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, focus.formalNeighborIds.length) - Math.PI / 2;
    positions.set(nodeId, {
      x: center.x + Math.cos(angle) * formalRadius,
      y: center.y + Math.sin(angle) * formalRadius,
    });
  });
  focus.semanticNeighborIds.forEach((nodeId, index) => {
    const angle = (Math.PI * 2 * (index + 0.5)) / Math.max(1, focus.semanticNeighborIds.length) - Math.PI / 2;
    positions.set(nodeId, {
      x: center.x + Math.cos(angle) * semanticRadius,
      y: center.y + Math.sin(angle) * semanticRadius,
    });
  });

  return {
    ...data,
    nodes: (data.nodes ?? []).map((node) => {
      const id = String(node.id);
      const isCenter = id === focus.centerNodeId;
      const role = isCenter ? 'center' : formalSet.has(id) ? 'formal' : semanticSet.has(id) ? 'semantic' : 'other';
      return {
        ...node,
        data: { ...(node.data as Record<string, unknown> | undefined), focusRole: role },
        style: {
          ...node.style,
          ...positions.get(id),
          size: isCenter ? 42 : node.style?.size,
          label: true,
          labelPlacement: isCenter ? 'bottom' : node.style?.labelPlacement,
          labelOffsetY: isCenter ? 14 : node.style?.labelOffsetY,
        },
      };
    }),
  };
}

export function positionGraphPreset(
  data: GraphData,
  center: GraphPoint,
  positioning: GraphPresetPositioning,
): GraphData {
  return positioning.type === 'embedding-overview'
    ? positionEmbeddingCommunities(data, center)
    : positionRadialFocus(data, center, positioning);
}

function findOpenPosition(
  id: string,
  anchor: GraphPoint,
  radius: number,
  occupied: Array<GraphPoint & { radius: number }>,
): GraphPoint | null {
  const baseAngle = stableAngle(id);
  for (let attempt = 0; attempt < NODE_PLACEMENT_ATTEMPTS; attempt += 1) {
    const ring = Math.floor(attempt / NODES_PER_PLACEMENT_RING);
    const distance = PLACEMENT_RING_START + ring * PLACEMENT_RING_STEP;
    const angle = baseAngle + attempt * GOLDEN_ANGLE;
    const candidate = {
      x: anchor.x + Math.cos(angle) * distance,
      y: anchor.y + Math.sin(angle) * distance,
    };
    const hasCollision = occupied.some((position) => (
      Math.hypot(candidate.x - position.x, candidate.y - position.y) <
      radius + position.radius + NODE_PLACEMENT_GAP
    ));
    if (!hasCollision) return candidate;
  }
  return null;
}

export function reuseGraphNodePositions(
  data: GraphData,
  previousNodes: NodeData[],
  fallbackCenter: GraphPoint,
): GraphPositionReuseResult {
  const nextNodes = data.nodes ?? [];
  const previousPositions = new Map<string, GraphPoint>();
  for (const node of previousNodes) {
    const position = readNodePosition(node);
    if (position) previousPositions.set(String(node.id), position);
  }

  const reusedNodeCount = nextNodes.reduce(
    (count, node) => count + Number(previousPositions.has(String(node.id))),
    0,
  );
  const overlapBase = Math.min(previousPositions.size, nextNodes.length);
  const newNodeCount = nextNodes.length - reusedNodeCount;
  const incrementalNewNodeLimit = Math.max(
    MIN_INCREMENTAL_NEW_NODE_ALLOWANCE,
    Math.floor(previousPositions.size * MAX_INCREMENTAL_NEW_NODE_RATIO),
  );
  const shouldReusePositions = (
    overlapBase > 0 &&
    reusedNodeCount / overlapBase >= MIN_POSITION_REUSE_RATIO &&
    newNodeCount <= incrementalNewNodeLimit
  );

  if (!shouldReusePositions) {
    return { data, reusedNodeCount, shouldReusePositions };
  }

  const neighbors = new Map<string, string[]>();
  for (const edge of data.edges ?? []) {
    const source = String(edge.source);
    const target = String(edge.target);
    neighbors.set(source, [...(neighbors.get(source) ?? []), target]);
    neighbors.set(target, [...(neighbors.get(target) ?? []), source]);
  }

  const nextPositions = new Map(previousPositions);
  const occupied: Array<GraphPoint & { radius: number }> = [];
  for (const node of nextNodes) {
    const position = previousPositions.get(String(node.id));
    if (position) occupied.push({ ...position, radius: readNodeRadius(node) });
  }

  const nodes: NodeData[] = [];
  for (const node of nextNodes) {
    const id = String(node.id);
    const existing = previousPositions.get(id);
    if (existing) {
      nodes.push({ ...node, style: { ...node.style, ...existing } });
      continue;
    }

    const adjacentPositions = (neighbors.get(id) ?? [])
      .map((neighborId) => nextPositions.get(neighborId))
      .filter((position): position is GraphPoint => Boolean(position));
    const anchor = adjacentPositions.length > 0
      ? {
          x: adjacentPositions.reduce((sum, position) => sum + position.x, 0) / adjacentPositions.length,
          y: adjacentPositions.reduce((sum, position) => sum + position.y, 0) / adjacentPositions.length,
        }
      : fallbackCenter;
    const radius = readNodeRadius(node);
    const position = findOpenPosition(id, anchor, radius, occupied);
    if (!position) {
      return { data, reusedNodeCount, shouldReusePositions: false };
    }
    nextPositions.set(id, position);
    occupied.push({ ...position, radius });
    nodes.push({ ...node, style: { ...node.style, ...position } });
  }

  return {
    data: { ...data, nodes },
    reusedNodeCount,
    shouldReusePositions,
  };
}
