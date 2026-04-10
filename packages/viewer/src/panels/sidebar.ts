import type { AppState } from '../state.js';
import type { DomElements } from '../types/dom-elements.js';
import { LAYER_MODE_OPTIONS } from '../types/constants.js';
import { escapeHtml, getTypeColor, getTypeLabel } from '../graph/layout.js';
import {
  getVisibleNodes, syncSelectionWithVisibility,
  resolveExpandedBackboneNodeId,
} from '../graph/visibility.js';

export function renderControls(state: AppState, els: DomElements, callbacks: {
  selectNode: (id: string, recenter?: boolean) => void;
  draw: () => void;
  renderStats: () => void;
  renderSearchResults: () => void;
  renderDetail: () => void;
  renderControls: () => void;
}): void {
  renderSourceControl(state, els);
  renderLayerModeControl(state, els, callbacks);
  renderTypeFilter(state, els, callbacks);
  renderBookFilter(state, els, callbacks);
  renderLegend(state, els);
  renderToolbarActions(state, els);
}

function renderSourceControl(state: AppState, els: DomElements): void {
  const sources = Array.from(state.sourceConfigs.values());
  if (sources.length === 0) return;

  els.sourceSelect.innerHTML = sources
    .map((source) =>
      `<option value="${escapeHtml(source.key)}">${escapeHtml(source.label)}</option>`,
    )
    .join('');
  els.sourceSelect.value = state.selectedSourceKey || sources[0].key;
  els.sourceSelect.disabled = state.sourceLoading;

  const source = state.sourceConfigs.get(state.selectedSourceKey!) || sources[0];
  const warnings = state.data?.loadWarnings || [];
  els.sourceNote.textContent = state.sourceLoading ? '切换中' : source.label;

  const info: string[] = [];
  if (source.description) info.push(source.description);
  if (source.autoDiscovered) info.push('自动发现');
  if (source.hasProfiles) info.push('含 profiles');
  if (warnings.length > 0) info.push(`警告：${warnings[0]}`);
  els.sourceHint.textContent = info.join(' | ');
}

function renderLayerModeControl(state: AppState, els: DomElements, callbacks: {
  selectNode: (id: string, recenter?: boolean) => void;
  draw: () => void;
  renderStats: () => void;
  renderSearchResults: () => void;
  renderDetail: () => void;
  renderControls: () => void;
}): void {
  els.layerMode.innerHTML = '';
  LAYER_MODE_OPTIONS.forEach((option) => {
    const button = document.createElement('button');
    button.className = `segment ${state.layerMode === option.id ? 'active' : ''}`;
    button.textContent = option.label;
    button.addEventListener('click', () => {
      state.layerMode = option.id;
      if (option.id === 'all') {
        state.expandedBackboneNodeId = null;
      } else {
        state.expandedBackboneNodeId = resolveExpandedBackboneNodeId(state.selectedNodeId, state);
      }
      syncSelectionWithVisibility(state);
      callbacks.renderControls();
      callbacks.renderStats();
      callbacks.renderSearchResults();
      callbacks.renderDetail();
      callbacks.draw();
    });
    els.layerMode.appendChild(button);
  });

  const expandedNode =
    state.expandedBackboneNodeId && state.data?.nodeById.get(state.expandedBackboneNodeId);
  els.layerNote.textContent =
    state.layerMode === 'all' ? '全部可见' : expandedNode ? `已展开 ${expandedNode.name}` : '主干优先';

  const activeMode = LAYER_MODE_OPTIONS.find((option) => option.id === state.layerMode);
  const hints = [activeMode?.description];
  if (state.layerMode === 'backbone-expand') {
    hints.push(expandedNode ? `当前展开主干: ${expandedNode.name}` : '点一个主干节点，就会把它的一跳支撑节点展开出来。');
  }
  els.layerHint.textContent = hints.filter(Boolean).join(' | ');
  els.collapseSupport.classList.toggle(
    'hidden',
    !(state.layerMode === 'backbone-expand' && expandedNode),
  );
}

function renderTypeFilter(state: AppState, els: DomElements, callbacks: {
  selectNode: (id: string, recenter?: boolean) => void;
  draw: () => void;
  renderStats: () => void;
  renderSearchResults: () => void;
  renderDetail: () => void;
}): void {
  els.typeFilter.innerHTML = '';
  const scopedNodes = getVisibleNodes(state, { ignoreTypeFilter: true });
  const countsByType = new Map<string, number>();
  scopedNodes.forEach((node) => {
    countsByType.set(node.node_type, (countsByType.get(node.node_type) || 0) + 1);
  });

  (state.data?.availableTypes || []).forEach((type) => {
    const label = getTypeLabel(type);
    const count = countsByType.get(type) || 0;
    const button = document.createElement('button');
    button.className = `chip ${state.selectedTypes.has(type) ? 'active' : ''}`;
    button.innerHTML = `${label} <span class="section-note">${count}</span>`;
    button.classList.toggle('empty', count === 0);
    button.addEventListener('click', () => {
      if (state.selectedTypes.has(type)) {
        state.selectedTypes.delete(type);
      } else {
        state.selectedTypes.add(type);
      }
      syncSelectionWithVisibility(state);
      renderTypeFilter(state, els, callbacks);
      callbacks.renderStats();
      callbacks.renderSearchResults();
      callbacks.renderDetail();
      callbacks.draw();
    });
    els.typeFilter.appendChild(button);
  });
}

function renderBookFilter(state: AppState, els: DomElements, callbacks: {
  selectNode: (id: string, recenter?: boolean) => void;
  draw: () => void;
  renderStats: () => void;
  renderSearchResults: () => void;
  renderDetail: () => void;
}): void {
  const books = ['all', ...state.data!.booksById.keys()];
  els.bookFilter.innerHTML = '';
  books.forEach((bookId) => {
    const button = document.createElement('button');
    const label = bookId === 'all' ? '全部来源' : bookId;
    button.className = `segment ${state.selectedBook === bookId ? 'active' : ''}`;
    button.textContent = label;
    button.addEventListener('click', () => {
      state.selectedBook = bookId;
      syncSelectionWithVisibility(state);
      renderBookFilter(state, els, callbacks);
      callbacks.renderStats();
      callbacks.renderSearchResults();
      callbacks.renderDetail();
      callbacks.draw();
    });
    els.bookFilter.appendChild(button);
  });
}

function renderLegend(state: AppState, els: DomElements): void {
  els.legend.innerHTML = '';
  (state.data?.availableTypes || []).forEach((type) => {
    const label = getTypeLabel(type);
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <span class="legend-dot" style="background:${getTypeColor(type)}"></span>
      <span>${label}</span>
    `;
    els.legend.appendChild(item);
  });
}

function renderToolbarActions(state: AppState, els: DomElements): void {
  els.toggleLabels.textContent = state.showLabels ? '隐藏名称' : '显示名称';
  els.toggleLabels.classList.toggle('active', state.showLabels);
  els.toggleLabels.setAttribute('aria-pressed', String(state.showLabels));
  els.toggleLabels.title = state.showLabels ? '隐藏画布上的节点名称' : '显示画布上的节点名称';
}
