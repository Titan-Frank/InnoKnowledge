import type { GraphData } from '@antv/g6';
import type { SemanticNeighbor } from '@okm/types';
import type { KnowledgeGraph, ThemeMode } from '@/core/graph/types';
import { resolveEdgeLabel, resolveEdgeVisual } from './edge-styles';
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
  communitySource: 'embedding' | 'topology';
}

const NODE_SIZE_MAP: Record<string, number> = {
  concept: 20, rule: 19, process: 17, entity: 16, property: 15,
  method: 15, representation: 14, resource: 13, event: 13,
  substance: 16, experiment: 15, symbol: 14, other: 13,
};

function getNodeSize(nodeType: string, nodeLayer: string | null | undefined): number {
  const base = NODE_SIZE_MAP[nodeType] ?? NODE_SIZE_MAP.other;
  return nodeLayer === 'backbone' ? base * 1.15 : base;
}

function resolveOverviewLabelIds(
  nodes: KnowledgeGraph['nodes'],
  communityMemberships: Map<string, number>,
): Set<string> {
  if (nodes.length <= 36) return new Set(nodes.map((node) => node.id));

  const limit = Math.min(42, Math.max(18, Math.round(Math.sqrt(nodes.length) * 2.5)));
  const ranked = [...nodes].sort((left, right) => (
    Number(right.nodeLayer === 'backbone') - Number(left.nodeLayer === 'backbone')
    || right.degree - left.degree
    || left.id.localeCompare(right.id)
  ));
  const labelIds = new Set<string>();
  const representedCommunities = new Set<number>();

  for (const node of ranked) {
    const communityId = communityMemberships.get(node.id);
    if (communityId == null || representedCommunities.has(communityId)) continue;
    labelIds.add(node.id);
    representedCommunities.add(communityId);
  }
  for (const node of ranked) {
    if (labelIds.size >= limit) break;
    labelIds.add(node.id);
  }
  return labelIds;
}

function getTypeColor(type: string): string {
  return TYPE_META[type]?.color ?? TYPE_META.other.color;
}

function detectCommunities(data: KnowledgeGraph, visibleNodeIds: Set<string>): {
  memberships: Map<string, number>;
  count: number;
  source: 'embedding' | 'topology';
} {
  const hasServerCommunities = data.nodes.some((node) => node.communityId != null && visibleNodeIds.has(node.id));
  if (hasServerCommunities) {
    const memberships = new Map<string, number>();
    let maxCommunityId = -1;
    for (const node of data.nodes) {
      if (!visibleNodeIds.has(node.id) || node.communityId == null) continue;
      memberships.set(node.id, node.communityId);
      maxCommunityId = Math.max(maxCommunityId, node.communityId);
    }
    return { memberships, count: maxCommunityId + 1, source: 'embedding' };
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

  return { memberships, count: communityId, source: 'topology' };
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
  const overviewLabelIds = resolveOverviewLabelIds(visibleNodes, communityMemberships);

  const nodes = visibleNodes.map((node) => {
    const communityId = communityMemberships.get(node.id);
    const typeColor = node.displayColor || getTypeColor(node.nodeType);
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
        lineWidth: node.nodeLayer === 'backbone' ? 2 : 1.35,
        label: overviewLabelIds.has(node.id),
        labelText: node.name,
        labelFill: mode === 'light' ? '#1a1a2e' : '#e4e4ed',
        labelFontFamily: 'PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif',
        labelFontSize: node.nodeLayer === 'backbone' ? 12 : 11,
        labelFontWeight: node.nodeLayer === 'backbone' ? 600 : 500,
        labelPlacement: 'right' as const,
        labelOffsetX: 7,
        halo: node.nodeLayer === 'backbone',
        haloStroke: color,
        haloStrokeOpacity: mode === 'light' ? 0.18 : 0.24,
        haloLineWidth: 7,
      },
    };
  });

  const edgePairs: G6EdgePair[] = [];
  const edges = data.edges
    .filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to))
    .map((edge) => {
      const visual = resolveEdgeVisual(edge.edgeType);
      const edgeColor = edge.displayColor || visual.stroke;
      const edgeLabel = resolveEdgeLabel(edge.edgeType, edge.displayLabel);
      edgePairs.push({ id: edge.id, source: edge.from, target: edge.to });
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        data: {
          edgeType: edge.edgeType,
          edgeLayer: edge.edgeLayer,
          label: edgeLabel,
          category: edge.displayCategory || visual.category,
        },
        style: {
          stroke: edgeColor,
          strokeOpacity: edge.edgeLayer === 'backbone' ? 0.62 : 0.38,
          lineWidth: edge.edgeLayer === 'backbone' ? 1.5 : 1,
          lineDash: visual.dashArray ? visual.dashArray.split(' ').map(Number) : undefined,
          endArrow: true,
          endArrowSize: 6,
          label: false,
          labelText: edgeLabel,
          labelFill: mode === 'light' ? '#334155' : '#e2e8f0',
          labelFontFamily: 'PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif',
          labelFontSize: 11,
          labelFontWeight: 500,
          labelPlacement: 'center' as const,
          labelBackground: true,
          labelBackgroundFill: mode === 'light' ? '#ffffff' : '#171a21',
          labelBackgroundOpacity: mode === 'light' ? 0.92 : 0.9,
          labelBackgroundStroke: edgeColor,
          labelBackgroundStrokeOpacity: 0.42,
          labelBackgroundLineWidth: 1,
          labelBackgroundRadius: 4,
          labelBackgroundPadding: [3, 6, 3, 6],
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
    communitySource: communityResult.source,
  };
}

export interface RadialFocusResult extends BuildResult {
  formalNeighborIds: string[];
  semanticNeighborIds: string[];
}

const MAX_FORMAL_NEIGHBORS = 18;

export function buildRadialFocusGraph(
  graph: KnowledgeGraph,
  centerNodeId: string,
  semanticNeighbors: SemanticNeighbor[],
  allowedNodeIds: Set<string>,
  mode: ThemeMode = 'dark',
): RadialFocusResult {
  const formalEdges = graph.edges
    .filter((edge) => {
      if (edge.from !== centerNodeId && edge.to !== centerNodeId) return false;
      const neighborId = edge.from === centerNodeId ? edge.to : edge.from;
      return allowedNodeIds.has(neighborId);
    })
    .sort((left, right) => {
      const layerOrder = Number(right.edgeLayer === 'backbone') - Number(left.edgeLayer === 'backbone');
      if (layerOrder !== 0) return layerOrder;
      const leftNeighbor = graph.nodeById.get(left.from === centerNodeId ? left.to : left.from);
      const rightNeighbor = graph.nodeById.get(right.from === centerNodeId ? right.to : right.from);
      return (rightNeighbor?.degree ?? 0) - (leftNeighbor?.degree ?? 0) || left.id.localeCompare(right.id);
    });

  const formalNeighborIds: string[] = [];
  const includedFormalEdges = [];
  const seenFormal = new Set<string>();
  for (const edge of formalEdges) {
    const neighborId = edge.from === centerNodeId ? edge.to : edge.from;
    if (!graph.nodeById.has(neighborId)) continue;
    if (!seenFormal.has(neighborId)) {
      if (seenFormal.size >= MAX_FORMAL_NEIGHBORS) continue;
      seenFormal.add(neighborId);
      formalNeighborIds.push(neighborId);
    }
    includedFormalEdges.push(edge);
  }

  const semanticNeighborIds = semanticNeighbors
    .map((neighbor) => neighbor.node_id)
    .filter((nodeId) => (
      nodeId !== centerNodeId &&
      allowedNodeIds.has(nodeId) &&
      graph.nodeById.has(nodeId) &&
      !seenFormal.has(nodeId)
    ));
  const visibleNodeIds = new Set([centerNodeId, ...formalNeighborIds, ...semanticNeighborIds]);
  const result = okmKnowledgeGraphToG6(graph, visibleNodeIds, mode);
  const includedEdgeIds = new Set(includedFormalEdges.map((edge) => edge.id));
  const formalG6Edges = (result.data.edges ?? []).filter((edge) => includedEdgeIds.has(String(edge.id)));
  const similarityById = new Map(semanticNeighbors.map((neighbor) => [neighbor.node_id, neighbor.similarity]));
  const semanticEdges = semanticNeighborIds.map((nodeId) => ({
    id: `semantic:${centerNodeId}:${nodeId}`,
    source: centerNodeId,
    target: nodeId,
    data: {
      edgeType: 'semantic_similarity',
      edgeLayer: 'semantic',
      label: '内容语义相似',
      category: '内容语义相似',
      similarity: similarityById.get(nodeId) ?? null,
    },
    style: {
      stroke: mode === 'light' ? '#64748b' : '#94a3b8',
      strokeOpacity: 0.5,
      lineWidth: 1.2,
      lineDash: [5, 5],
      endArrow: false,
      label: false,
      labelText: '内容语义相似',
      labelFill: mode === 'light' ? '#475569' : '#cbd5e1',
      labelFontFamily: 'PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif',
      labelFontSize: 11,
      labelFontWeight: 500,
      labelPlacement: 'center' as const,
      labelBackground: true,
      labelBackgroundFill: mode === 'light' ? '#ffffff' : '#171a21',
      labelBackgroundOpacity: mode === 'light' ? 0.92 : 0.9,
      labelBackgroundStroke: mode === 'light' ? '#94a3b8' : '#64748b',
      labelBackgroundStrokeOpacity: 0.42,
      labelBackgroundLineWidth: 1,
      labelBackgroundRadius: 4,
      labelBackgroundPadding: [3, 6, 3, 6],
    },
  }));

  return {
    ...result,
    data: { nodes: result.data.nodes, edges: [...formalG6Edges, ...semanticEdges] },
    edgePairs: [
      ...result.edgePairs.filter((edge) => includedEdgeIds.has(edge.id)),
      ...semanticNeighborIds.map((nodeId) => ({
        id: `semantic:${centerNodeId}:${nodeId}`,
        source: centerNodeId,
        target: nodeId,
      })),
    ],
    formalNeighborIds,
    semanticNeighborIds,
  };
}
