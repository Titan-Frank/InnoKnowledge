import type { AppState, GraphNode, GraphEdge } from '../state.js';
import { getVisibleNodes, getVisibleEdges } from '../graph/visibility.js';
import { isSupportNode } from '../graph/layout.js';

export function draw(state: AppState, canvas: HTMLCanvasElement): void {
  if (!state.data) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(state.transform.x / dpr, state.transform.y / dpr);
  ctx.scale(state.transform.scale, state.transform.scale);

  const visibleNodes = getVisibleNodes(state);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = getVisibleEdges(visibleNodeIds, state);

  drawEdges(visibleEdges, state, ctx);
  drawNodes(visibleNodes, state, ctx);

  ctx.restore();
}

function drawEdges(edges: GraphEdge[], state: AppState, ctx: CanvasRenderingContext2D): void {
  edges.forEach((edge) => {
    const selected = state.selectedNodeId != null && (edge.from === state.selectedNodeId || edge.to === state.selectedNodeId);
    const supportEdge = edge.edge_layer === 'support';
    ctx.beginPath();
    ctx.setLineDash(supportEdge ? [5, 5] : []);
    ctx.moveTo(edge.source.x, edge.source.y);
    ctx.lineTo(edge.target.x, edge.target.y);
    ctx.strokeStyle = selected
      ? supportEdge
        ? 'rgba(158, 79, 43, 0.42)'
        : 'rgba(158, 79, 43, 0.58)'
      : supportEdge
        ? 'rgba(82, 62, 45, 0.11)'
        : 'rgba(82, 62, 45, 0.18)';
    ctx.lineWidth = selected ? 2.2 : supportEdge ? 0.95 : 1.15;
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

function drawNodes(nodes: GraphNode[], state: AppState, ctx: CanvasRenderingContext2D): void {
  nodes.forEach((node) => {
    const hovered = state.hoverNodeId === node.id;
    const selected = state.selectedNodeId === node.id;
    const searchMatched =
      state.searchTerm &&
      [node.id, node.name, node.description, ...(node.aliases || [])]
        .join(' ')
        .toLowerCase()
        .includes(state.searchTerm);

    const radius = node.radius * (selected ? 1.25 : hovered ? 1.12 : 1);
    const supportNode = isSupportNode(node);
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = supportNode ? `${node.color}CC` : node.color;
    ctx.fill();
    ctx.lineWidth = selected ? 4 : hovered || searchMatched ? 3 : 1.6;
    ctx.strokeStyle =
      selected
        ? supportNode
          ? 'rgba(255, 243, 229, 0.85)'
          : 'rgba(250, 247, 241, 0.95)'
        : hovered || searchMatched
          ? 'rgba(255, 245, 235, 0.85)'
          : supportNode
            ? 'rgba(255, 248, 239, 0.34)'
            : 'rgba(255, 248, 239, 0.48)';
    ctx.stroke();

    if (!state.showLabels && !selected && !hovered) return;
    if (state.transform.scale < 0.65 && !selected && !hovered) return;

    ctx.font = selected ? '600 14px "Avenir Next"' : '500 12px "Avenir Next"';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(40, 29, 20, 0.95)';
    ctx.fillText(node.name, node.x, node.y + radius + 16);
  });
}
