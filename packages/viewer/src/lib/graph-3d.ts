import type { GraphData, LinkObject, NodeObject } from 'react-force-graph-3d';
import type { BuildResult } from './graph-adapter';

export interface Graph3DNode {
  id: string;
  label: string;
  nodeType: string;
  nodeLayer: string;
  degree: number;
  visibleDegree: number;
  color: string;
  size: number;
}

export interface Graph3DLink {
  id: string;
  source: string | NodeObject<Graph3DNode>;
  target: string | NodeObject<Graph3DNode>;
  label: string;
  color: string;
  width: number;
  arrowLength: number;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? value as UnknownRecord : {};
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function buildGraph3DData(build: BuildResult): GraphData<Graph3DNode, Graph3DLink> {
  const visibleDegreeByNode = new Map<string, number>();
  for (const edge of build.edgePairs) {
    visibleDegreeByNode.set(edge.source, (visibleDegreeByNode.get(edge.source) ?? 0) + 1);
    visibleDegreeByNode.set(edge.target, (visibleDegreeByNode.get(edge.target) ?? 0) + 1);
  }
  const nodes: Array<NodeObject<Graph3DNode>> = (build.data.nodes ?? []).map((node) => {
    const data = asRecord(node.data);
    const style = asRecord(node.style);
    const id = String(node.id ?? '');
    return {
      id,
      label: asString(data.label, id),
      nodeType: asString(data.nodeType, 'other'),
      nodeLayer: asString(data.nodeLayer, 'support'),
      degree: asNumber(data.degree, 0),
      visibleDegree: visibleDegreeByNode.get(id) ?? 0,
      color: asString(style.fill, '#9a9ab0'),
      size: Math.max(12, asNumber(style.size, 16)),
    };
  });

  const links: Array<LinkObject<Graph3DNode, Graph3DLink>> = (build.data.edges ?? []).map((edge) => {
    const data = asRecord(edge.data);
    const style = asRecord(edge.style);
    const id = String(edge.id ?? '');
    const width = Math.max(0.65, asNumber(style.lineWidth, 1));
    return {
      id,
      source: String(edge.source ?? ''),
      target: String(edge.target ?? ''),
      label: asString(data.category, asString(data.edgeType, '关系')),
      color: asString(style.stroke, '#64748b'),
      width,
      arrowLength: style.endArrow === false ? 0 : width > 1 ? 3.4 : 2.4,
    };
  });

  return { nodes, links };
}

export function resolveGraph3DLabelIds(
  nodes: Array<NodeObject<Graph3DNode>>,
  showLabels: boolean,
  selectedNodeId: string | null,
  searchHitIds: Set<string>,
  previewNodeId: string | null,
  limit = 48,
): Set<string> {
  if (!showLabels) return new Set();

  const labels = new Set<string>();
  if (selectedNodeId) labels.add(selectedNodeId);
  if (previewNodeId) labels.add(previewNodeId);
  for (const id of searchHitIds) labels.add(id);

  const ranked = [...nodes].sort((left, right) => {
    const layerDelta = Number(right.nodeLayer === 'backbone') - Number(left.nodeLayer === 'backbone');
    if (layerDelta !== 0) return layerDelta;
    return right.visibleDegree - left.visibleDegree || right.degree - left.degree || right.size - left.size || String(left.id).localeCompare(String(right.id));
  });

  for (const node of ranked) {
    if (labels.size >= limit) break;
    labels.add(String(node.id));
  }
  return labels;
}

export function escapeGraphTooltip(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
