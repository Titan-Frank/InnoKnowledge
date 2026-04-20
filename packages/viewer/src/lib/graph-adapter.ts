import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import type { KnowledgeGraph, OKMNode, ThemeMode } from '@/core/graph/types';
import { isBackboneNode } from '@/core/graph/knowledge-data';
import { resolveEdgeVisual } from './edge-styles';
import { TYPE_META, getCommunityColor, COMMUNITY_EDGE_TYPES } from './constants';
import { lightenForBorder } from './utils';

export interface SigmaNodeAttributes {
  label: string;
  color: string;
  borderColor: string;
  size: number;
  x: number;
  y: number;
  nodeType: string;
  nodeLayer: string;
  degree: number;
  mass: number;
  collisionRadius: number;
  community?: number;
  communityColor?: string;
  hidden?: boolean;
}

export interface SigmaEdgeAttributes {
  edgeType: string;
  edgeColor: string;
  edgeCategory: string;
  hidden?: boolean;
}

export interface CommunityInfo {
  id: number;
  color: string;
  nodeCount: number;
  dominantType: string;
}

export interface BuildResult {
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>;
  communityCount: number;
  communities: CommunityInfo[];
  communityMap: Map<string, number>;
}

const NODE_SIZE_MAP: Record<string, number> = {
  concept: 10, principle: 9, process: 7, substance: 6, entity: 6,
  experiment: 5, activity: 5, method: 4.5, representation: 4, symbol: 4,
  skill: 4, question: 3.5, event: 3.5, issue: 3.5, other: 3.5,
};

const NODE_COLLISION_PADDING = 10;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function getNodeMass(nodeType: string, nodeLayer: string | null | undefined, nodeCount: number): number {
  const massMultiplier = nodeCount > 5000 ? 2 : nodeCount > 1000 ? 1.5 : 1;
  if (nodeLayer === 'backbone') {
    switch (nodeType) {
      case 'concept': return 5 * massMultiplier;
      case 'principle': return 4 * massMultiplier;
      case 'process': return 3 * massMultiplier;
      default: return 2 * massMultiplier;
    }
  }
  switch (nodeType) {
    case 'substance':
    case 'entity': return 2 * massMultiplier;
    case 'experiment':
    case 'activity': return 1.5 * massMultiplier;
    case 'method': return 1.5 * massMultiplier;
    default: return 1 * massMultiplier;
  }
}

function getCollisionRadius(nodeType: string, nodeLayer: string | null | undefined): number {
  const size = NODE_SIZE_MAP[nodeType] ?? NODE_SIZE_MAP.other;
  const layerBoost = nodeLayer === 'backbone' ? 1.6 : 1.4;
  return size * layerBoost + NODE_COLLISION_PADDING;
}

function getRingSlot(index: number): { ring: number; slot: number; slotsInRing: number } {
  let ring = 1;
  let remaining = index;
  while (remaining >= ring * 6) {
    remaining -= ring * 6;
    ring += 1;
  }
  return { ring, slot: remaining, slotsInRing: Math.max(ring * 6, 1) };
}

function getTypeColor(type: string): string {
  return TYPE_META[type]?.color ?? TYPE_META.other.color;
}

function runCommunityDetection(graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>): { memberships: Map<string, number>; count: number } {
  const communityGraph = new Graph({ type: 'undirected', allowSelfLoops: false });
  graph.forEachNode((node) => { communityGraph.addNode(node); });
  graph.forEachEdge((_edge, attrs, source, target) => {
    const edgeType = attrs.edgeType as string;
    if (COMMUNITY_EDGE_TYPES.has(edgeType)) {
      if (!communityGraph.hasEdge(source, target)) {
        try { communityGraph.addEdge(source, target); } catch { /* skip dupes */ }
      }
    }
  });

  if (communityGraph.size === 0) return { memberships: new Map(), count: 0 };

  const isolated: string[] = [];
  communityGraph.forEachNode((node) => {
    if (communityGraph.degree(node) === 0) isolated.push(node);
  });
  isolated.forEach((n) => communityGraph.dropNode(n));

  if (communityGraph.order === 0) return { memberships: new Map(), count: 0 };

  const result = louvain.detailed(communityGraph);
  const memberships = new Map<string, number>();
  for (const [nodeId, communityId] of Object.entries(result.communities)) {
    memberships.set(nodeId, communityId);
  }
  return { memberships, count: result.count };
}

export function okmKnowledgeGraphToGraphology(
  data: KnowledgeGraph,
  visibleNodeIds: Set<string>,
  mode: ThemeMode = 'dark',
): BuildResult {
  const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>({ multi: false, type: 'directed' });

  const backboneNodes: OKMNode[] = [];
  const supportNodes: OKMNode[] = [];
  const parentMap = new Map<string, string>();

  for (const node of data.nodes) {
    if (!visibleNodeIds.has(node.id)) continue;
    if (isBackboneNode(node)) backboneNodes.push(node);
    else supportNodes.push(node);
  }

  const nodeCount = visibleNodeIds.size;

  for (const supportNode of supportNodes) {
    for (const edge of data.edges) {
      if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) continue;
      if (!edge.backboneExpand) continue;
      let parentId: string | null = null;
      if (edge.from === supportNode.id && isBackboneNode(data.nodeById.get(edge.to))) {
        parentId = edge.to;
      } else if (edge.to === supportNode.id && isBackboneNode(data.nodeById.get(edge.from))) {
        parentId = edge.from;
      }
      if (parentId) {
        parentMap.set(supportNode.id, parentId);
        break;
      }
    }
  }

  const maxBackboneRadius = backboneNodes.reduce((largest, node) =>
    Math.max(largest, getCollisionRadius(node.nodeType, node.nodeLayer)), 0);
  const backboneSpread = Math.sqrt(Math.max(backboneNodes.length, 1)) * (150 + maxBackboneRadius * 3);

  // Position backbone nodes
  backboneNodes.forEach((node, i) => {
    const angle = i * GOLDEN_ANGLE;
    const r = backboneSpread * Math.sqrt((i + 1) / Math.max(backboneNodes.length, 1));
    const jitter = backboneSpread * 0.1;
    const x = r * Math.cos(angle) + (Math.random() - 0.5) * jitter;
    const y = r * Math.sin(angle) + (Math.random() - 0.5) * jitter;

    const size = NODE_SIZE_MAP[node.nodeType] ?? NODE_SIZE_MAP.other;
    const color = getTypeColor(node.nodeType);
    const mass = getNodeMass(node.nodeType, node.nodeLayer, nodeCount);
    const collisionRadius = getCollisionRadius(node.nodeType, node.nodeLayer);
    const borderColor = lightenForBorder(color);

    graph.addNode(node.id, {
      label: node.name, color, borderColor, size, x, y,
      nodeType: node.nodeType, nodeLayer: node.nodeLayer,
      degree: node.degree, mass, collisionRadius,
    });
  });

  // Position support nodes
  const parentChildCount = new Map<string, number>();
  const childJitter = Math.max(8, Math.sqrt(nodeCount) * 1.5);

  supportNodes.forEach((node, supportIndex) => {
    const parentId = parentMap.get(node.id);
    const size = NODE_SIZE_MAP[node.nodeType] ?? NODE_SIZE_MAP.other;
    const color = getTypeColor(node.nodeType);
    const mass = getNodeMass(node.nodeType, node.nodeLayer, nodeCount);
    const collisionRadius = getCollisionRadius(node.nodeType, node.nodeLayer);

    let x: number, y: number;
    if (parentId && graph.hasNode(parentId)) {
      const parentAttrs = graph.getNodeAttributes(parentId);
      const count = parentChildCount.get(parentId) ?? 0;
      parentChildCount.set(parentId, count + 1);
      const { ring, slot, slotsInRing } = getRingSlot(count);
      const parentCollisionRadius = (parentAttrs.collisionRadius) || 20;
      const ringSpacing = collisionRadius * 2 + 18;
      const childAngle = (slot / slotsInRing) * Math.PI * 2 + ring * 0.35;
      const childR = parentCollisionRadius + collisionRadius + 18 + (ring - 1) * ringSpacing;
      x = parentAttrs.x + Math.cos(childAngle) * childR + (Math.random() - 0.5) * childJitter;
      y = parentAttrs.y + Math.sin(childAngle) * childR + (Math.random() - 0.5) * childJitter;
    } else {
      const fallbackIndex = backboneNodes.length + supportIndex;
      const angle = fallbackIndex * GOLDEN_ANGLE;
      const r = backboneSpread * 1.7 + collisionRadius * 2 + (fallbackIndex % 7) * (collisionRadius + 16);
      x = r * Math.cos(angle) + (Math.random() - 0.5) * childJitter;
      y = r * Math.sin(angle) + (Math.random() - 0.5) * childJitter;
    }

    const borderColor = lightenForBorder(color);
    graph.addNode(node.id, {
      label: node.name, color, borderColor, size, x, y,
      nodeType: node.nodeType, nodeLayer: node.nodeLayer,
      degree: node.degree, mass, collisionRadius,
    });
  });

  // Add edges
  for (const edge of data.edges) {
    if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) continue;
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue;
    const visual = resolveEdgeVisual(edge.edgeType);
    try {
      graph.addEdgeWithKey(edge.id, edge.from, edge.to, {
        edgeType: edge.edgeType, edgeColor: visual.stroke, edgeCategory: visual.category,
      });
    } catch { /* skip duplicate edges or self-loops */ }
  }

  // Community detection + coloring
  const hasServerCommunities = data.nodes.some(
    (n) => n.communityId != null && visibleNodeIds.has(n.id),
  );

  let communityMemberships: Map<string, number>;
  let communityCount: number;

  if (hasServerCommunities) {
    communityMemberships = new Map<string, number>();
    let maxCommunityId = -1;
    for (const node of data.nodes) {
      if (!visibleNodeIds.has(node.id)) continue;
      if (node.communityId != null) {
        communityMemberships.set(node.id, node.communityId);
        maxCommunityId = Math.max(maxCommunityId, node.communityId);
      }
    }
    communityCount = maxCommunityId + 1;
  } else {
    const result = runCommunityDetection(graph);
    communityMemberships = result.memberships;
    communityCount = result.count;
  }

  if (communityCount > 1) {
    const avgCollisionRadius = 35;
    const clusterSpread = Math.sqrt(nodeCount) * avgCollisionRadius * 0.8;
    const communityIds = [...new Set(communityMemberships.values())].sort((a, b) => a - b);

    const clusterMemberCount = new Map<number, number>();
    communityMemberships.forEach((commId) => {
      clusterMemberCount.set(commId, (clusterMemberCount.get(commId) ?? 0) + 1);
    });

    const clusterCenters = new Map<number, { x: number; y: number }>();
    communityIds.forEach((commId, idx) => {
      const angle = idx * GOLDEN_ANGLE;
      const radius = clusterSpread * Math.sqrt((idx + 1) / communityCount);
      clusterCenters.set(commId, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    });

    const clusterNodeIndex = new Map<number, number>();
    communityIds.forEach((commId) => clusterNodeIndex.set(commId, 0));

    graph.forEachNode((node) => {
      const communityIndex = communityMemberships.get(node);
      if (communityIndex !== undefined) {
        const communityColor = getCommunityColor(communityIndex, mode);
        graph.setNodeAttribute(node, 'community', communityIndex);
        graph.setNodeAttribute(node, 'communityColor', communityColor);
        graph.setNodeAttribute(node, 'color', communityColor);
        graph.setNodeAttribute(node, 'borderColor', lightenForBorder(communityColor));

        const center = clusterCenters.get(communityIndex);
        if (center) {
          const idx = clusterNodeIndex.get(communityIndex) ?? 0;
          clusterNodeIndex.set(communityIndex, idx + 1);
          const membersInCluster = Math.max(clusterMemberCount.get(communityIndex) ?? 5, 5);
          const localAngle = idx * GOLDEN_ANGLE;
          const spacing = avgCollisionRadius * 1.2;
          const localR = Math.sqrt((idx + 1) / membersInCluster) * Math.sqrt(membersInCluster) * spacing;
          graph.setNodeAttribute(node, 'x', center.x + Math.cos(localAngle) * localR);
          graph.setNodeAttribute(node, 'y', center.y + Math.sin(localAngle) * localR);
        }
      } else {
        graph.setNodeAttribute(node, 'community', -1);
      }
    });
  } else {
    graph.forEachNode((node) => {
      graph.setNodeAttribute(node, 'community', -1);
    });
  }

  // Build CommunityInfo
  const communityInfoMap = new Map<number, { nodeCount: number; typeCounts: Map<string, number> }>();
  communityMemberships.forEach((commId, nodeId) => {
    if (!communityInfoMap.has(commId)) {
      communityInfoMap.set(commId, { nodeCount: 0, typeCounts: new Map() });
    }
    const info = communityInfoMap.get(commId)!;
    info.nodeCount++;
    const nodeType = graph.getNodeAttribute(nodeId, 'nodeType') as string;
    info.typeCounts.set(nodeType, (info.typeCounts.get(nodeType) || 0) + 1);
  });

  const communities: CommunityInfo[] = [];
  communityInfoMap.forEach((info, commId) => {
    let maxCount = 0;
    let dominantType = 'other';
    info.typeCounts.forEach((count, type) => {
      if (count > maxCount) { maxCount = count; dominantType = type; }
    });
    communities.push({ id: commId, color: getCommunityColor(commId, mode), nodeCount: info.nodeCount, dominantType });
  });
  communities.sort((a, b) => b.nodeCount - a.nodeCount);

  return {
    graph,
    communityCount: communityCount > 1 ? communityCount : 0,
    communities,
    communityMap: communityMemberships,
  };
}
