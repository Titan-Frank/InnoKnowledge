import type { GraphData, NodeData } from '@antv/g6';

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

export const LIGHTWEIGHT_FORCE_LAYOUT = {
  type: 'force',
  animation: false,
  iterations: 100,
  preventOverlap: true,
  linkDistance: 140,
  maxSpeed: 80,
  damping: 0.82,
} as const;

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
