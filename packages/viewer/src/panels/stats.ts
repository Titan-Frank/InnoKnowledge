import type { AppState } from '../state.js';
import type { DomElements } from '../types/dom-elements.js';
import { NODE_LAYER_LABELS } from '../types/constants.js';
import { getVisibleNodes, getSearchMatches } from '../graph/visibility.js';
import { isBackboneNode, isSupportNode, getTypeLabel, humanizeKey } from '../graph/layout.js';

export function renderStats(state: AppState, els: DomElements): void {
  const visibleNodes = getVisibleNodes(state);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdgeCount = state.data!.edges.filter(
    (edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to),
  ).length;
  const visibleBackboneCount = visibleNodes.filter((node) => isBackboneNode(node)).length;
  const visibleSupportCount = visibleNodes.filter((node) => isSupportNode(node)).length;
  const stats: Array<[string, number]> = [
    ['节点数', visibleNodeIds.size],
    ['主干', visibleBackboneCount],
    ['支撑', visibleSupportCount],
    ['关系数', visibleEdgeCount],
  ];
  els.statsGrid.innerHTML = '';
  stats.forEach(([label, value]) => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
    els.statsGrid.appendChild(card);
  });
}

export function renderSearchResults(
  state: AppState,
  els: DomElements,
  selectNode: (id: string, recenter?: boolean) => void,
): void {
  const allMatches = getSearchMatches(state);
  const matches = allMatches.slice(0, 60);
  els.searchCount.textContent =
    allMatches.length > matches.length
      ? `前 ${matches.length} / ${allMatches.length} 项`
      : `${allMatches.length} 项`;
  els.searchResults.innerHTML = '';

  if (matches.length === 0) {
    els.searchResults.innerHTML = `
      <div class="empty-state">
        <p>当前筛选下没有匹配结果，可以放宽类型筛选或切换来源范围。</p>
      </div>
    `;
    return;
  }

  matches.forEach((node) => {
    const item = document.createElement('button');
    item.className = `result-item ${state.selectedNodeId === node.id ? 'active' : ''}`;
    item.innerHTML = `
      <strong>${node.name}</strong>
      <span>${NODE_LAYER_LABELS[node.node_layer] ?? humanizeKey(node.node_layer)} · ${getTypeLabel(node.node_type)} · ${node.id}</span>
    `;
    item.addEventListener('click', () => selectNode(node.id, true));
    els.searchResults.appendChild(item);
  });
}
