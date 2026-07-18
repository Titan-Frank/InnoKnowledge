import type { GraphData } from '@antv/g6';
import type { KnowledgeGraph, ThemeMode } from '@/core/graph/types';
import { resolveEdgeVisual } from './edge-styles';
import { COMMUNITY_EDGE_TYPES, getCommunityColor, TYPE_META } from './constants';
import { lightenForBorder } from './utils';

export interface CommunityInfo {
  id: number;
  color: string;
  nodeCount: number;
  dominantType: string;
}

export interface G6EdgePair {
  id: string;
  source: string;
  target: string;
}

export interface BuildResult {
  data: GraphData;
  communityCount: number;
  communities: CommunityInfo[];
  communityMap: Map<string, number>;
  nodeIds: string[];
  edgePairs: G6EdgePair[];
}

const NODE_SIZE_MAP: Record<string, number> = {
  concept: 26, rule: 24, process: 21, entity: 20, property: 18,
  method: 18, representation: 17, resource: 16, event: 16,
  substance: 20, experiment: 18, symbol: 17, other: 16,
};

const MIN_STORED_LAYOUT_COVERAGE = 0.8;
const COMMUNITY_SPACING_X = 560;
const COMMUNITY_SPACING_Y = 500;
const COMMUNITY_RADIUS = 170;
const NODE_POSITION_GAP = 52;
const POSITION_ATTEMPTS = 180;
const POSITIONS_PER_RING = 12;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

interface LayoutPoint {
  x: number;
  y: number;
}

interface LayoutMember {
  node: KnowledgeGraph['nodes'][number];
  stored: LayoutPoint | null;
}

interface LayoutGroup {
  key: string;
  members: LayoutMember[];
  meanX: number | null;
  meanY: number | null;
}

function getNodeSize(nodeType: string, nodeLayer: string | null | undefined): number {
  const base = NODE_SIZE_MAP[nodeType] ?? NODE_SIZE_MAP.other;
  return nodeLayer === 'backbone' ? base * 1.18 : base;
}

function getTypeColor(type: string): string {
  return TYPE_META[type]?.color ?? TYPE_META.other.color;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStoredLayout(node: KnowledgeGraph['nodes'][number]): LayoutPoint | null {
  const raw = node.properties.layout;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const layout = raw as Record<string, unknown>;
  const x = finiteNumber(layout.x);
  const y = finiteNumber(layout.y);
  return x == null || y == null ? null : { x, y };
}

function stableAngle(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash, 31) + id.charCodeAt(index);
  }
  return ((hash >>> 0) % 360) * (Math.PI / 180);
}

function findOpenLayoutPosition(
  id: string,
  target: LayoutPoint,
  occupied: LayoutPoint[],
): LayoutPoint {
  const isOpen = (candidate: LayoutPoint) => occupied.every((position) => (
    Math.hypot(candidate.x - position.x, candidate.y - position.y) >= NODE_POSITION_GAP
  ));
  if (isOpen(target)) return target;

  const baseAngle = stableAngle(id);
  for (let attempt = 0; attempt < POSITION_ATTEMPTS; attempt += 1) {
    const ring = Math.floor(attempt / POSITIONS_PER_RING);
    const distance = NODE_POSITION_GAP + ring * 24;
    const angle = baseAngle + attempt * GOLDEN_ANGLE;
    const candidate = {
      x: target.x + Math.cos(angle) * distance,
      y: target.y + Math.sin(angle) * distance,
    };
    if (isOpen(candidate)) return candidate;
  }

  const distance = NODE_POSITION_GAP * Math.max(2, occupied.length);
  return {
    x: target.x + Math.cos(baseAngle) * distance,
    y: target.y + Math.sin(baseAngle) * distance,
  };
}

function createLayoutGroup(key: string, members: LayoutMember[]): LayoutGroup {
  const stored = members.flatMap((member) => member.stored ? [member.stored] : []);
  if (stored.length === 0) return { key, members, meanX: null, meanY: null };
  return {
    key,
    members,
    meanX: stored.reduce((sum, point) => sum + point.x, 0) / stored.length,
    meanY: stored.reduce((sum, point) => sum + point.y, 0) / stored.length,
  };
}

/**
 * Turns stored semantic clusters and PCA coordinates into stable visual islands.
 * The calculation always uses the complete graph so filters never rescale nodes.
 */
function buildInitialLayout(data: KnowledgeGraph): Map<string, LayoutPoint> {
  if (data.nodes.length === 0) return new Map();

  const members: LayoutMember[] = data.nodes.map((node) => ({
    node,
    stored: readStoredLayout(node),
  }));
  const storedCount = members.reduce((count, member) => count + Number(member.stored != null), 0);
  if (storedCount / members.length < MIN_STORED_LAYOUT_COVERAGE) return new Map();

  const grouped = new Map<string, LayoutMember[]>();
  for (const member of members) {
    const key = member.node.communityId == null
      ? 'unassigned'
      : `community:${member.node.communityId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), member]);
  }

  const groups = Array.from(grouped, ([key, groupMembers]) => createLayoutGroup(key, groupMembers))
    .sort((left, right) => {
      if (left.meanY == null && right.meanY != null) return 1;
      if (left.meanY != null && right.meanY == null) return -1;
      if (left.meanY !== right.meanY) return (left.meanY ?? 0) - (right.meanY ?? 0);
      if (left.meanX !== right.meanX) return (left.meanX ?? 0) - (right.meanX ?? 0);
      return left.key.localeCompare(right.key);
    });

  const columns = Math.max(1, Math.ceil(Math.sqrt(groups.length)));
  const rows = Math.ceil(groups.length / columns);
  const positions = new Map<string, LayoutPoint>();

  groups.forEach((group, groupIndex) => {
    const column = groupIndex % columns;
    const row = Math.floor(groupIndex / columns);
    const center = {
      x: (column - (columns - 1) / 2) * COMMUNITY_SPACING_X,
      y: (row - (rows - 1) / 2) * COMMUNITY_SPACING_Y,
    };
    const storedMembers = group.members.filter((member) => member.stored != null);
    const meanX = group.meanX ?? 0;
    const meanY = group.meanY ?? 0;
    const maxDelta = storedMembers.reduce((maximum, member) => Math.max(
      maximum,
      Math.abs(member.stored!.x - meanX),
      Math.abs(member.stored!.y - meanY),
    ), 0);
    const scale = maxDelta > 0 ? COMMUNITY_RADIUS / maxDelta : 1;
    const occupied: LayoutPoint[] = [];

    [...group.members]
      .sort((left, right) => left.node.id.localeCompare(right.node.id))
      .forEach((member) => {
        const target = member.stored
          ? {
              x: center.x + (member.stored.x - meanX) * scale,
              y: center.y + (member.stored.y - meanY) * scale,
            }
          : center;
        const position = findOpenLayoutPosition(member.node.id, target, occupied);
        occupied.push(position);
        positions.set(member.node.id, position);
      });
  });

  return positions;
}

function detectCommunities(data: KnowledgeGraph, visibleNodeIds: Set<string>): { memberships: Map<string, number>; count: number } {
  const hasServerCommunities = data.nodes.some((node) => node.communityId != null && visibleNodeIds.has(node.id));
  if (hasServerCommunities) {
    const memberships = new Map<string, number>();
    let maxCommunityId = -1;
    for (const node of data.nodes) {
      if (!visibleNodeIds.has(node.id) || node.communityId == null) continue;
      memberships.set(node.id, node.communityId);
      maxCommunityId = Math.max(maxCommunityId, node.communityId);
    }
    return { memberships, count: maxCommunityId + 1 };
  }

  const adjacency = new Map<string, Set<string>>();
  for (const id of visibleNodeIds) adjacency.set(id, new Set());

  for (const edge of data.edges) {
    if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) continue;
    if (!COMMUNITY_EDGE_TYPES.has(edge.edgeType)) continue;
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }

  const memberships = new Map<string, number>();
  const visited = new Set<string>();
  let communityId = 0;

  for (const id of visibleNodeIds) {
    if (visited.has(id) || (adjacency.get(id)?.size ?? 0) === 0) continue;
    const stack = [id];
    const component: string[] = [];
    visited.add(id);

    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }

    if (component.length > 1) {
      for (const nodeId of component) memberships.set(nodeId, communityId);
      communityId += 1;
    }
  }

  return { memberships, count: communityId };
}

function buildCommunityInfo(
  graph: KnowledgeGraph,
  visibleNodeIds: Set<string>,
  communityMemberships: Map<string, number>,
  mode: ThemeMode,
): CommunityInfo[] {
  const infoMap = new Map<number, { nodeCount: number; typeCounts: Map<string, number> }>();

  communityMemberships.forEach((communityId, nodeId) => {
    if (!visibleNodeIds.has(nodeId)) return;
    const node = graph.nodeById.get(nodeId);
    if (!node) return;
    if (!infoMap.has(communityId)) infoMap.set(communityId, { nodeCount: 0, typeCounts: new Map() });
    const info = infoMap.get(communityId)!;
    info.nodeCount += 1;
    info.typeCounts.set(node.nodeType, (info.typeCounts.get(node.nodeType) ?? 0) + 1);
  });

  const communities: CommunityInfo[] = [];
  infoMap.forEach((info, communityId) => {
    let dominantType = 'other';
    let maxCount = 0;
    info.typeCounts.forEach((count, type) => {
      if (count > maxCount) {
        dominantType = type;
        maxCount = count;
      }
    });
    communities.push({
      id: communityId,
      color: getCommunityColor(communityId, mode),
      nodeCount: info.nodeCount,
      dominantType,
    });
  });

  return communities.sort((a, b) => b.nodeCount - a.nodeCount);
}

export function okmKnowledgeGraphToG6(
  data: KnowledgeGraph,
  visibleNodeIds: Set<string>,
  mode: ThemeMode = 'dark',
): BuildResult {
  const visibleNodes = data.nodes.filter((node) => visibleNodeIds.has(node.id));
  const initialLayout = buildInitialLayout(data);

  const communityResult = detectCommunities(data, visibleNodeIds);
  const communityMemberships = communityResult.memberships;
  const communityCount = communityResult.count > 1 ? communityResult.count : 0;

  const nodes = visibleNodes.map((node) => {
    const communityId = communityMemberships.get(node.id);
    const typeColor = node.displayColor || getTypeColor(node.nodeType);
    const color = communityCount > 0 && communityId != null ? getCommunityColor(communityId, mode) : typeColor;
    const borderColor = lightenForBorder(color);
    const size = getNodeSize(node.nodeType, node.nodeLayer);
    const initialPosition = initialLayout.get(node.id);

    return {
      id: node.id,
      data: {
        label: node.name,
        nodeType: node.nodeType,
        nodeLayer: node.nodeLayer,
        degree: node.degree,
        community: communityId ?? -1,
      },
      style: {
        size,
        fill: color,
        stroke: borderColor,
        lineWidth: node.nodeLayer === 'backbone' ? 2.4 : 1.6,
        label: true,
        labelText: node.name,
        labelFill: mode === 'light' ? '#1a1a2e' : '#e4e4ed',
        labelFontFamily: 'PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif',
        labelFontSize: node.nodeLayer === 'backbone' ? 14 : 13,
        labelFontWeight: node.nodeLayer === 'backbone' ? 600 : 500,
        labelPlacement: 'right' as const,
        labelOffsetX: 10,
        halo: node.nodeLayer === 'backbone',
        haloStroke: color,
        haloStrokeOpacity: mode === 'light' ? 0.18 : 0.24,
        haloLineWidth: 10,
        ...(initialPosition ?? {}),
      },
    };
  });

  const edgePairs: G6EdgePair[] = [];
  const edges = data.edges
    .filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to))
    .map((edge) => {
      const visual = resolveEdgeVisual(edge.edgeType);
      const edgeColor = edge.displayColor || visual.stroke;
      edgePairs.push({ id: edge.id, source: edge.from, target: edge.to });
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        data: {
          edgeType: edge.edgeType,
          edgeLayer: edge.edgeLayer,
          category: edge.displayCategory || edge.displayLabel || visual.category,
        },
        style: {
          stroke: edgeColor,
          strokeOpacity: edge.edgeLayer === 'backbone' ? 0.62 : 0.38,
          lineWidth: edge.edgeLayer === 'backbone' ? 1.5 : 1,
          lineDash: visual.dashArray ? visual.dashArray.split(' ').map(Number) : undefined,
          endArrow: true,
          endArrowSize: 6,
          label: false,
        },
      };
    });

  return {
    data: { nodes, edges },
    communityCount,
    communities: buildCommunityInfo(data, visibleNodeIds, communityMemberships, mode),
    communityMap: communityMemberships,
    nodeIds: visibleNodes.map((node) => node.id),
    edgePairs,
  };
}
