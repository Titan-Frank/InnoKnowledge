import type { GraphData, NodeData } from '@antv/g6';

const MAX_GRAPH_DEVICE_PIXEL_RATIO = 1.5;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

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

function stableAngle(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash, 31) + id.charCodeAt(index);
  }
  return ((hash >>> 0) % 360) * (Math.PI / 180);
}

function readNodeDegree(node: NodeData): number {
  const degree = Number((node.data as Record<string, unknown> | undefined)?.degree);
  return Number.isFinite(degree) ? degree : 0;
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
