#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXPERIMENTS_DIR = resolve(SCRIPT_DIR, '..');
const APP_DIR = resolve(EXPERIMENTS_DIR, 'app');
const REVIEW_EXPERIMENT_ID = 'okm-apiunit-ablation-2026-07-01';
const REVIEW_EXPERIMENT_DIR = resolve(EXPERIMENTS_DIR, REVIEW_EXPERIMENT_ID);
const OUTPUT_DIR = resolve(REVIEW_EXPERIMENT_DIR, 'outputs');
const SHEET_PATH = resolve(OUTPUT_DIR, 'blind-review-sheet.jsonl');
const SCORES_PATH = resolve(OUTPUT_DIR, 'human-scores.csv');
const AI_SCORES_PATH = resolve(OUTPUT_DIR, 'ai-assisted-scores.csv');
const VARIANT_RESULTS_PATH = resolve(OUTPUT_DIR, 'variant-results.json');
const BLIND_KEY_PATH = resolve(OUTPUT_DIR, 'blind-review-key.json');

const SCORE_FIELDS = [
  'correctness_1_5',
  'evidence_1_5',
  'teaching_1_5',
];

const CSV_HEADERS = [
  'review_id',
  'method_code',
  'case_id',
  'task_type',
  ...SCORE_FIELDS,
  'total_3_15',
  'notes',
];

const VARIANT_LABEL_ZH = {
  A0: '完整 OKM',
  A1: '去除证据锚定',
  A2: '去除 node_bodies',
  A3: '去除学科语义画像和课程教学投影',
  A4: '去除图关系，只做对象向量召回',
  A5: '去除关系扩展，只返回 top-k 单元',
  A6: '去除 QA、规范化和合并，直接使用 raw staging',
  A7: '仅节点骨架召回',
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const EXPERIMENTS = {
  ablation: REVIEW_EXPERIMENT_ID,
  eduku: 'okm-eduku-bench-v0.2-2026-07-01',
  physics: 'physics-okm-benchmark-2026-07-01',
};

main();

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error(error);
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  server.listen(flags.port, flags.host, () => {
    const host = flags.host === '0.0.0.0' ? 'localhost' : flags.host;
    console.log(`OKM experiment app: http://${host}:${flags.port}/app/`);
  });
}

function parseFlags(argv) {
  const flags = {
    host: '127.0.0.1',
    port: 4187,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--host') {
      flags.host = requireValue(argv, ++index, arg);
    } else if (arg === '--port') {
      flags.port = Number.parseInt(requireValue(argv, ++index, arg), 10);
      if (!Number.isInteger(flags.port) || flags.port <= 0) throw new Error('--port must be a positive integer.');
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return flags;
}

function printHelp() {
  console.log([
    'Usage: node experiments/scripts/serve-experiment-app.mjs [options]',
    '',
    'Options:',
    '  --host <host>    Bind host. Default: 127.0.0.1',
    '  --port <port>    Bind port. Default: 4187',
  ].join('\n'));
}

async function handleRequest(request, response) {
  const url = new URL(request.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (request.method === 'GET' && pathname === '/') {
    response.writeHead(302, { Location: '/app/' });
    response.end();
    return;
  }

  if (request.method === 'GET' && pathname === '/api/health') {
    sendJson(response, 200, {
      status: 'ok',
      sheet_exists: existsSync(SHEET_PATH),
      scores_exists: existsSync(SCORES_PATH),
      ai_scores_exists: existsSync(AI_SCORES_PATH),
      review_experiment: REVIEW_EXPERIMENT_ID,
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/experiments') {
    sendJson(response, 200, buildExperimentDashboard());
    return;
  }

  if (request.method === 'GET' && pathname === '/api/review-sheet') {
    const rows = decorateReviewRows(readReviewSheet());
    sendJson(response, 200, {
      rows,
      total: rows.length,
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/scores') {
    sendJson(response, 200, {
      scores: readScores(),
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/score-dashboard') {
    const source = url.searchParams.get('source') || 'human';
    const config = scoreSourceConfig(source);
    if (!config) {
      sendJson(response, 400, { error: 'Unknown score source.' });
      return;
    }
    sendJson(response, 200, buildScoreDashboard(config));
    return;
  }

  if (request.method === 'GET' && pathname === '/api/review-debug') {
    const reviewId = url.searchParams.get('review_id') || '';
    const detail = buildReviewDebug(reviewId);
    if (!detail) {
      sendJson(response, 404, { error: 'Review detail not found.' });
      return;
    }
    sendJson(response, 200, detail);
    return;
  }

  if (request.method === 'GET' && pathname === '/api/export.csv') {
    const rows = readReviewSheet();
    const scoreMap = normalizeScorePayload(rows, readScores());
    const content = scoresToCsv(rows, scoreMap);
    response.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="human-scores.csv"',
      'Cache-Control': 'no-store',
    });
    response.end(content);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/scores') {
    const payload = await readJsonBody(request);
    if (!payload || !Array.isArray(payload.scores)) {
      sendJson(response, 400, { error: 'Expected JSON body with scores array.' });
      return;
    }
    const rows = readReviewSheet();
    const scoreMap = normalizeScorePayload(rows, payload.scores);
    writeFileSync(SCORES_PATH, scoresToCsv(rows, scoreMap), 'utf8');
    sendJson(response, 200, {
      status: 'saved',
      rows: rows.length,
      completed: countCompleted(scoreMap),
    });
    return;
  }

  if (request.method === 'GET' && (pathname === '/review-app' || pathname === '/review-app/')) {
    response.writeHead(302, { Location: '/app/?view=review' });
    response.end();
    return;
  }

  if (request.method === 'GET' && pathname.startsWith('/review-app/')) {
    response.writeHead(302, { Location: `/app/${pathname.slice('/review-app/'.length)}` });
    response.end();
    return;
  }

  if (request.method === 'GET' && (pathname === '/app' || pathname === '/app/')) {
    sendFile(response, resolve(APP_DIR, 'index.html'));
    return;
  }

  if (request.method === 'GET' && pathname.startsWith('/app/')) {
    const requested = resolve(APP_DIR, pathname.replace('/app/', ''));
    if (!isInside(APP_DIR, requested)) {
      sendJson(response, 403, { error: 'Forbidden.' });
      return;
    }
    sendFile(response, requested);
    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
}

function readReviewSheet() {
  if (!existsSync(SHEET_PATH)) throw new Error(`Review sheet not found: ${SHEET_PATH}`);
  return readFileSync(SHEET_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readMethodMap() {
  const key = readJsonFile(BLIND_KEY_PATH, { methods: [] });
  return new Map((key?.methods || []).map((method) => [method.method_code, {
    ...method,
    label_zh: VARIANT_LABEL_ZH[method.variant_id] || method.label || method.variant_id,
    display_name: methodDisplayName(method),
  }]));
}

function decorateReviewRows(rows) {
  const methodMap = readMethodMap();
  return rows.map((row) => decorateMethod(row, methodMap));
}

function decorateMethod(row, methodMap) {
  const method = methodMap.get(row.method_code);
  if (!method) {
    return {
      ...row,
      variant_id: '',
      method_label: '',
      method_label_zh: '',
      method_display: row.method_code,
    };
  }
  return {
    ...row,
    variant_id: method.variant_id,
    method_label: method.label,
    method_label_zh: method.label_zh,
    method_display: method.display_name,
  };
}

function methodDisplayName(method) {
  const label = VARIANT_LABEL_ZH[method.variant_id] || method.label || method.variant_id;
  return `${method.method_code} · ${method.variant_id} ${label}`;
}

function readScores(path = SCORES_PATH) {
  if (!existsSync(path)) return [];
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const [header, ...body] = rows;
  if (!header?.length) return [];
  const indexByName = new Map(header.map((name, index) => [name, index]));
  return body
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) => Object.fromEntries(header.map((name) => [name, row[indexByName.get(name)] ?? ''])));
}

function readJsonFile(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function buildReviewDebug(reviewId) {
  if (!reviewId) return null;
  const review = readReviewSheet().find((row) => row.review_id === reviewId);
  const run = readJsonFile(VARIANT_RESULTS_PATH);
  const key = readJsonFile(BLIND_KEY_PATH);
  if (!review || !run || !key) return null;
  const method = key.methods?.find((item) => item.method_code === review.method_code);
  const variant = run.variants?.find((item) => item.variant_id === method?.variant_id);
  const result = variant?.results?.find((item) => item.id === review.case_id);
  if (!method || !variant || !result) return null;
  const decoratedMethod = {
    ...method,
    label_zh: VARIANT_LABEL_ZH[method.variant_id] || method.label || method.variant_id,
    display_name: methodDisplayName(method),
  };

  return {
    review_id: review.review_id,
    method_code: review.method_code,
    case_id: review.case_id,
    task_type: review.task_type,
    run: {
      generated_at: run.generated_at,
      source: run.source,
      generated_answers: run.generated_answers,
      retrieval_limit: run.retrieval_limit,
      seed_limit: run.seed_limit,
      db_embeddings_enabled: Boolean(run.db_embeddings_enabled),
    },
    method: decoratedMethod,
    variant: {
      variant_id: variant.variant_id,
      label: variant.label,
      source: variant.source,
      retrieval: variant.retrieval,
    },
    retrieval: {
      explanation: retrievalExplanation(variant, run),
      diagnostics: result.retrieval_diagnostics || {},
      retrieved_node_ids: result.retrieved_node_ids || [],
      context_char_count: result.context_char_count ?? null,
      component_probe: result.component_probe || {},
    },
    prompt: promptPreview(result.question, result.context_char_count, variant),
  };
}

function retrievalExplanation(variant, run) {
  if (variant.retrieval === 'node_vector') {
    return [
      '本组使用节点向量召回：先把问题送入 embedding 服务得到查询向量，再用 pgvector 在 world_nodes.embedding 上按向量距离排序。',
      '本组不做图关系扩展，返回的上下文来自召回节点对应的消融视图。',
    ].join('\n');
  }
  const lines = [
    '本组先把每个 ApiUnit 按消融设置裁剪成视图文本，再用问题词项和视图文本做词项匹配打分。',
  ];
  if (run.db_embeddings_enabled && variant.source === 'canonical' && (variant.variant_id === 'A0' || variant.variant_id === 'A5')) {
    lines.push('本次运行启用了 --use-db-embeddings，所以该组还会把问题转成查询向量，并从 world_unit_embeddings 取候选后与词项候选融合。');
  } else {
    lines.push('本组没有使用 world_unit_embeddings 参与召回。');
  }
  if (variant.retrieval === 'node_text') {
    lines.push('node_text 只使用节点骨架文本：id、名称、类型、定义、别名和领域。');
  } else if (variant.retrieval === 'staging_text') {
    lines.push('staging_text 使用 raw staging 表构造的 ApiUnit 视图，不读取治理后的 canonical 合并结果。');
  } else {
    lines.push('unit_text 使用当前消融视图中的节点、卡片、正文、画像、关系和证据等允许字段。');
  }
  if (variant.variant_id !== 'A5' && variant.variant_id !== 'A4' && variant.variant_id !== 'A6' && variant.variant_id !== 'A7') {
    lines.push('如果该组允许关系扩展，会先取 seed 候选，再沿入边和出边补充相关节点，直到达到 top-k 上限。');
  } else {
    lines.push('该组不做关系扩展。');
  }
  return lines.join('\n');
}

function promptPreview(question, contextCharCount, variant) {
  const citationRule = variant.variant_id === 'A1' || variant.variant_id === 'A7'
    ? '本消融组不提供证据编号，citations 必须返回空数组。'
    : '每个事实性回答尽量引用上下文中的 evidence_id。';
  const contextPlaceholder = `[上下文正文未写入结果文件；本条生成时上下文长度为 ${contextCharCount ?? 0} 个字符]`;
  return {
    note: '实际请求包含完整上下文。前端这里只展示固定 system prompt、user prompt 骨架和本条上下文长度。',
    system: '你是高中物理教材问答系统。只能使用给定上下文回答。返回严格 JSON，不要输出额外文本。',
    user: [
      `问题：${question}`,
      '',
      `消融组：${variant.variant_id} ${variant.label}`,
      citationRule,
      '返回 JSON：{"answer":string,"citations":[{"node_id":string,"evidence_id":string,"note":string}],"unsupported_claims":string[]}',
      '',
      `上下文：\n${contextPlaceholder}`,
    ].join('\n'),
  };
}

function scoreSourceConfig(source) {
  if (source === 'human') {
    return {
      source: 'human',
      label: '人工评分',
      path: SCORES_PATH,
    };
  }
  if (source === 'ai') {
    return {
      source: 'ai',
      label: 'AI 辅助预评分',
      path: AI_SCORES_PATH,
    };
  }
  return null;
}

function buildScoreDashboard(config) {
  const methodMap = readMethodMap();
  const reviewRows = decorateReviewRows(readReviewSheet());
  const scoresById = new Map(readScores(config.path).map((score) => [score.review_id, score]));
  const rows = reviewRows.map((review) => {
    const score = scoresById.get(review.review_id) || {};
    const values = Object.fromEntries(SCORE_FIELDS.map((field) => [field, normalizeScoreValue(score[field])]));
    const hasAnyScore = SCORE_FIELDS.some((field) => values[field] !== '');
    const complete = SCORE_FIELDS.every((field) => values[field] !== '');
    const total = complete ? SCORE_FIELDS.reduce((sum, field) => sum + Number(values[field]), 0) : null;
    return {
      review_id: review.review_id,
      method_code: review.method_code,
      method_display: review.method_display,
      method_label: review.method_label,
      method_label_zh: review.method_label_zh,
      variant_id: review.variant_id,
      case_id: review.case_id,
      task_type: review.task_type,
      notes: String(score.notes || ''),
      ...values,
      total_3_15: total,
      complete,
      hasAnyScore,
    };
  });
  const scoredRows = rows.filter((row) => row.complete);
  const partialRows = rows.filter((row) => row.hasAnyScore && !row.complete);

  return {
    source: config.source,
    label: config.label,
    generatedAt: new Date().toISOString(),
    fileExists: existsSync(config.path),
    totalRows: rows.length,
    scoredRows: scoredRows.length,
    partialRows: partialRows.length,
    unscoredRows: rows.length - scoredRows.length - partialRows.length,
    completionRate: percent(scoredRows.length, rows.length),
    averages: summarizeScores(scoredRows),
    byMethod: summarizeGroups(rows, 'method_code', methodMap),
    byTaskType: summarizeGroups(rows, 'task_type'),
    distribution: scoreDistribution(scoredRows),
    scoreRows: scoredRows.map(compactScoreRow),
    lowScoreRows: scoredRows
      .slice()
      .sort((left, right) => (
        left.total_3_15 - right.total_3_15
        || Number(left.evidence_1_5) - Number(right.evidence_1_5)
        || left.review_id.localeCompare(right.review_id)
      ))
      .slice(0, 12)
      .map(compactScoreRow),
  };
}

function compactScoreRow(row) {
  return {
    review_id: row.review_id,
    method_code: row.method_code,
    method_display: row.method_display,
    method_label: row.method_label,
    method_label_zh: row.method_label_zh,
    variant_id: row.variant_id,
    case_id: row.case_id,
    task_type: row.task_type,
    total_3_15: row.total_3_15,
    correctness_1_5: Number(row.correctness_1_5),
    evidence_1_5: Number(row.evidence_1_5),
    teaching_1_5: Number(row.teaching_1_5),
    notes: row.notes,
  };
}

function summarizeGroups(rows, field, methodMap = null) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[field] || '未标记';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .map(([key, groupRows]) => {
      const completeRows = groupRows.filter((row) => row.complete);
      return {
        key,
        display: field === 'method_code'
          ? methodMap?.get(key)?.display_name || key
          : key,
        label: field === 'method_code'
          ? methodMap?.get(key)?.label || ''
          : '',
        label_zh: field === 'method_code'
          ? methodMap?.get(key)?.label_zh || ''
          : '',
        variant_id: field === 'method_code'
          ? methodMap?.get(key)?.variant_id || ''
          : '',
        totalRows: groupRows.length,
        scoredRows: completeRows.length,
        completionRate: percent(completeRows.length, groupRows.length),
        ...summarizeScores(completeRows),
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key, 'zh-CN'));
}

function summarizeScores(rows) {
  return {
    averageTotal: average(rows.map((row) => row.total_3_15)),
    averageCorrectness: average(rows.map((row) => Number(row.correctness_1_5))),
    averageEvidence: average(rows.map((row) => Number(row.evidence_1_5))),
    averageTeaching: average(rows.map((row) => Number(row.teaching_1_5))),
  };
}

function scoreDistribution(rows) {
  const counts = new Map();
  for (let score = 3; score <= 15; score += 1) counts.set(score, 0);
  for (const row of rows) counts.set(row.total_3_15, (counts.get(row.total_3_15) || 0) + 1);
  return [...counts.entries()].map(([score, count]) => ({ score, count }));
}

function average(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  return round2(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function percent(part, total) {
  return total ? round2((part / total) * 100) : 0;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function buildExperimentDashboard() {
  const ablationSummary = readExperimentJson(EXPERIMENTS.ablation, 'outputs/ablation-summary.json');
  const ablationRetrieval = readExperimentJson(EXPERIMENTS.ablation, 'outputs/retrieval-metrics.json');
  const edukuManifest = readExperimentJson(EXPERIMENTS.eduku, 'outputs/dataset-manifest.json');
  const edukuScoring = readExperimentJson(EXPERIMENTS.eduku, 'outputs/scoring-status.json');
  const edukuRuntime = readExperimentJson(EXPERIMENTS.eduku, 'outputs/runtime/okm-apiunit-rag-retrieval-only.unified.json');
  const physicsSummary = readExperimentJson(EXPERIMENTS.physics, 'outputs/experiment-summary.json');
  const edukuRuntimeResults = Array.isArray(edukuRuntime?.results) ? edukuRuntime.results : [];
  const retrievedCounts = edukuRuntimeResults.map((item) => (
    item && typeof item === 'object' && Array.isArray(item.retrieved_units)
      ? item.retrieved_units.length
      : 0
  ));
  const nonEmptyRetrievals = retrievedCounts.filter((value) => value > 0).length;
  const edukuDerived = {
    retrieval_case_count: edukuRuntimeResults.length,
    non_empty_retrieval_rate: retrievedCounts.length ? nonEmptyRetrievals / retrievedCounts.length : null,
    average_retrieved_units: retrievedCounts.length ? average(retrievedCounts) : null,
  };

  return {
    generated_at: new Date().toISOString(),
    experiments_root: 'experiments',
    review_experiment: REVIEW_EXPERIMENT_ID,
    experiments: [
      {
        id: EXPERIMENTS.eduku,
        title: 'OKM-EduKU-Bench v0.2',
        role: '论文级主实验',
        status: String(edukuScoring?.status || 'unknown'),
        metrics: [
          { label: '运行时问题', value: edukuManifest?.runtime_case_count ?? null, unit: '题' },
          { label: 'held-out 段落', value: Array.isArray(edukuManifest?.heldout_sections) ? edukuManifest.heldout_sections.length : null, unit: '段' },
          { label: '非空检索率', value: edukuDerived.non_empty_retrieval_rate, unit: 'ratio' },
        ],
      },
      {
        id: EXPERIMENTS.ablation,
        title: 'ApiUnit 消融实验',
        role: '组件贡献分析',
        status: ablationSummary?.generated_answers ? 'completed' : 'partial',
        metrics: [
          { label: '问题数', value: ablationSummary?.case_count ?? null, unit: '题' },
          { label: '变体数', value: Array.isArray(ablationSummary?.variants) ? ablationSummary.variants.length : null, unit: '组' },
          { label: '最佳术语覆盖', value: maxBy(ablationSummary?.variants, 'average_term_coverage'), unit: 'ratio' },
        ],
      },
      {
        id: EXPERIMENTS.physics,
        title: '物理小样本试验',
        role: '先用物理教材小样本跑通流程',
        status: physicsSummary ? 'completed' : 'missing',
        metrics: [
          { label: '段落', value: physicsSummary?.benchmark?.sections ?? null, unit: '段' },
          { label: '金标准节点', value: physicsSummary?.benchmark?.gold_nodes ?? null, unit: '个' },
          { label: '运行时问题', value: physicsSummary?.benchmark?.runtime_cases ?? null, unit: '题' },
        ],
      },
    ],
    eduku_v02: {
      dataset_manifest: edukuManifest,
      scoring_status: edukuScoring,
      runtime_unified: compactRuntime(edukuRuntime),
      derived: edukuDerived,
    },
    ablation: {
      summary: ablationSummary,
      retrieval_metrics: ablationRetrieval,
    },
    physics_sample: physicsSummary,
    files: [
      experimentFile(EXPERIMENTS.eduku, 'outputs/dataset-manifest.json', edukuManifest),
      experimentFile(EXPERIMENTS.eduku, 'outputs/scoring-status.json', edukuScoring),
      experimentFile(EXPERIMENTS.ablation, 'outputs/ablation-summary.json', ablationSummary),
      experimentFile(EXPERIMENTS.ablation, 'outputs/retrieval-metrics.json', ablationRetrieval),
      experimentFile(EXPERIMENTS.physics, 'outputs/experiment-summary.json', physicsSummary),
    ],
  };
}

function compactRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object') return null;
  const results = Array.isArray(runtime.results) ? runtime.results : [];
  return {
    method: runtime.method,
    status: runtime.status,
    case_count: results.length,
  };
}

function experimentFile(experimentId, filePath, payload) {
  return {
    experiment_id: experimentId,
    path: `experiments/${experimentId}/${filePath}`,
    exists: Boolean(payload),
  };
}

function readExperimentJson(experimentId, filePath) {
  const target = resolve(EXPERIMENTS_DIR, experimentId, filePath);
  if (!isInside(EXPERIMENTS_DIR, target)) return null;
  if (!existsSync(target)) return null;
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

function maxBy(rows, key) {
  if (!Array.isArray(rows)) return null;
  const values = rows
    .map((row) => (row && typeof row === 'object' ? row[key] : null))
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function isInside(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function normalizeScorePayload(reviewRows, scores) {
  const validReviewIds = new Set(reviewRows.map((row) => row.review_id));
  const metadataById = new Map(reviewRows.map((row) => [row.review_id, row]));
  const normalized = new Map();
  for (const item of scores) {
    if (!item || typeof item !== 'object' || !validReviewIds.has(String(item.review_id || ''))) continue;
    const review = metadataById.get(item.review_id);
    const score = {
      review_id: review.review_id,
      method_code: review.method_code,
      case_id: review.case_id,
      task_type: review.task_type,
      correctness_1_5: normalizeScoreValue(item.correctness_1_5),
      evidence_1_5: normalizeScoreValue(item.evidence_1_5),
      teaching_1_5: normalizeScoreValue(item.teaching_1_5),
      notes: String(item.notes || ''),
    };
    score.total_3_15 = totalScore(score);
    normalized.set(score.review_id, score);
  }
  return normalized;
}

function normalizeScoreValue(value) {
  if (value === '' || value === null || value === undefined) return '';
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) return '';
  return String(number);
}

function totalScore(score) {
  const values = SCORE_FIELDS.map((field) => score[field]);
  if (values.some((value) => value === '')) return '';
  return String(values.reduce((sum, value) => sum + Number(value), 0));
}

function scoresToCsv(reviewRows, scoreMap) {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of reviewRows) {
    const score = scoreMap.get(row.review_id) || {};
    lines.push(CSV_HEADERS.map((field) => csvCell(score[field] ?? row[field] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function countCompleted(scoreMap) {
  let completed = 0;
  for (const score of scoreMap.values()) {
    if (SCORE_FIELDS.every((field) => score[field] !== '')) completed += 1;
  }
  return completed;
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

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
}

function sendFile(response, path) {
  if (!existsSync(path)) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(path)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  response.end(readFileSync(path));
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}
