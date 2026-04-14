import Graph from 'graphology';
import type { GraphData, GraphNode } from '../store/types.js';
import { getTypeColor, isBackboneNode } from './layout.js';
import { resolveEdgeVisual } from './graphPresentation.js';

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

// Node mass for ForceAtlas2 — higher mass = more repulsion, pushes nodes apart
// Backbone types get much higher mass so they spread out and pull neighbors with them
function getNodeMass(nodeType: string, nodeLayer: string | null | undefined, nodeCount: number): number {
  const massMultiplier = nodeCount > 5000 ? 2 : nodeCount > 1000 ? 1.5 : 1;

  // Backbone nodes are heavy anchors
  if (nodeLayer === 'backbone') {
    switch (nodeType) {
      case 'concept': return 20 * massMultiplier;
      case 'principle': return 15 * massMultiplier;
      case 'process': return 10 * massMultiplier;
      default: return 8 * massMultiplier;
    }
  }

  // Support nodes are lighter — they orbit around their backbone parents
  switch (nodeType) {
    case 'substance':
    case 'entity': return 4 * massMultiplier;
    case 'experiment':
    case 'activity': return 3 * massMultiplier;
    case 'method': return 3 * massMultiplier;
    default: return 2 * massMultiplier;
  }
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function buildGraphologyGraph(
  data: GraphData,
  visibleNodeIds: Set<string>,
): Graph {
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

  // Build parent map: find nearest backbone neighbor for each support node
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

  // Wide spread for backbone nodes — sqrt scaling prevents compression on larger graphs
  // Much larger spread gives FA2 room to work with
  const backboneSpread = Math.sqrt(Math.max(backboneNodes.length, 1)) * 120;

  // Position backbone nodes with golden-angle spiral + sqrt radius (even spread)
  backboneNodes.forEach((node, i) => {
    const angle = i * GOLDEN_ANGLE;
    // sqrt(i+1) prevents early nodes from clustering at center
    const r = backboneSpread * Math.sqrt((i + 1) / Math.max(backboneNodes.length, 1));
    // Small jitter breaks perfect symmetry
    const jitter = backboneSpread * 0.1;
    const x = r * Math.cos(angle) + (Math.random() - 0.5) * jitter;
    const y = r * Math.sin(angle) + (Math.random() - 0.5) * jitter;

    const size = NODE_SIZE_MAP[node.node_type] ?? NODE_SIZE_MAP.other;
    const color = getTypeColor(node.node_type);
    const mass = getNodeMass(node.node_type, node.node_layer, nodeCount);

    // Border color: brighter version of fill for visibility against overlapping nodes
    const borderColor = lightenForBorder(color);

    graph.addNode(node.id, {
      label: node.name,
      color,
      borderColor,
      size,
      x,
      y,
      nodeType: node.node_type,
      nodeLayer: node.node_layer,
      degree: node.degree,
      mass,
    });
  });

  // Position support nodes near their backbone parent with tight jitter
  // This is key: support nodes start close to their parent so FA2 keeps them clustered
  const parentChildCount = new Map<string, number>();
  const childJitter = Math.sqrt(nodeCount) * 3;

  supportNodes.forEach((node) => {
    const parentId = parentMap.get(node.id);
    const size = NODE_SIZE_MAP[node.node_type] ?? NODE_SIZE_MAP.other;
    const color = getTypeColor(node.node_type);
    const mass = getNodeMass(node.node_type, node.node_layer, nodeCount);

    let x: number, y: number;
    if (parentId && graph.hasNode(parentId)) {
      const parentAttrs = graph.getNodeAttributes(parentId);
      const count = parentChildCount.get(parentId) ?? 0;
      parentChildCount.set(parentId, count + 1);
      // Tight spread around parent
      const childAngle = count * GOLDEN_ANGLE;
      const childR = 20 + count * 8;
      x = parentAttrs.x + Math.cos(childAngle) * childR + (Math.random() - 0.5) * childJitter;
      y = parentAttrs.y + Math.sin(childAngle) * childR + (Math.random() - 0.5) * childJitter;
    } else {
      // No parent — place in outer ring
      const fallbackIndex = backboneNodes.length + supportNodes.indexOf(node);
      const angle = fallbackIndex * GOLDEN_ANGLE;
      const r = backboneSpread * 1.5 + (fallbackIndex % 5) * 30;
      x = r * Math.cos(angle) + (Math.random() - 0.5) * childJitter;
      y = r * Math.sin(angle) + (Math.random() - 0.5) * childJitter;
    }

    const borderColor = lightenForBorder(color);

    graph.addNode(node.id, {
      label: node.name,
      color,
      borderColor,
      size,
      x,
      y,
      nodeType: node.node_type,
      nodeLayer: node.node_layer,
      degree: node.degree,
      mass,
    });
  });

  // Add edges with colored attributes
  for (const edge of data.edges) {
    if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) continue;
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue;

    const visual = resolveEdgeVisual(edge.edge_type);
    try {
      graph.addEdgeWithKey(edge.id, edge.from, edge.to, {
        edgeType: edge.edge_type,
        edgeColor: visual.stroke,
        edgeCategory: visual.category,
      });
    } catch {
      // Skip duplicate edges or self-loops
    }
  }

  return graph;
}

/** Lighten a hex color for a visible border — pushes channels toward white */
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
