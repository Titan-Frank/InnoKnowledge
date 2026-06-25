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
  concept: 26, principle: 24, process: 21, substance: 20, entity: 20,
  experiment: 18, activity: 18, method: 18, representation: 17, symbol: 17,
  skill: 17, question: 16, event: 16, issue: 16, other: 16,
};

function getNodeSize(nodeType: string, nodeLayer: string | null | undefined): number {
  const base = NODE_SIZE_MAP[nodeType] ?? NODE_SIZE_MAP.other;
  return nodeLayer === 'backbone' ? base * 1.18 : base;
}

function getTypeColor(type: string): string {
  return TYPE_META[type]?.color ?? TYPE_META.other.color;
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

  const communityResult = detectCommunities(data, visibleNodeIds);
  const communityMemberships = communityResult.memberships;
  const communityCount = communityResult.count > 1 ? communityResult.count : 0;

  const nodes = visibleNodes.map((node) => {
    const communityId = communityMemberships.get(node.id);
    const typeColor = getTypeColor(node.nodeType);
    const color = communityCount > 0 && communityId != null ? getCommunityColor(communityId, mode) : typeColor;
    const borderColor = lightenForBorder(color);
    const size = getNodeSize(node.nodeType, node.nodeLayer);

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
      },
    };
  });

  const edgePairs: G6EdgePair[] = [];
  const edges = data.edges
    .filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to))
    .map((edge) => {
      const visual = resolveEdgeVisual(edge.edgeType);
      edgePairs.push({ id: edge.id, source: edge.from, target: edge.to });
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        data: {
          edgeType: edge.edgeType,
          edgeLayer: edge.edgeLayer,
          category: visual.category,
        },
        style: {
          stroke: visual.stroke,
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
