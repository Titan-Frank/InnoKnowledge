const SCORE_FIELDS = ['correctness_1_5', 'evidence_1_5', 'teaching_1_5'];
const SCORE_LABELS = {
  correctness_1_5: '正确性',
  evidence_1_5: '证据支撑性',
  teaching_1_5: '教学可用性',
};
const TASK_LABELS = {
  conceptual_reasoning: '概念推理',
  cross_lesson: '跨课关联',
  definition: '定义理解',
  fact_relation: '事实关系',
  misconception: '误解辨析',
  prerequisite: '先修关系',
};
const ABLATION_LABELS = {
  A0: '完整 OKM',
  A1: '去除证据锚定',
  A2: '去除正文',
  A3: '去除教学画像',
  A4: '对象向量召回',
  A5: '去除关系扩展',
  A6: '原始暂存数据',
  A7: '仅节点骨架',
};

const state = {
  activeView: 'overview',
  experiments: {
    loading: false,
    error: '',
    data: null,
  },
  rows: [],
  scores: new Map(),
  filtered: [],
  currentId: null,
  filters: {
    search: '',
    task: 'all',
    method: 'all',
    status: 'all',
  },
  saveTimer: null,
  saving: false,
  dirty: false,
  debugDetails: new Map(),
  debugLoading: new Set(),
  dashboard: {
    source: 'human',
    loading: false,
    error: '',
    data: null,
  },
};

const els = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindEvents();
  setActiveView(initialView());
  setSaveState('正在加载');
  loadExperiments();
  try {
    const [sheetResponse, scoreResponse] = await Promise.all([
      fetchJson('/api/review-sheet'),
      fetchJson('/api/scores'),
    ]);
    state.rows = sheetResponse.rows || [];
    mergeScores(scoreResponse.scores || []);
    buildFilterOptions();
    state.currentId = state.rows[0]?.review_id || null;
    applyFilters();
    loadDashboard();
    setSaveState('已加载');
  } catch (error) {
    console.error(error);
    setSaveState(`加载失败：${error.message}`, true);
  }
}

function cacheElements() {
  for (const id of [
    'completedCount',
    'totalCount',
    'filteredCount',
    'progressFill',
    'saveState',
    'searchInput',
    'taskFilter',
    'methodFilter',
    'statusFilter',
    'queueList',
    'firstTodoButton',
    'clearFiltersButton',
    'reviewCard',
    'emptyState',
    'assistantScoreBox',
    'debugBox',
    'debugContent',
    'caseMeta',
    'questionText',
    'totalScore',
    'answerText',
    'citationList',
    'claimList',
    'expectedTerms',
    'notesInput',
    'prevButton',
    'nextButton',
    'saveButton',
    'exportButton',
    'importButton',
    'csvImportInput',
    'dashboardSource',
    'dashboardRefreshButton',
    'dashboardStatus',
    'dashboardMetrics',
    'methodChart',
    'taskChart',
    'scoreDistribution',
    'lowScoreList',
    'experimentRefreshButton',
    'experimentStatus',
    'experimentCards',
    'edukuTaskChart',
    'ablationVariantChart',
    'physicsConstructionSummaryTable',
    'experimentFileList',
    'edukuStatus',
    'edukuMetrics',
    'edukuBookChart',
    'edukuTaskDetailChart',
    'edukuRuntimeTable',
    'edukuHeldoutTable',
    'edukuNextInputs',
    'physicsStatus',
    'physicsMetrics',
    'physicsConstructionTable',
    'physicsRuntimeTable',
    'physicsDatabaseChart',
    'physicsExternalTable',
  ]) {
    els[id] = document.getElementById(id);
  }
  els.viewTabs = [...document.querySelectorAll('.view-tab')];
  els.viewJumpButtons = [...document.querySelectorAll('[data-view-jump]')];
  els.overviewView = document.getElementById('overviewView');
  els.edukuView = document.getElementById('edukuView');
  els.physicsView = document.getElementById('physicsView');
  els.reviewView = document.getElementById('reviewView');
  els.topbarActions = document.querySelector('.topbar-actions');
}

function bindEvents() {
  for (const tab of els.viewTabs) {
    tab.addEventListener('click', () => setActiveView(tab.dataset.view || 'overview'));
  }
  for (const button of els.viewJumpButtons) {
    button.addEventListener('click', () => setActiveView(button.dataset.viewJump || 'overview'));
  }
  els.experimentRefreshButton.addEventListener('click', () => loadExperiments());
  els.searchInput.addEventListener('input', () => updateFilter('search', els.searchInput.value));
  els.taskFilter.addEventListener('change', () => updateFilter('task', els.taskFilter.value));
  els.methodFilter.addEventListener('change', () => updateFilter('method', els.methodFilter.value));
  els.statusFilter.addEventListener('change', () => updateFilter('status', els.statusFilter.value));
  els.clearFiltersButton.addEventListener('click', clearFilters);
  els.firstTodoButton.addEventListener('click', goToFirstTodo);
  els.prevButton.addEventListener('click', () => moveBy(-1));
  els.nextButton.addEventListener('click', () => moveBy(1));
  els.saveButton.addEventListener('click', saveNow);
  els.exportButton.addEventListener('click', exportCsv);
  els.importButton.addEventListener('click', () => els.csvImportInput.click());
  els.csvImportInput.addEventListener('change', importCsv);
  els.dashboardSource.addEventListener('change', () => {
    state.dashboard.source = els.dashboardSource.value;
    loadDashboard();
  });
  els.dashboardRefreshButton.addEventListener('click', () => loadDashboard());
  els.notesInput.addEventListener('input', () => {
    const score = currentScore();
    if (!score) return;
    score.notes = els.notesInput.value;
    touchScores();
  });
  document.addEventListener('keydown', handleKeys);
}

function initialView() {
  const view = new URLSearchParams(window.location.search).get('view');
  return ['overview', 'eduku', 'physics', 'review'].includes(view) ? view : 'overview';
}

function setActiveView(view) {
  state.activeView = ['overview', 'eduku', 'physics', 'review'].includes(view) ? view : 'overview';
  els.overviewView.hidden = state.activeView !== 'overview';
  els.edukuView.hidden = state.activeView !== 'eduku';
  els.physicsView.hidden = state.activeView !== 'physics';
  els.reviewView.hidden = state.activeView !== 'review';
  els.topbarActions.hidden = state.activeView !== 'review';
  for (const tab of els.viewTabs) {
    const active = tab.dataset.view === state.activeView;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  const url = new URL(window.location.href);
  url.searchParams.set('view', state.activeView);
  window.history.replaceState({}, '', url);
}

async function loadExperiments() {
  state.experiments.loading = true;
  state.experiments.error = '';
  renderExperiments();
  try {
    state.experiments.data = await fetchJson('/api/experiments');
  } catch (error) {
    console.error(error);
    state.experiments.error = error.message;
  } finally {
    state.experiments.loading = false;
    renderExperiments();
  }
}

function renderExperiments() {
  const { data, loading, error } = state.experiments;
  if (loading && !data) {
    els.experimentStatus.textContent = '正在加载实验结果';
    els.experimentCards.innerHTML = experimentCardSkeleton();
    els.edukuTaskChart.innerHTML = emptyDashboardHtml('正在加载');
    els.ablationVariantChart.innerHTML = emptyDashboardHtml('正在加载');
    els.physicsConstructionSummaryTable.innerHTML = emptyDashboardHtml('正在加载');
    els.experimentFileList.innerHTML = emptyDashboardHtml('正在加载');
    renderEdukuDetails(null, '正在加载');
    renderPhysicsDetails(null, '正在加载');
    return;
  }
  if (error && !data) {
    els.experimentStatus.textContent = `实验结果加载失败：${error}`;
    els.experimentCards.innerHTML = '';
    els.edukuTaskChart.innerHTML = emptyDashboardHtml('暂无数据');
    els.ablationVariantChart.innerHTML = emptyDashboardHtml('暂无数据');
    els.physicsConstructionSummaryTable.innerHTML = emptyDashboardHtml('暂无数据');
    els.experimentFileList.innerHTML = emptyDashboardHtml('暂无数据');
    renderEdukuDetails(null, '暂无数据');
    renderPhysicsDetails(null, '暂无数据');
    return;
  }
  if (!data) return;

  const generated = data.generated_at ? new Date(data.generated_at).toLocaleString() : '-';
  els.experimentStatus.textContent = `已读取 ${data.experiments?.length || 0} 个实验，更新时间：${generated}`;
  els.experimentCards.innerHTML = (data.experiments || []).map(experimentCardHtml).join('');
  bindExperimentCards();
  els.edukuTaskChart.innerHTML = simpleBarListHtml(data.eduku_v02?.dataset_manifest?.runtime_case_count_by_task_type || {}, {
    label: (key) => taskLabel(key),
    unit: '题',
  });
  els.ablationVariantChart.innerHTML = ablationVariantHtml(data.ablation?.summary?.variants || []);
  els.physicsConstructionSummaryTable.innerHTML = physicsConstructionHtml(data.physics_sample?.construction || []);
  els.experimentFileList.innerHTML = fileListHtml(data.files || []);
  renderEdukuDetails(data);
  renderPhysicsDetails(data);
}

function experimentCardSkeleton() {
  return [1, 2, 3].map(() => `
    <article class="experiment-card muted">
      <span>加载中</span>
      <strong>-</strong>
      <p>等待实验结果</p>
    </article>
  `).join('');
}

function experimentCardHtml(experiment) {
  const metrics = Array.isArray(experiment.metrics) ? experiment.metrics : [];
  const targetView = experimentView(experiment.id);
  return `
    <button class="experiment-card" type="button" data-view-target="${escapeAttr(targetView)}">
      <div class="experiment-card-head">
        <span>${escapeHtml(experiment.role || '实验')}</span>
        <strong class="status-pill ${statusClass(experiment.status)}">${escapeHtml(statusLabel(experiment.status))}</strong>
      </div>
      <h3>${escapeHtml(experiment.title || experiment.id || '-')}</h3>
      <p>${escapeHtml(experiment.id || '')}</p>
      <div class="experiment-card-metrics">
        ${metrics.map((metric) => `
          <div>
            <span>${escapeHtml(metric.label || '-')}</span>
            <strong>${escapeHtml(formatMetricValue(metric.value, metric.unit))}</strong>
          </div>
        `).join('')}
      </div>
    </button>
  `;
}

function bindExperimentCards() {
  els.experimentCards.querySelectorAll('[data-view-target]').forEach((card) => {
    card.addEventListener('click', () => setActiveView(card.dataset.viewTarget || 'overview'));
  });
}

function experimentView(experimentId) {
  if (String(experimentId || '').includes('eduku')) return 'eduku';
  if (String(experimentId || '').includes('physics')) return 'physics';
  if (String(experimentId || '').includes('ablation')) return 'review';
  return 'overview';
}

function simpleBarListHtml(counts, config) {
  const entries = Object.entries(counts).filter(([, value]) => Number.isFinite(value));
  if (!entries.length) return emptyDashboardHtml('暂无数据');
  const max = Math.max(...entries.map(([, value]) => value), 1);
  return entries
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
    .map(([key, value]) => {
      const width = Math.max(2, Math.min(100, (value / max) * 100));
      return `
        <div class="bar-row">
          <div class="bar-label">
            <strong>${escapeHtml(config.label(key))}</strong>
            <span>${escapeHtml(key)}</span>
          </div>
          <div class="bar-track" aria-hidden="true"><span style="width: ${width}%"></span></div>
          <strong class="bar-value">${escapeHtml(formatNumber(value))} ${escapeHtml(config.unit || '')}</strong>
        </div>
      `;
    })
    .join('');
}

function ablationVariantHtml(variants) {
  if (!variants.length) return emptyDashboardHtml('暂无消融结果');
  const rows = variants
    .filter((row) => Number.isFinite(row.average_term_coverage))
    .sort((left, right) => right.average_term_coverage - left.average_term_coverage);
  if (!rows.length) return emptyDashboardHtml('暂无可排序指标');
  return rows.map((row) => {
    const width = Math.max(2, Math.min(100, row.average_term_coverage * 100));
    return `
      <div class="bar-row">
        <div class="bar-label">
          <strong>${escapeHtml(row.variant_id || '-')} · ${escapeHtml(variantLabel(row))}</strong>
          <span>召回 ${escapeHtml(formatPercentRatio(row.average_retrieval_recall))}，引用 ${escapeHtml(formatPercentRatio(row.valid_citation_rate))}</span>
        </div>
        <div class="bar-track" aria-hidden="true"><span style="width: ${width}%"></span></div>
        <strong class="bar-value">${escapeHtml(formatPercentRatio(row.average_term_coverage))}</strong>
      </div>
    `;
  }).join('');
}

function physicsConstructionHtml(rows) {
  if (!rows.length) return emptyDashboardHtml('暂无构造结果');
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>方法</th>
          <th>状态</th>
          <th>节点 F1</th>
          <th>关系 F1</th>
          <th>证据命中</th>
          <th>幻觉率</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.method || '-')}</td>
            <td><span class="status-pill ${statusClass(row.status)}">${escapeHtml(statusLabel(row.status))}</span></td>
            <td>${escapeHtml(formatNumber(row.node_f1))}</td>
            <td>${escapeHtml(formatNumber(row.relation_f1))}</td>
            <td>${escapeHtml(formatPercentRatio(row.evidence_hit_rate))}</td>
            <td>${escapeHtml(formatPercentRatio(row.hallucination_rate))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function fileListHtml(files) {
  if (!files.length) return emptyDashboardHtml('暂无文件清单');
  return files.map((file) => `
    <div class="file-row">
      <span class="status-dot ${file.exists ? 'ok' : 'warn'}"></span>
      <code>${escapeHtml(file.path || '-')}</code>
    </div>
  `).join('');
}

function renderEdukuDetails(data, placeholder = '暂无数据') {
  if (!data) {
    els.edukuStatus.textContent = placeholder;
    els.edukuMetrics.innerHTML = '';
    els.edukuBookChart.innerHTML = emptyDashboardHtml(placeholder);
    els.edukuTaskDetailChart.innerHTML = emptyDashboardHtml(placeholder);
    els.edukuRuntimeTable.innerHTML = emptyDashboardHtml(placeholder);
    els.edukuHeldoutTable.innerHTML = emptyDashboardHtml(placeholder);
    els.edukuNextInputs.innerHTML = emptyDashboardHtml(placeholder);
    return;
  }
  const manifest = data.eduku_v02?.dataset_manifest || {};
  const scoring = data.eduku_v02?.scoring_status || {};
  const derived = data.eduku_v02?.derived || {};
  els.edukuStatus.textContent = `${manifest.benchmark_id || 'OKM-EduKU-Bench'}，schema ${manifest.executable_schema || '-'}，契约 ${manifest.public_contract || '-'}`;
  els.edukuMetrics.innerHTML = metricCardsHtml([
    ['运行时问题', formatMetricValue(manifest.runtime_case_count, '题'), '测试集问题数'],
    ['held-out 段落', formatMetricValue(Array.isArray(manifest.heldout_sections) ? manifest.heldout_sections.length : null, '段'), '测试教材片段'],
    ['非空检索率', formatPercentRatio(derived.non_empty_retrieval_rate), 'ApiUnit 候选是否返回'],
    ['平均返回单元', formatNumber(derived.average_retrieved_units), '每题 retrieved_units'],
    ['构造金标准', statusLabel(scoring.construction_summary?.status), '当前状态'],
    ['专家评分', statusLabel(scoring.expert_summary?.status), '盲评输入状态'],
  ]);
  els.edukuBookChart.innerHTML = simpleBarListHtml(manifest.runtime_case_count_by_book || {}, {
    label: (key) => bookTitle(manifest.books || [], key),
    unit: '题',
  });
  els.edukuTaskDetailChart.innerHTML = simpleBarListHtml(manifest.runtime_case_count_by_task_type || {}, {
    label: (key) => taskLabel(key),
    unit: '题',
  });
  els.edukuRuntimeTable.innerHTML = edukuRuntimeTableHtml(scoring.runtime_summary || []);
  els.edukuHeldoutTable.innerHTML = heldoutTableHtml(manifest.heldout_sections || []);
  els.edukuNextInputs.innerHTML = nextInputsHtml(scoring.required_next_inputs || {});
}

function renderPhysicsDetails(data, placeholder = '暂无数据') {
  if (!data) {
    els.physicsStatus.textContent = placeholder;
    els.physicsMetrics.innerHTML = '';
    els.physicsConstructionTable.innerHTML = emptyDashboardHtml(placeholder);
    els.physicsRuntimeTable.innerHTML = emptyDashboardHtml(placeholder);
    els.physicsDatabaseChart.innerHTML = emptyDashboardHtml(placeholder);
    els.physicsExternalTable.innerHTML = emptyDashboardHtml(placeholder);
    return;
  }
  const sample = data.physics_sample || {};
  const benchmark = sample.benchmark || {};
  els.physicsStatus.textContent = `${benchmark.book_id || '物理小样本试验'}，生成时间：${formatDate(sample.generated_at)}`;
  els.physicsMetrics.innerHTML = metricCardsHtml([
    ['段落', formatMetricValue(benchmark.sections, '段'), '开发集节段'],
    ['金标准节点', formatMetricValue(benchmark.gold_nodes, '个'), '人工标注对象'],
    ['金标准关系', formatMetricValue(benchmark.gold_relations, '条'), '人工标注关系'],
    ['运行时问题', formatMetricValue(benchmark.runtime_cases, '题'), '生成评测问题'],
    ['数据库节点', formatMetricValue(sample.database?.nodes, '个'), '当前快照'],
    ['证据记录', formatMetricValue(sample.database?.evidence, '条'), '当前快照'],
  ]);
  els.physicsConstructionTable.innerHTML = physicsConstructionHtml(sample.construction || []);
  els.physicsRuntimeTable.innerHTML = physicsRuntimeTableHtml(sample.runtime || []);
  els.physicsDatabaseChart.innerHTML = simpleBarListHtml(sample.database || {}, {
    label: (key) => databaseLabel(key),
    unit: '',
  });
  els.physicsExternalTable.innerHTML = externalBaselineHtml(sample.external_baselines || {});
}

function metricCardsHtml(rows) {
  return rows.map(([label, value, detail]) => `
    <div class="dashboard-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail || '')}</small>
    </div>
  `).join('');
}

function edukuRuntimeTableHtml(rows) {
  if (!rows.length) return emptyDashboardHtml('暂无运行时结果');
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>方法</th>
          <th>状态</th>
          <th>样本</th>
          <th>术语覆盖</th>
          <th>证据召回</th>
          <th>无依据断言</th>
          <th>schema issue</th>
          <th>答案评估</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.method || '-')}</td>
            <td><span class="status-pill ${statusClass(row.status)}">${escapeHtml(statusLabel(row.status))}</span></td>
            <td>${escapeHtml(formatNumber(row.case_count))}</td>
            <td>${escapeHtml(formatPercentRatio(row.answer_expected_term_coverage_mean))}</td>
            <td>${escapeHtml(formatPercentRatio(row.gold_section_evidence_recall_mean))}</td>
            <td>${escapeHtml(formatNumber(row.unsupported_claim_count))}</td>
            <td>${escapeHtml(formatNumber(row.schema_issue_count))}</td>
            <td>${escapeHtml(statusLabel(row.answer_correctness))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function heldoutTableHtml(rows) {
  if (!rows.length) return emptyDashboardHtml('暂无 held-out 段落');
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>段落</th>
          <th>教材</th>
          <th>学科</th>
          <th>标题</th>
          <th>覆盖标签</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.id || '-')}</td>
            <td>${escapeHtml(row.book_id || '-')}</td>
            <td>${escapeHtml(row.subject || '-')}</td>
            <td>${escapeHtml(row.title || '-')}</td>
            <td>${escapeHtml(Array.isArray(row.coverage_tags) ? row.coverage_tags.join(', ') : '-')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function nextInputsHtml(requiredInputs) {
  const rows = Object.entries(requiredInputs)
    .flatMap(([category, values]) => (
      Array.isArray(values)
        ? values.map((value) => ({ category, value }))
        : [{ category, value: JSON.stringify(values) }]
    ));
  if (!rows.length) return emptyDashboardHtml('暂无待补输入');
  return rows.map((row) => `
    <div class="file-row">
      <span class="status-dot warn"></span>
      <code>${escapeHtml(row.category)}：${escapeHtml(row.value)}</code>
    </div>
  `).join('');
}

function physicsRuntimeTableHtml(rows) {
  if (!rows.length) return emptyDashboardHtml('暂无运行时结果');
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>方法</th>
          <th>状态</th>
          <th>答案正确性</th>
          <th>引用准确性</th>
          <th>无依据断言</th>
          <th>误解处理</th>
          <th>先修覆盖</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.method || '-')}</td>
            <td><span class="status-pill ${statusClass(row.status)}">${escapeHtml(statusLabel(row.status))}</span></td>
            <td>${escapeHtml(formatNumber(row.answer_correctness))}</td>
            <td>${escapeHtml(formatNumber(row.citation_accuracy))}</td>
            <td>${escapeHtml(formatNumber(row.unsupported_claim_count))}</td>
            <td>${escapeHtml(formatNumber(row.misconception_score))}</td>
            <td>${escapeHtml(formatNumber(row.prerequisite_coverage))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function externalBaselineHtml(external) {
  const rows = [];
  for (const [category, values] of Object.entries(external)) {
    if (!Array.isArray(values)) continue;
    for (const item of values) rows.push({ category, ...item });
  }
  if (!rows.length) return emptyDashboardHtml('暂无外部基线状态');
  return `
    <table class="data-table compact-table">
      <thead>
        <tr>
          <th>类别</th>
          <th>baseline</th>
          <th>状态</th>
          <th>原因</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.category || '-')}</td>
            <td>${escapeHtml(row.baseline || row.method || '-')}</td>
            <td><span class="status-pill ${statusClass(row.status)}">${escapeHtml(statusLabel(row.status))}</span></td>
            <td>${escapeHtml(row.reason || '')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function mergeScores(scores) {
  const byId = new Map(scores.map((score) => [score.review_id, score]));
  for (const row of state.rows) {
    const source = byId.get(row.review_id) || row.scores || {};
    state.scores.set(row.review_id, normalizeScore(row, source));
  }
}

function normalizeScore(row, source) {
  const score = {
    review_id: row.review_id,
    method_code: row.method_code,
    case_id: row.case_id,
    task_type: row.task_type,
    correctness_1_5: normalizeScoreValue(source.correctness_1_5),
    evidence_1_5: normalizeScoreValue(source.evidence_1_5),
    teaching_1_5: normalizeScoreValue(source.teaching_1_5),
    notes: String(source.notes || ''),
  };
  score.total_3_15 = totalScore(score);
  return score;
}

function normalizeScoreValue(value) {
  if (value === '' || value === null || value === undefined) return '';
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? String(number) : '';
}

function totalScore(score) {
  if (SCORE_FIELDS.some((field) => score[field] === '')) return '';
  return String(SCORE_FIELDS.reduce((sum, field) => sum + Number(score[field]), 0));
}

function buildFilterOptions() {
  fillSelect(els.taskFilter, [
    ['all', '全部题型'],
    ...unique(state.rows.map((row) => row.task_type)).map((value) => [value, value]),
  ]);
  const methodOptions = uniqueBy(state.rows, (row) => row.method_code)
    .sort((left, right) => methodDisplay(left).localeCompare(methodDisplay(right), 'zh-CN'))
    .map((row) => [row.method_code, methodDisplay(row)]);
  fillSelect(els.methodFilter, [
    ['all', '全部方法'],
    ...methodOptions,
  ]);
}

function fillSelect(select, options) {
  select.innerHTML = options
    .map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`)
    .join('');
}

function updateFilter(name, value) {
  state.filters[name] = value;
  applyFilters();
}

function clearFilters() {
  resetFilters();
  applyFilters();
}

function applyFilters() {
  const search = normalizeText(state.filters.search);
  state.filtered = state.rows.filter((row) => {
    const score = state.scores.get(row.review_id);
    const haystack = normalizeText([row.case_id, row.task_type, row.method_code, methodDisplay(row), row.method_label, row.method_label_zh, row.question].join(' '));
    if (search && !haystack.includes(search)) return false;
    if (state.filters.task !== 'all' && row.task_type !== state.filters.task) return false;
    if (state.filters.method !== 'all' && row.method_code !== state.filters.method) return false;
    if (state.filters.status === 'done' && !isComplete(score)) return false;
    if (state.filters.status === 'todo' && isComplete(score)) return false;
    return true;
  });
  if (!state.filtered.some((row) => row.review_id === state.currentId)) {
    state.currentId = state.filtered[0]?.review_id || null;
  }
  render();
}

function render() {
  renderSummary();
  renderQueue();
  renderCurrent();
}

function renderSummary() {
  const completed = state.rows.filter((row) => isComplete(state.scores.get(row.review_id))).length;
  const total = state.rows.length;
  els.completedCount.textContent = String(completed);
  els.totalCount.textContent = String(total);
  els.filteredCount.textContent = String(state.filtered.length);
  els.progressFill.style.width = total ? `${Math.round((completed / total) * 100)}%` : '0%';
}

async function loadDashboard(options = {}) {
  const { silent = false } = options;
  state.dashboard.loading = true;
  state.dashboard.error = '';
  if (!silent) renderDashboard();
  try {
    const data = await fetchJson(`/api/score-dashboard?source=${encodeURIComponent(state.dashboard.source)}`);
    state.dashboard.data = data;
  } catch (error) {
    console.error(error);
    state.dashboard.error = error.message;
  } finally {
    state.dashboard.loading = false;
    renderDashboard();
  }
}

function renderDashboard() {
  const { data, loading, error } = state.dashboard;
  els.dashboardSource.value = state.dashboard.source;
  if (loading && !data) {
    els.dashboardStatus.textContent = '正在加载评分看板';
    els.dashboardMetrics.innerHTML = dashboardMetricSkeleton();
    els.methodChart.innerHTML = emptyDashboardHtml('正在加载');
    els.taskChart.innerHTML = emptyDashboardHtml('正在加载');
    els.scoreDistribution.innerHTML = emptyDashboardHtml('正在加载');
    els.lowScoreList.innerHTML = emptyDashboardHtml('正在加载');
    return;
  }
  if (error && !data) {
    els.dashboardStatus.textContent = `评分看板加载失败：${error}`;
    els.dashboardMetrics.innerHTML = '';
    els.methodChart.innerHTML = emptyDashboardHtml('暂无数据');
    els.taskChart.innerHTML = emptyDashboardHtml('暂无数据');
    els.scoreDistribution.innerHTML = emptyDashboardHtml('暂无数据');
    els.lowScoreList.innerHTML = emptyDashboardHtml('暂无数据');
    return;
  }
  if (!data) return;

  const fileNote = data.fileExists ? '' : '，评分文件尚不存在';
  els.dashboardStatus.textContent = `${data.label}：${data.scoredRows}/${data.totalRows} 条已完成，完成度 ${formatPercent(data.completionRate)}${fileNote}`;
  els.dashboardMetrics.innerHTML = dashboardMetricsHtml(data);
  els.methodChart.innerHTML = barListHtml(data.byMethod, {
    label: (row) => row.display || row.key,
    value: (row) => row.averageTotal,
    max: 15,
    meta: (row) => `${row.scoredRows}/${row.totalRows} 条`,
  });
  els.taskChart.innerHTML = barListHtml(data.byTaskType, {
    label: (row) => taskLabel(row.key),
    value: (row) => row.averageTotal,
    max: 15,
    meta: (row) => `${row.scoredRows}/${row.totalRows} 条`,
  });
  els.scoreDistribution.innerHTML = distributionHtml(data.distribution);
  els.lowScoreList.innerHTML = lowScoreListHtml(data.lowScoreRows);
  bindLowScoreRows();
  renderAssistantScoreBox(currentRow());
}

function dashboardMetricsHtml(data) {
  const metrics = [
    ['完成度', `${data.scoredRows}/${data.totalRows}`, `${formatPercent(data.completionRate)} 已完成`],
    ['总分均值', formatScore(data.averages.averageTotal, 15), '3 到 15 分'],
    ['正确性均值', formatScore(data.averages.averageCorrectness, 5), '1 到 5 分'],
    ['证据支撑均值', formatScore(data.averages.averageEvidence, 5), '1 到 5 分'],
    ['教学可用均值', formatScore(data.averages.averageTeaching, 5), '1 到 5 分'],
    ['部分填写', String(data.partialRows), '有分项但未完整'],
  ];
  return metrics.map(([label, value, detail]) => `
    <div class="dashboard-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `).join('');
}

function dashboardMetricSkeleton() {
  return ['完成度', '总分均值', '正确性均值', '证据支撑均值', '教学可用均值', '部分填写'].map((label) => `
    <div class="dashboard-metric muted">
      <span>${escapeHtml(label)}</span>
      <strong>-</strong>
      <small>等待数据</small>
    </div>
  `).join('');
}

function barListHtml(rows, config) {
  const visibleRows = rows
    .filter((row) => Number.isFinite(config.value(row)))
    .sort((left, right) => config.value(right) - config.value(left) || config.label(left).localeCompare(config.label(right), 'zh-CN'));
  if (!visibleRows.length) return emptyDashboardHtml('暂无已完成评分');
  return visibleRows.map((row) => {
    const value = config.value(row);
    const width = Math.max(2, Math.min(100, (value / config.max) * 100));
    return `
      <div class="bar-row">
        <div class="bar-label">
          <strong>${escapeHtml(config.label(row))}</strong>
          <span>${escapeHtml(config.meta(row))}</span>
        </div>
        <div class="bar-track" aria-hidden="true"><span style="width: ${width}%"></span></div>
        <strong class="bar-value">${escapeHtml(formatNumber(value))}</strong>
      </div>
    `;
  }).join('');
}

function distributionHtml(distribution) {
  const total = distribution.reduce((sum, item) => sum + item.count, 0);
  if (!total) return emptyDashboardHtml('暂无已完成评分');
  const maxCount = Math.max(...distribution.map((item) => item.count), 1);
  return distribution.map((item) => {
    const height = Math.max(4, Math.round((item.count / maxCount) * 100));
    return `
      <div class="distribution-item">
        <div class="distribution-bar" aria-hidden="true"><span style="height: ${height}%"></span></div>
        <strong>${escapeHtml(item.count)}</strong>
        <span>${escapeHtml(item.score)}分</span>
      </div>
    `;
  }).join('');
}

function lowScoreListHtml(rows) {
  if (!rows.length) return emptyDashboardHtml('暂无已完成评分');
  return rows.map((row) => `
    <button class="low-score-row" type="button" data-review-id="${escapeAttr(row.review_id)}" aria-label="查看 ${escapeAttr(row.case_id)} 的详细情况">
      <div>
        <strong>${escapeHtml(row.case_id)}</strong>
        <span>${escapeHtml(methodDisplay(row))} · ${escapeHtml(taskLabel(row.task_type))}</span>
      </div>
      <div class="low-score-breakdown">
        <span>正 ${escapeHtml(row.correctness_1_5)}</span>
        <span>证 ${escapeHtml(row.evidence_1_5)}</span>
        <span>教 ${escapeHtml(row.teaching_1_5)}</span>
      </div>
      <strong class="low-score-total">${escapeHtml(row.total_3_15)}/15</strong>
      <p>${escapeHtml(row.notes || '无备注')}</p>
    </button>
  `).join('');
}

function bindLowScoreRows() {
  els.lowScoreList.querySelectorAll('.low-score-row').forEach((button) => {
    button.addEventListener('click', () => openReviewById(button.dataset.reviewId));
  });
}

function emptyDashboardHtml(text) {
  return `<div class="dashboard-empty">${escapeHtml(text)}</div>`;
}

function renderQueue() {
  els.queueList.innerHTML = state.filtered.map((row) => {
    const score = state.scores.get(row.review_id);
    const done = isComplete(score);
    const active = row.review_id === state.currentId;
    return `
      <button class="queue-item ${done ? 'done' : ''} ${active ? 'active' : ''}" type="button" role="option" aria-selected="${active}" data-review-id="${escapeAttr(row.review_id)}">
        <span>
          <span class="queue-title">${escapeHtml(row.case_id)}</span>
          <span class="queue-meta">${escapeHtml(methodDisplay(row))} · ${escapeHtml(taskLabel(row.task_type))}</span>
        </span>
        <span class="queue-score">${score?.total_3_15 || '-'}/15</span>
      </button>
    `;
  }).join('');
  els.queueList.querySelectorAll('.queue-item').forEach((button) => {
    button.addEventListener('click', () => {
      state.currentId = button.dataset.reviewId;
      render();
      document.getElementById('main')?.focus({ preventScroll: true });
    });
  });
}

function renderCurrent() {
  const row = currentRow();
  els.emptyState.hidden = Boolean(row);
  els.reviewCard.hidden = !row;
  if (!row) return;

  const score = state.scores.get(row.review_id);
  els.caseMeta.textContent = `${methodDisplay(row)} · ${taskLabel(row.task_type)} · ${row.case_id}`;
  els.questionText.textContent = row.question;
  els.totalScore.textContent = score?.total_3_15 || '-';
  els.answerText.innerHTML = renderMarkdown(row.answer);
  els.citationList.innerHTML = citationHtml(row.citations || []);
  els.claimList.innerHTML = claimHtml(row.unsupported_claims || []);
  els.expectedTerms.innerHTML = termHtml(row.expected_terms_for_calibration || []);
  els.notesInput.value = score?.notes || '';
  renderAssistantScoreBox(row);
  renderDebugBox(row);
  renderScoreButtons(score);
  updateNavButtons();
  renderSummary();
}

function renderAssistantScoreBox(row) {
  if (!els.assistantScoreBox) return;
  const score = dashboardScoreForRow(row);
  const source = state.dashboard.data?.source;
  if (!row || source !== 'ai' || !score) {
    els.assistantScoreBox.hidden = true;
    els.assistantScoreBox.innerHTML = '';
    return;
  }
  els.assistantScoreBox.hidden = false;
  els.assistantScoreBox.innerHTML = `
    <div class="assistant-score-header">
      <div>
        <h3>AI 预评分详情</h3>
        <p>${escapeHtml(methodDisplay(score))} · ${escapeHtml(taskLabel(score.task_type))} · ${escapeHtml(score.case_id)}</p>
      </div>
      <strong>${escapeHtml(score.total_3_15)}/15</strong>
    </div>
    <div class="assistant-score-grid">
      <span>正确性 <strong>${escapeHtml(score.correctness_1_5)}/5</strong></span>
      <span>证据支撑性 <strong>${escapeHtml(score.evidence_1_5)}/5</strong></span>
      <span>教学可用性 <strong>${escapeHtml(score.teaching_1_5)}/5</strong></span>
    </div>
    <p class="assistant-score-note">${escapeHtml(score.notes || '无备注')}</p>
  `;
}

function renderDebugBox(row) {
  if (!row) {
    els.debugContent.innerHTML = emptyDashboardHtml('无当前条目');
    return;
  }
  const detail = state.debugDetails.get(row.review_id);
  if (detail) {
    els.debugContent.innerHTML = reviewDebugHtml(detail);
    return;
  }
  els.debugContent.innerHTML = emptyDashboardHtml(state.debugLoading.has(row.review_id) ? '正在加载召回和提示词' : '等待加载');
  loadReviewDebug(row.review_id);
}

async function loadReviewDebug(reviewId) {
  if (!reviewId || state.debugDetails.has(reviewId) || state.debugLoading.has(reviewId)) return;
  state.debugLoading.add(reviewId);
  try {
    const detail = await fetchJson(`/api/review-debug?review_id=${encodeURIComponent(reviewId)}`);
    state.debugDetails.set(reviewId, detail);
  } catch (error) {
    console.error(error);
    state.debugDetails.set(reviewId, { error: error.message });
  } finally {
    state.debugLoading.delete(reviewId);
    if (state.currentId === reviewId) renderDebugBox(currentRow());
  }
}

function reviewDebugHtml(detail) {
  if (detail.error) return emptyDashboardHtml(`加载失败：${detail.error}`);
  const diagnostics = detail.retrieval?.diagnostics || {};
  const vectorRows = Array.isArray(diagnostics.rows) ? diagnostics.rows.slice(0, 8) : [];
  return `
    <div class="debug-grid">
      <div class="debug-panel">
        <h3>召回方式</h3>
        <dl class="debug-kv">
          <div><dt>方法</dt><dd>${escapeHtml(methodDisplay(detail.method || detail))}</dd></div>
          <div><dt>消融组</dt><dd>${escapeHtml(detail.variant.variant_id)} · ${escapeHtml(detail.method?.label_zh || detail.variant.label)}</dd></div>
          <div><dt>数据源</dt><dd>${escapeHtml(detail.variant.source)}</dd></div>
          <div><dt>召回模式</dt><dd>${escapeHtml(detail.variant.retrieval)}</dd></div>
          <div><dt>使用 embedding</dt><dd>${escapeHtml(embeddingUsageText(detail))}</dd></div>
          <div><dt>召回上限</dt><dd>seed ${escapeHtml(detail.run.seed_limit)}，最终 ${escapeHtml(detail.run.retrieval_limit)}</dd></div>
          <div><dt>上下文长度</dt><dd>${escapeHtml(formatNumber(detail.retrieval.context_char_count || 0))} 字符</dd></div>
        </dl>
        <p class="debug-note">${escapeHtml(detail.retrieval.explanation)}</p>
      </div>
      <div class="debug-panel">
        <h3>本条诊断</h3>
        ${diagnosticHtml(diagnostics)}
      </div>
    </div>
    <div class="debug-panel">
      <h3>召回节点</h3>
      ${nodeListHtml(detail.retrieval.retrieved_node_ids || [])}
      ${vectorRows.length ? vectorRowsHtml(vectorRows) : ''}
    </div>
    <div class="debug-panel">
      <h3>模型提示词</h3>
      <p class="debug-note">${escapeHtml(detail.prompt.note)}</p>
      <div class="prompt-block">
        <span>system</span>
        <pre>${escapeHtml(detail.prompt.system)}</pre>
      </div>
      <div class="prompt-block">
        <span>user</span>
        <pre>${escapeHtml(detail.prompt.user)}</pre>
      </div>
    </div>
  `;
}

function diagnosticHtml(diagnostics) {
  const entries = Object.entries(diagnostics)
    .filter(([key]) => key !== 'rows')
    .map(([key, value]) => `
      <div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatDebugValue(value))}</dd></div>
    `);
  if (!entries.length) return '<div class="debug-empty-inline">无诊断字段</div>';
  return `<dl class="debug-kv">${entries.join('')}</dl>`;
}

function nodeListHtml(nodeIds) {
  if (!nodeIds.length) return '<div class="debug-empty-inline">未召回节点</div>';
  return `<ol class="debug-node-list">${nodeIds.map((nodeId) => `<li>${escapeHtml(nodeId)}</li>`).join('')}</ol>`;
}

function vectorRowsHtml(rows) {
  return `
    <div class="vector-list">
      <h4>向量相似度</h4>
      ${rows.map((row) => `
        <div>
          <span>${escapeHtml(row.node_id || '-')}</span>
          <strong>${escapeHtml(formatNumber(row.similarity ?? 0))}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function embeddingUsageText(detail) {
  if (detail.variant.retrieval === 'node_vector') {
    return detail.retrieval.diagnostics?.used ? '是，查询 world_nodes.embedding' : '尝试使用，但本条不可用';
  }
  const usesUnitEmbedding = detail.run.db_embeddings_enabled
    && detail.variant.source === 'canonical'
    && (detail.variant.variant_id === 'A0' || detail.variant.variant_id === 'A5');
  if (usesUnitEmbedding) return '是，词项召回与 world_unit_embeddings 融合';
  return '否';
}

function renderScoreButtons(score) {
  document.querySelectorAll('.score-row').forEach((rowEl) => {
    const field = rowEl.dataset.field;
    const container = rowEl.querySelector('.segmented');
    const value = score?.[field] || '';
    container.innerHTML = [1, 2, 3, 4, 5].map((point) => `
      <button type="button" class="${value === String(point) ? 'active' : ''}" aria-pressed="${value === String(point)}" data-field="${field}" data-value="${point}">
        ${point}
      </button>
    `).join('');
    container.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => setScore(button.dataset.field, button.dataset.value));
      button.setAttribute('aria-label', `${SCORE_LABELS[field]} ${button.dataset.value} 分`);
    });
  });
}

function setScore(field, value) {
  const score = currentScore();
  if (!score) return;
  score[field] = normalizeScoreValue(value);
  score.total_3_15 = totalScore(score);
  touchScores();
  render();
}

function touchScores() {
  state.dirty = true;
  setSaveState('未保存');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    saveNow().catch((error) => {
      console.error(error);
      setSaveState(`保存失败：${error.message}`, true);
    });
  }, 600);
}

async function saveNow() {
  if (state.saving) return;
  state.saving = true;
  setSaveState('正在保存');
  try {
    const scores = state.rows.map((row) => state.scores.get(row.review_id));
    await fetchJson('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scores }),
    });
    state.dirty = false;
    setSaveState('已保存');
    if (state.dashboard.source === 'human') {
      loadDashboard({ silent: true });
    }
  } finally {
    state.saving = false;
  }
}

async function exportCsv() {
  if (state.dirty) await saveNow();
  window.location.href = `/api/export.csv?t=${Date.now()}`;
}

async function importCsv(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const imported = parseCsv(text);
    const [header, ...body] = imported;
    const index = new Map(header.map((name, offset) => [name, offset]));
    for (const cells of body) {
      const reviewId = cells[index.get('review_id')] || '';
      if (!state.scores.has(reviewId)) continue;
      const current = state.scores.get(reviewId);
      for (const field of SCORE_FIELDS) current[field] = normalizeScoreValue(cells[index.get(field)] || '');
      current.notes = cells[index.get('notes')] || '';
      current.total_3_15 = totalScore(current);
    }
    touchScores();
    render();
  } catch (error) {
    console.error(error);
    setSaveState(`导入失败：${error.message}`, true);
  }
}

function goToFirstTodo() {
  const row = state.filtered.find((item) => !isComplete(state.scores.get(item.review_id)))
    || state.rows.find((item) => !isComplete(state.scores.get(item.review_id)));
  if (!row) return;
  state.currentId = row.review_id;
  render();
}

function openReviewById(reviewId) {
  const row = state.rows.find((item) => item.review_id === reviewId);
  if (!row) return;
  state.currentId = reviewId;
  if (!rowMatchesFilters(row)) {
    resetFilters();
  }
  applyFilters();
  document.getElementById('main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('main')?.focus({ preventScroll: true });
}

function moveBy(offset) {
  if (!state.filtered.length) return;
  const index = Math.max(0, state.filtered.findIndex((row) => row.review_id === state.currentId));
  const nextIndex = Math.min(Math.max(index + offset, 0), state.filtered.length - 1);
  state.currentId = state.filtered[nextIndex]?.review_id || state.currentId;
  render();
}

function updateNavButtons() {
  const index = state.filtered.findIndex((row) => row.review_id === state.currentId);
  els.prevButton.disabled = index <= 0;
  els.nextButton.disabled = index < 0 || index >= state.filtered.length - 1;
}

function handleKeys(event) {
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveNow();
  } else if (event.key === 'ArrowLeft') {
    moveBy(-1);
  } else if (event.key === 'ArrowRight') {
    moveBy(1);
  }
}

function currentRow() {
  return state.rows.find((row) => row.review_id === state.currentId) || null;
}

function currentScore() {
  return state.currentId ? state.scores.get(state.currentId) : null;
}

function dashboardScoreForRow(row) {
  if (!row || !Array.isArray(state.dashboard.data?.scoreRows)) return null;
  return state.dashboard.data.scoreRows.find((score) => score.review_id === row.review_id) || null;
}

function isComplete(score) {
  return Boolean(score && SCORE_FIELDS.every((field) => score[field] !== ''));
}

function rowMatchesFilters(row) {
  const search = normalizeText(state.filters.search);
  const score = state.scores.get(row.review_id);
  const haystack = normalizeText([row.case_id, row.task_type, row.method_code, methodDisplay(row), row.method_label, row.method_label_zh, row.question].join(' '));
  if (search && !haystack.includes(search)) return false;
  if (state.filters.task !== 'all' && row.task_type !== state.filters.task) return false;
  if (state.filters.method !== 'all' && row.method_code !== state.filters.method) return false;
  if (state.filters.status === 'done' && !isComplete(score)) return false;
  if (state.filters.status === 'todo' && isComplete(score)) return false;
  return true;
}

function resetFilters() {
  state.filters = { search: '', task: 'all', method: 'all', status: 'all' };
  els.searchInput.value = '';
  els.taskFilter.value = 'all';
  els.methodFilter.value = 'all';
  els.statusFilter.value = 'all';
}

function citationHtml(citations) {
  if (!citations.length) return '<div class="empty-chip">无引用</div>';
  return citations.map((citation) => `
    <div class="citation-item">
      <span class="citation-id">${escapeHtml(citation.node_id || '-')}<br>${escapeHtml(citation.evidence_id || '-')}</span>
      <p>${escapeHtml(citation.note || '')}</p>
    </div>
  `).join('');
}

function claimHtml(claims) {
  if (!claims.length) return '<div class="empty-chip">未标记</div>';
  return claims.map((claim) => `<div class="claim-item"><p>${escapeHtml(claim)}</p></div>`).join('');
}

function termHtml(terms) {
  if (!terms.length) return '<div class="empty-chip">无</div>';
  return `<div class="term-list">${terms.map((term) => `<span class="term-chip">${escapeHtml(term)}</span>`).join('')}</div>`;
}

function renderMarkdown(text) {
  const source = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!source) return '<p>空回答</p>';

  const blocks = [];
  let paragraph = [];
  let ordered = [];
  let unordered = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushOrdered = () => {
    if (!ordered.length) return;
    blocks.push(`<ol>${ordered.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</ol>`);
    ordered = [];
  };
  const flushUnordered = () => {
    if (!unordered.length) return;
    blocks.push(`<ul>${unordered.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`);
    unordered = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushOrdered();
    flushUnordered();
  };

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flushAll();
      continue;
    }
    const orderedMatch = line.match(/^(\d+)[.、]\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      flushUnordered();
      ordered.push(orderedMatch[2]);
      continue;
    }
    const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      flushOrdered();
      unordered.push(unorderedMatch[1]);
      continue;
    }
    flushOrdered();
    flushUnordered();
    paragraph.push(line);
  }
  flushAll();

  return blocks.join('');
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*\s*([^*]+?)\s*\*\*/g, '<strong>$1</strong>')
    .replace(/\b([A-Za-z])\^([0-9]+)\b/g, '$1<sup>$2</sup>');
}

function setSaveState(text, isError = false) {
  els.saveState.textContent = text;
  els.saveState.classList.toggle('error', isError);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return response.json();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const rows = [];
  for (const value of values) {
    const key = keyFn(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(value);
  }
  return rows;
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function methodDisplay(value) {
  if (!value) return '未标记方法';
  if (value.method_display) return value.method_display;
  if (value.display_name) return value.display_name;
  if (value.display) return value.display;
  if (value.method_code && value.variant_id && value.label_zh) return `${value.method_code} · ${value.variant_id} ${value.label_zh}`;
  if (value.method_code && value.variant_id && value.label) return `${value.method_code} · ${value.variant_id} ${value.label}`;
  if (value.method_code) return value.method_code;
  return String(value);
}

function taskLabel(value) {
  return TASK_LABELS[value] || value || '未标记';
}

function bookTitle(books, bookId) {
  const book = books.find((item) => item.id === bookId);
  return book?.title || bookId || '未标记教材';
}

function databaseLabel(value) {
  const labels = {
    nodes: '节点',
    edges: '关系',
    evidence: '证据',
    mentions: 'mentions',
    cards: '卡片',
    bodies: '正文',
    profiles: '画像',
    lesson_runs: 'lesson runs',
  };
  return labels[value] || value || '未标记';
}

function variantLabel(row) {
  if (!row) return '-';
  return row.label_zh || ABLATION_LABELS[row.variant_id] || row.label || row.variant_id || '-';
}

function statusLabel(value) {
  const labels = {
    completed: '已完成',
    partial: '部分完成',
    missing: '缺失',
    unknown: '未知',
    scored_available_inputs: '已评分',
    pending_inputs: '待输入',
    pending_scores: '待评分',
    pending_human_or_gold_judgment: '待人工或金标准评估',
    failed: '失败',
    ok: '正常',
  };
  return labels[value] || value || '未知';
}

function statusClass(value) {
  if (value === 'completed' || value === 'ok' || value === 'scored_available_inputs') return 'ok';
  if (value === 'partial') return 'active';
  if (value === 'failed' || value === 'missing' || value === 'pending_inputs' || value === 'pending_scores') return 'warn';
  return 'neutral';
}

function formatScore(value, max) {
  return Number.isFinite(value) ? `${formatNumber(value)}/${max}` : '-';
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (!Number.isFinite(Number(value))) return '-';
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(2).replace(/\.?0+$/, '');
}

function formatPercent(value) {
  return `${formatNumber(value)}%`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatPercentRatio(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (!Number.isFinite(Number(value))) return '-';
  return `${formatNumber(Number(value) * 100)}%`;
}

function formatMetricValue(value, unit) {
  if (unit === 'ratio') return formatPercentRatio(value);
  if (value === null || value === undefined || value === '') return '-';
  if (!Number.isFinite(Number(value))) return '-';
  return `${formatNumber(value)}${unit && unit !== 'ratio' ? ` ${unit}` : ''}`;
}

function formatDebugValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return `${value.length} 项`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
