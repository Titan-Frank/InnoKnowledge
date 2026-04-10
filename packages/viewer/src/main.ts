import './styles.css';

import type { SourceConfig } from './state.js';
import type { MetaResponse, BundleResponse } from '@okm/types';
import { createInitialState } from './state.js';
import { getDomElements } from './types/dom-elements.js';
import { API_BASE } from './types/constants.js';
import { loadMeta, loadBundle } from './api.js';
import { prepareGraphData, escapeHtml } from './graph/layout.js';
import { syncSelectionWithVisibility, resolveExpandedBackboneNodeId } from './graph/visibility.js';
import { startSimulation } from './graph/simulation.js';
import { onPointerDown, onPointerMove, onPointerUp, onWheel } from './graph/interaction.js';
import { draw } from './render/canvas.js';
import { initializeViewport, resizeCanvas, centerOnNode } from './render/viewport.js';
import { renderControls } from './panels/sidebar.js';
import { renderStats, renderSearchResults } from './panels/stats.js';
import { renderDetail } from './panels/detail.js';

const state = createInitialState();
const els = getDomElements();

boot().catch((error) => {
  console.error(error);
  const detail = escapeHtml(error?.message || '未知错误');
  els.detailEmpty.innerHTML = `
    <p class="eyebrow">Load Error</p>
    <h2>数据加载失败</h2>
    <p>${detail}</p>
    <p>请确认本地 SQLite API 服务已经启动，并检查数据库里是否已有可用 dataset。</p>
  `;
});

async function boot() {
  const meta = await loadMeta();
  state.manifest = (meta as unknown as Record<string, unknown>).manifest as Record<string, unknown> | null || {};
  state.sourceConfigs = resolveApiSourceConfigs(meta);
  state.selectedSourceKey = resolveInitialSourceKey(meta);
  bindEvents();
  renderSourceControl();
  await switchSource(state.selectedSourceKey!);
  startSimulation(state, () => draw(state, els.canvas));
}

function resolveApiSourceConfigs(meta: MetaResponse): Map<string, SourceConfig> {
  const configs = new Map<string, SourceConfig>();
  const sources = Array.isArray(meta?.sources) ? meta.sources : [];

  sources.forEach((source) => {
    const key = source?.key;
    if (!key) return;
    configs.set(key, {
      key,
      label: source.label || key.toUpperCase(),
      description: source.description || '',
      books: (source.books || []).map((b: { book_id: string }) => ({ book_id: b.book_id })),
      hasProfiles: Boolean(source.has_profiles),
      autoDiscovered: false,
      bundlePath: `${API_BASE}/source/${encodeURIComponent(key)}/bundle`,
      nodeCardPath: `${API_BASE}/source/${encodeURIComponent(key)}/node-card`,
    });
  });

  if (configs.size === 0) {
    throw new Error('SQLite API 没有返回任何可用数据集。');
  }

  return new Map(
    Array.from(configs.entries()).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function resolveInitialSourceKey(meta: MetaResponse): string {
  const params = new URLSearchParams(window.location.search);
  const requestedKey = params.get('source');
  if (requestedKey && state.sourceConfigs.has(requestedKey)) return requestedKey;

  if (meta.active_source && state.sourceConfigs.has(meta.active_source)) {
    return meta.active_source;
  }

  return state.sourceConfigs.keys().next().value!;
}

function updateSourceQuery(sourceKey: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('source', sourceKey);
  window.history.replaceState({}, '', url);
}

async function switchSource(sourceKey: string): Promise<void> {
  const source = state.sourceConfigs.get(sourceKey);
  if (!source) return;

  ++state.sourceRequestId;
  state.selectedSourceKey = sourceKey;
  state.sourceLoading = true;
  state.cardCache = new Map();
  state.selectedNodeId = null;
  state.hoverNodeId = null;
  state.expandedBackboneNodeId = null;
  renderSourceControl();

  let data;
  try {
    data = await loadBundle(sourceKey);
  } catch (error) {
    data = {
      nodes: [], edges: [], profiles: [],
      framework: { domains: [] }, patterns: { patterns: [] },
      books: [], loadWarnings: [(error as Error)?.message || '数据源读取失败'],
      source: {} as BundleResponse['source'],
    } as BundleResponse;
  }

  state.sourceLoading = false;
  state.data = prepareGraphData({
    ...data,
    manifest: state.manifest,
    source: { ...source, ...(data.source || {}) } as Record<string, unknown> & { nodeCardPath?: string },
  });
  state.visibleNodesCache = { key: null, nodes: [] };
  state.selectedBook = 'all';
  state.selectedTypes = new Set(state.data.availableTypes);
  initializeViewport(state, els);
  renderAllControls();
  renderStats(state, els);
  renderSearchResults(state, els, selectNode);
  renderDetail(state, els, getCallbacks());
  draw(state, els.canvas);
  updateSourceQuery(sourceKey);
}

function renderSourceControl(): void {
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
  if (source.hasProfiles) info.push('含 profiles');
  if (warnings.length > 0) info.push(`警告：${warnings[0]}`);
  els.sourceHint.textContent = info.join(' | ');
}

function renderAllControls(): void {
  renderControls(state, els, getCallbacks());
}

function getCallbacks() {
  return {
    selectNode,
    draw: () => draw(state, els.canvas),
    renderStats: () => renderStats(state, els),
    renderSearchResults: () => renderSearchResults(state, els, selectNode),
    renderDetail: () => renderDetail(state, els, getCallbacks()),
    renderControls: renderAllControls,
  };
}

function selectNode(nodeId: string, recenter = false): void {
  state.selectedNodeId = nodeId;
  state.expandedBackboneNodeId = resolveExpandedBackboneNodeId(nodeId, state);
  syncSelectionWithVisibility(state);
  renderAllControls();
  renderStats(state, els);
  renderSearchResults(state, els, selectNode);
  renderDetail(state, els, getCallbacks());
  if (recenter) centerOnNode(nodeId, state, els.canvas);
  draw(state, els.canvas);
}

function bindEvents(): void {
  window.addEventListener('resize', () => {
    resizeCanvas(els);
    draw(state, els.canvas);
  });

  els.sourceSelect.addEventListener('change', (event) => {
    switchSource((event.target as HTMLSelectElement).value);
  });

  els.collapseSupport.addEventListener('click', () => {
    const expandedRootId = state.expandedBackboneNodeId;
    state.expandedBackboneNodeId = null;
    if (state.selectedNodeId) {
      const selectedNode = state.data?.nodeById.get(state.selectedNodeId);
      if (selectedNode && selectedNode.node_layer === 'support') {
        state.selectedNodeId = expandedRootId || null;
      }
    }
    syncSelectionWithVisibility(state);
    renderAllControls();
    renderStats(state, els);
    renderSearchResults(state, els, selectNode);
    renderDetail(state, els, getCallbacks());
    draw(state, els.canvas);
  });

  els.searchInput.addEventListener('input', (event) => {
    state.searchTerm = (event.target as HTMLInputElement).value.trim().toLowerCase();
    renderSearchResults(state, els, selectNode);
    draw(state, els.canvas);
  });

  els.fitView.addEventListener('click', () => {
    initializeViewport(state, els);
    draw(state, els.canvas);
  });

  els.toggleLabels.addEventListener('click', () => {
    state.showLabels = !state.showLabels;
    renderAllControls();
    draw(state, els.canvas);
  });

  els.resetTypes.addEventListener('click', () => {
    state.selectedTypes = new Set(state.data?.availableTypes || []);
    syncSelectionWithVisibility(state);
    renderAllControls();
    renderStats(state, els);
    renderSearchResults(state, els, selectNode);
    renderDetail(state, els, getCallbacks());
    draw(state, els.canvas);
  });

  els.focusConnected.addEventListener('change', (event) => {
    state.focusConnected = (event.target as HTMLInputElement).checked;
    syncSelectionWithVisibility(state);
    renderStats(state, els);
    renderSearchResults(state, els, selectNode);
    renderDetail(state, els, getCallbacks());
    draw(state, els.canvas);
  });

  els.canvas.addEventListener('pointerdown', (event) =>
    onPointerDown(event, state, els, selectNode),
  );
  els.canvas.addEventListener('pointermove', (event) =>
    onPointerMove(event, state, els, () => draw(state, els.canvas)),
  );
  els.canvas.addEventListener('pointerup', (event) =>
    onPointerUp(event, state, els),
  );
  els.canvas.addEventListener('pointerleave', (event) =>
    onPointerUp(event, state, els),
  );
  els.canvas.addEventListener('wheel', (event) =>
    onWheel(event, state, () => draw(state, els.canvas)),
  );
}
