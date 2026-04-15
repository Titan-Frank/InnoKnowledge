import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import type { GraphData, GraphNode } from '../store/types.js';
import { getTypeColor, isBackboneNode } from './layout.js';
import { resolveEdgeVisual } from './graphPresentation.js';
import { getCommunityColor, COMMUNITY_EDGE_TYPES } from '../constants/index.js';
import { useGraphStore } from '../store/graphStore.js';

// Node sizes — backbone nodes visually dominate
const NODE_SIZE_MAP: Record<string, number> = {
  concept: 16,
  principle: 14,
  process: 11,
  substance: 9,
  entity: 9,
  experiment: 8,
  activity: 8,
  method: 7,
  representation: 6,
  symbol: 6,
  skill: 6,
  question: 5,
  event: 5,
  issue: 5,
  other: 5,
};

const NODE_COLLISION_PADDING = 8;

// Node mass for ForceAtlas2 — higher mass = more repulsion, pushes nodes apart
function getNodeMass(nodeType: string, nodeLayer: string | null | undefined, nodeCount: number): number {
  const massMultiplier = nodeCount > 5000 ? 2 : nodeCount > 1000 ? 1.5 : 1;

  if (nodeLayer === 'backbone') {
    switch (nodeType) {
      case 'concept': return 20 * massMultiplier;
      case 'principle': return 15 * massMultiplier;
      case 'process': return 10 * massMultiplier;
      default: return 8 * massMultiplier;
    }
  }

  switch (nodeType) {
    case 'substance':
    case 'entity': return 4 * massMultiplier;
    case 'experiment':
    case 'activity': return 3 * massMultiplier;
    case 'method': return 3 * massMultiplier;
    default: return 2 * massMultiplier;
  }
}

function getCollisionRadius(nodeType: string, nodeLayer: string | null | undefined): number {
  const size = NODE_SIZE_MAP[nodeType] ?? NODE_SIZE_MAP.other;
  const layerBoost = nodeLayer === 'backbone' ? 1.35 : 1.15;
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

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// ── Community detection ──

export interface CommunityInfo {
  id: number;
  color: string;
  nodeCount: number;
  dominantType: string;
}

export interface BuildResult {
  graph: Graph;
  communityCount: number;
  communities: CommunityInfo[];
  communityMap: Map<string, number>;
}

function runCommunityDetection(graph: Graph): { memberships: Map<string, number>; count: number } {
  // Build an undirected subgraph with only association edges
  const communityGraph = new Graph({ type: 'undirected', allowSelfLoops: false });

  graph.forEachNode((node) => {
    communityGraph.addNode(node);
  });

  graph.forEachEdge((_edge, attrs, source, target) => {
    const edgeType = attrs.edgeType as string;
    if (COMMUNITY_EDGE_TYPES.has(edgeType)) {
      if (!communityGraph.hasEdge(source, target)) {
        try { communityGraph.addEdge(source, target); } catch { /* skip dupes */ }
      }
    }
  });

  if (communityGraph.size === 0) {
    return { memberships: new Map(), count: 0 };
  }

  // Remove isolated nodes — they add noise to community detection
  const isolated: string[] = [];
  communityGraph.forEachNode((node) => {
    if (communityGraph.degree(node) === 0) isolated.push(node);
  });
  isolated.forEach((n) => communityGraph.dropNode(n));

  if (communityGraph.order === 0) {
    return { memberships: new Map(), count: 0 };
  }

  const result = louvain.detailed(communityGraph);
  const memberships = new Map<string, number>();
  for (const [nodeId, communityId] of Object.entries(result.communities)) {
    memberships.set(nodeId, communityId);
  }

  return { memberships, count: result.count };
}

// ── Main builder ──

export function buildGraphologyGraph(
  data: GraphData,
  visibleNodeIds: Set<string>,
): BuildResult {
  const mode = useGraphStore.getState().themeMode;
  const graph = new Graph({ multi: false, type: 'directed' });

  const backboneNodes: GraphNode[] = [];
  const supportNodes: GraphNode[] = [];
  const parentMap = new Map<string, string>();

  for (const node of data.nodes) {
    if (!visibleNodeIds.has(node.id)) continue;
    if (isBackboneNode(node)) {
      backboneNodes.push(node);
    } else {
      supportNodes.push(node);
    }
  }

  const nodeCount = visibleNodeIds.size;

  // Build parent map
  for (const supportNode of supportNodes) {
    for (const edge of data.edges) {
      if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) continue;
      if (!edge.backbone_expand) continue;
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

  const maxBackboneRadius = backboneNodes.reduce((largest, node) => {
    return Math.max(largest, getCollisionRadius(node.node_type, node.node_layer));
  }, 0);
  const backboneSpread = Math.sqrt(Math.max(backboneNodes.length, 1)) * (150 + maxBackboneRadius * 3);

  // Position backbone nodes
  backboneNodes.forEach((node, i) => {
    const angle = i * GOLDEN_ANGLE;
    const r = backboneSpread * Math.sqrt((i + 1) / Math.max(backboneNodes.length, 1));
    const jitter = backboneSpread * 0.1;
    const x = r * Math.cos(angle) + (Math.random() - 0.5) * jitter;
    const y = r * Math.sin(angle) + (Math.random() - 0.5) * jitter;

    const size = NODE_SIZE_MAP[node.node_type] ?? NODE_SIZE_MAP.other;
    const color = getTypeColor(node.node_type);
    const mass = getNodeMass(node.node_type, node.node_layer, nodeCount);
    const collisionRadius = getCollisionRadius(node.node_type, node.node_layer);
    const borderColor = lightenForBorder(color);

    graph.addNode(node.id, {
      label: node.name, color, borderColor, size, x, y,
      nodeType: node.node_type, nodeLayer: node.node_layer,
      degree: node.degree, mass, collisionRadius,
    });
  });

  // Position support nodes near parent
  const parentChildCount = new Map<string, number>();
  const childJitter = Math.max(8, Math.sqrt(nodeCount) * 1.5);

  supportNodes.forEach((node, supportIndex) => {
    const parentId = parentMap.get(node.id);
    const size = NODE_SIZE_MAP[node.node_type] ?? NODE_SIZE_MAP.other;
    const color = getTypeColor(node.node_type);
    const mass = getNodeMass(node.node_type, node.node_layer, nodeCount);
    const collisionRadius = getCollisionRadius(node.node_type, node.node_layer);

    let x: number, y: number;
    if (parentId && graph.hasNode(parentId)) {
      const parentAttrs = graph.getNodeAttributes(parentId);
      const count = parentChildCount.get(parentId) ?? 0;
      parentChildCount.set(parentId, count + 1);
      const { ring, slot, slotsInRing } = getRingSlot(count);
      const parentCollisionRadius = (parentAttrs.collisionRadius as number) || 20;
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
      nodeType: node.node_type, nodeLayer: node.node_layer,
      degree: node.degree, mass, collisionRadius,
    });
  });

  // Add edges
  for (const edge of data.edges) {
    if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) continue;
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue;
    const visual = resolveEdgeVisual(edge.edge_type);
    try {
      graph.addEdgeWithKey(edge.id, edge.from, edge.to, {
        edgeType: edge.edge_type, edgeColor: visual.stroke, edgeCategory: visual.category,
      });
    } catch { /* skip duplicate edges or self-loops */ }
  }

  // ── Community detection + cluster positioning ──
  const { memberships: communityMemberships, count: communityCount } = runCommunityDetection(graph);

  if (communityCount > 1) {
    // Compute cluster centers using golden-angle spiral
    const clusterCenters = new Map<number, { x: number; y: number }>();
    const clusterSpread = backboneSpread * 0.9;
    const communityIds = [...new Set(communityMemberships.values())].sort((a, b) => a - b);
    communityIds.forEach((commId, idx) => {
      const angle = idx * GOLDEN_ANGLE;
      const radius = clusterSpread * Math.sqrt((idx + 1) / communityCount);
      clusterCenters.set(commId, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      });
    });

    const clusterJitter = Math.max(8, Math.sqrt(nodeCount) * 1.5);

    // Apply community attributes and reposition
    graph.forEachNode((node, attrs) => {
      const communityIndex = communityMemberships.get(node);
      if (communityIndex !== undefined) {
        const communityColor = getCommunityColor(communityIndex, mode);
        graph.setNodeAttribute(node, 'community', communityIndex);
        graph.setNodeAttribute(node, 'communityColor', communityColor);
        graph.setNodeAttribute(node, 'color', communityColor);
        graph.setNodeAttribute(node, 'borderColor', lightenForBorder(communityColor));

        // Reposition: blend 60% toward cluster center, keep 40% original + jitter
        const center = clusterCenters.get(communityIndex);
        if (center) {
          const currentX = attrs.x as number;
          const currentY = attrs.y as number;
          graph.setNodeAttribute(node, 'x', center.x * 0.6 + currentX * 0.4 + (Math.random() - 0.5) * clusterJitter);
          graph.setNodeAttribute(node, 'y', center.y * 0.6 + currentY * 0.4 + (Math.random() - 0.5) * clusterJitter);
        }
      } else {
        graph.setNodeAttribute(node, 'community', -1);
      }
    });
  } else {
    // No meaningful communities — all nodes keep type-based colors
    graph.forEachNode((node) => {
      graph.setNodeAttribute(node, 'community', -1);
    });
  }

  // Build CommunityInfo for UI
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
    communities.push({
      id: commId,
      color: getCommunityColor(commId, mode),
      nodeCount: info.nodeCount,
      dominantType,
    });
  });
  communities.sort((a, b) => b.nodeCount - a.nodeCount);

  return { graph, communityCount: communityCount > 1 ? communityCount : 0, communities, communityMap: communityMemberships };
}

/** Lighten a hex color for a visible border */
function lightenForBorder(hex: string): string {
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) {
    const match = hex.match(/(\d+)/g);
    if (match && match.length >= 3) {
      const r = Math.min(255, +match[0] + 80);
      const g = Math.min(255, +match[1] + 80);
      const b = Math.min(255, +match[2] + 80);
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
  }
  const cleaned = hex.replace('#', '');
  const full = cleaned.length === 3
    ? cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2] : cleaned;
  const r = Math.min(255, parseInt(full.substring(0, 2), 16) + 80);
  const g = Math.min(255, parseInt(full.substring(2, 4), 16) + 80);
  const b = Math.min(255, parseInt(full.substring(4, 6), 16) + 80);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
