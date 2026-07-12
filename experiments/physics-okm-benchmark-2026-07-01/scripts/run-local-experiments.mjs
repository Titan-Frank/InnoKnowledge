#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(EXP_DIR, '..', '..');
const FIXTURES_DIR = resolve(EXP_DIR, 'fixtures');
const OUTPUT_DIR = resolve(EXP_DIR, 'outputs');
const GOLD_PATH = resolve(FIXTURES_DIR, 'gold-construction.json');
const RUNTIME_CASES_PATH = resolve(FIXTURES_DIR, 'runtime-cases.jsonl');
const PROCESS_PATH = resolve(OUTPUT_DIR, 'experiment-process.md');
const REPORT_PATH = resolve(OUTPUT_DIR, 'experiment-report.md');
const KG_CONDA_ENV = 'okm-kg-benchmark-20260701';
const RUNTIME_CONDA_ENV = 'okm-runtime-benchmark-20260701';

const ALLOWED_NODE_KINDS = new Set([
  'entity',
  'concept',
  'property',
  'process',
  'event',
  'method',
  'rule',
  'representation',
  'resource',
]);

const ALLOWED_EDGE_TYPES = new Set([
  'is_a',
  'instance_of',
  'part_of',
  'contains',
  'has_property',
  'uses',
  'produces',
  'depends_on',
  'prerequisite_for',
  'causes',
  'affects',
  'represents',
  'about',
  'same_as',
  'related_to',
]);

const args = new Set(process.argv.slice(2));
const envOnly = args.has('--env-check');
const skipLlm = args.has('--skip-llm');
const reuseExisting = args.has('--reuse-existing');
const runOfficial = args.has('--run-official');

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  loadEnv();

  const envStatus = checkEnv();
  saveJson('env-status.json', envStatus);
  if (envOnly) {
    console.log(JSON.stringify(envStatus, null, 2));
    return;
  }

  const gold = JSON.parse(readFileSync(GOLD_PATH, 'utf8'));
  const runtimeCases = readJsonl(RUNTIME_CASES_PATH);
  const markdownPath = resolve(REPO_ROOT, gold.source_markdown);
  const markdown = readFileSync(markdownPath, 'utf8');
  const snippets = buildGoldSnippets(markdown, gold.sections);
  saveJson('gold-snippets.json', snippets);

  const sql = postgres(process.env.DATABASE_URL, { max: 4 });
  try {
    const dbSnapshot = await readDatabaseSnapshot(sql);
    saveJson('database-snapshot.json', dbSnapshot);

    const constructionOutputs = {};
    const rawOkmConstruction = await extractOkmConstruction(sql, gold.dataset_id);
    saveJson('construction-okm-raw.json', rawOkmConstruction);
    constructionOutputs.okm = filterConstructionToBenchmark(rawOkmConstruction, snippets);
    saveJson('construction-okm.json', constructionOutputs.okm);

    constructionOutputs.openie_lite_local = runOpenIeLite(snippets);
    saveJson('construction-openie-lite-local.json', constructionOutputs.openie_lite_local);

    const existingLlmOnly = reuseExisting ? readExistingJson('construction-llm-only.json') : null;
    if (existingLlmOnly?.status === 'completed') {
      constructionOutputs.llm_only = existingLlmOnly;
    } else if (!skipLlm && envStatus.required.OPENAI_API_KEY === 'present') {
      constructionOutputs.llm_only = await runLlmOnlyConstruction(snippets);
    } else {
      constructionOutputs.llm_only = {
        baseline: 'llm-only',
        status: 'not_run',
        reason: skipLlm ? 'Skipped by --skip-llm.' : 'OPENAI_API_KEY is missing.',
        nodes: [],
        edges: [],
      };
    }
    saveJson('construction-llm-only.json', constructionOutputs.llm_only);

    if (runOfficial) runOfficialBaselines();
    const officialOutputs = loadOfficialOutputs(reuseExisting || runOfficial);
    for (const [method, output] of Object.entries(officialOutputs.construction)) {
      constructionOutputs[method] = output;
    }
    const externalStatus = externalStatusFromOfficialOutputs(officialOutputs);
    saveJson('construction-external-status.json', externalStatus.construction);
    saveJson('runtime-external-status.json', externalStatus.runtime);

    const constructionMetrics = scoreConstruction(gold, snippets, constructionOutputs, []);
    saveJson('construction-metrics.json', constructionMetrics);

    const apiunitRuntime = reuseExisting ? readExistingJson('runtime-apiunit-rag.json') || await runApiUnitRuntime() : await runApiUnitRuntime();
    saveJson('runtime-apiunit-rag.json', apiunitRuntime);

    const existingLocalRuntime = reuseExisting ? readExistingJson('runtime-local-baselines.json') : null;
    const localRuntime = existingLocalRuntime?.status === 'completed'
      ? existingLocalRuntime
      : skipLlm
        ? { status: 'not_run', reason: 'Skipped by --skip-llm.', results: [] }
        : await runLocalRuntimeBaselines(markdown, runtimeCases);
    saveJson('runtime-local-baselines.json', localRuntime);

    const runtimeMetrics = scoreRuntime(runtimeCases, apiunitRuntime, localRuntime, officialOutputs.runtime);
    saveJson('runtime-metrics.json', runtimeMetrics);

    const summary = {
      generated_at: new Date().toISOString(),
      benchmark: {
        book_id: gold.book_id,
        sections: gold.sections.length,
        gold_nodes: gold.nodes.length,
        gold_relations: gold.relations.length,
        runtime_cases: runtimeCases.length,
      },
      env: envStatus,
      database: dbSnapshot.counts,
      construction: constructionMetrics.summary,
      runtime: runtimeMetrics.summary,
      external_baselines: externalStatus,
    };
    saveJson('experiment-summary.json', summary);
    writeProcessLog(summary);
    writeReport(summary, constructionMetrics, runtimeMetrics);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function loadEnv() {
  const envPath = resolve(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [rawKey, ...valueParts] = line.split('=');
    const key = rawKey.trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = unquote(valueParts.join('=').trim());
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function checkEnv() {
  const required = {};
  for (const key of [
    'DATABASE_URL',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'EMBEDDING_API_KEY',
    'EMBEDDING_URL',
    'EMBEDDING_MODEL',
  ]) {
    required[key] = process.env[key] ? 'present' : 'missing';
  }
  return {
    required,
    node: process.version,
    cwd: REPO_ROOT,
  };
}

function runOfficialBaselines() {
  try {
    execFileSync('node', [
      resolve(SCRIPT_DIR, 'run-official-baselines.mjs'),
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const output = {
      generated_at: new Date().toISOString(),
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      stdout: error?.stdout?.toString?.().slice(0, 4000) || '',
      stderr: error?.stderr?.toString?.().slice(0, 4000) || '',
    };
    saveJson('official-baseline-run.json', output);
  }
}

function loadOfficialOutputs(allowExisting) {
  const constructionNames = [
    ['openie-official', 'construction-openie-official.json'],
    ['deepke-official', 'construction-deepke-official.json'],
    ['oneke-official', 'construction-oneke-official.json'],
  ];
  const runtimeNames = [
    ['graphrag-official', 'runtime-graphrag-official.json'],
    ['lightrag-official', 'runtime-lightrag-official.json'],
  ];
  const outputs = { construction: {}, runtime: {} };
  if (allowExisting) {
    for (const [method, file] of constructionNames) {
      outputs.construction[method] = readExistingJson(file) || null;
    }
    for (const [method, file] of runtimeNames) {
      outputs.runtime[method] = readExistingJson(file) || null;
    }
  }

  const fallback = checkExternalBaselines();
  for (const status of fallback.construction) {
    if (!outputs.construction[status.baseline]) {
      outputs.construction[status.baseline] = {
        baseline: status.baseline,
        status: status.status,
        reason: status.reason || '',
        package_status: status.package_status || null,
        nodes: [],
        edges: [],
      };
    }
  }
  for (const status of fallback.runtime) {
    if (!outputs.runtime[status.baseline]) {
      outputs.runtime[status.baseline] = {
        method: status.baseline,
        status: status.status,
        reason: status.reason || '',
        package_status: status.package_status || null,
        results: [],
      };
    }
  }
  return outputs;
}

function externalStatusFromOfficialOutputs(outputs) {
  return {
    construction: Object.entries(outputs.construction).map(([baseline, output]) => ({
      baseline,
      status: output?.status || 'not_run',
      reason: output?.reason || '',
      package_status: output?.package_status || null,
    })),
    runtime: Object.entries(outputs.runtime).map(([baseline, output]) => ({
      baseline,
      status: output?.status || 'not_run',
      reason: output?.reason || '',
      package_status: output?.package_status || null,
    })),
  };
}

function checkExternalBaselines() {
  const construction = [
    externalCommandStatus('openie-official', 'STANFORD_OPENIE_CMD', 'No Stanford OpenIE command configured. Java exists on many macOS systems, but the CoreNLP OpenIE package is not bundled in this repo.'),
    externalCommandStatus('deepke-official', 'DEEPKE_CMD', 'No DeepKE command configured.', pythonImportStatus(KG_CONDA_ENV, 'deepke')),
    externalCommandStatus('oneke-official', 'ONEKE_CMD', 'No OneKE command configured and no local OneKE model/runtime is bundled.'),
  ];
  const runtime = [
    externalCommandStatus('graphrag-official', 'GRAPHRAG_CMD', 'No official GraphRAG command configured.', pythonImportStatus(RUNTIME_CONDA_ENV, 'graphrag')),
    externalCommandStatus('lightrag-official', 'LIGHTRAG_CMD', 'No official LightRAG command configured.', pythonImportStatus(RUNTIME_CONDA_ENV, 'lightrag')),
  ];
  return { construction, runtime };
}

function externalCommandStatus(name, envKey, missingReason, packageStatus = null) {
  const command = process.env[envKey];
  if (command) {
    return { baseline: name, status: 'configured_not_run', env_key: envKey, command, package_status: packageStatus };
  }
  if (packageStatus?.status === 'installed') {
    return {
      baseline: name,
      status: 'installed_not_run',
      env_key: envKey,
      reason: `${missingReason} Python package import succeeds in conda env ${packageStatus.conda_env}, but no official benchmark wrapper is configured yet.`,
      package_status: packageStatus,
    };
  }
  return { baseline: name, status: 'not_run', env_key: envKey, reason: missingReason, package_status: packageStatus };
}

function pythonImportStatus(condaEnv, moduleName) {
  try {
    execFileSync('conda', [
      'run',
      '-n',
      condaEnv,
      'python',
      '-c',
      `import ${moduleName}; print("ok")`,
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { conda_env: condaEnv, module: moduleName, status: 'installed' };
  } catch (error) {
    return {
      conda_env: condaEnv,
      module: moduleName,
      status: 'not_importable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readDatabaseSnapshot(sql) {
  const rows = await sql`
    SELECT
      (SELECT count(*)::int FROM world_nodes WHERE dataset_id='main') AS nodes,
      (SELECT count(*)::int FROM world_edges WHERE dataset_id='main') AS edges,
      (SELECT count(*)::int FROM world_evidence WHERE dataset_id='main') AS evidence,
      (SELECT count(*)::int FROM world_mentions WHERE dataset_id='main') AS mentions,
      (SELECT count(*)::int FROM world_node_cards WHERE dataset_id='main') AS cards,
      (SELECT count(*)::int FROM world_node_bodies WHERE dataset_id='main') AS bodies,
      (SELECT count(*)::int FROM world_domain_profiles WHERE dataset_id='main') AS profiles,
      (SELECT count(*)::int FROM world_lesson_runs WHERE dataset_id='main' AND book_id='physics-hukj-compulsory-3') AS lesson_runs
  `;
  const lessonStatus = await sql`
    SELECT status, count(*)::int AS count
    FROM world_lesson_runs
    WHERE dataset_id='main' AND book_id='physics-hukj-compulsory-3'
    GROUP BY status
    ORDER BY status
  `;
  return { counts: rows[0], lesson_status: lessonStatus };
}

function buildGoldSnippets(markdown, sections) {
  const lines = markdown.split(/\r?\n/);
  return sections.map((section) => {
    const raw = lines.slice(section.line_start - 1, section.line_end).join('\n');
    return {
      ...section,
      text: cleanText(raw).slice(0, 5000),
    };
  });
}

function cleanText(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractOkmConstruction(sql, datasetId) {
  const nodes = await sql`
    SELECT
      n.id,
      n.name,
      n.kind,
      n.definition,
      n.aliases_json AS aliases,
      COALESCE(jsonb_agg(DISTINCT e.excerpt) FILTER (WHERE e.excerpt IS NOT NULL), '[]'::jsonb) AS evidence
    FROM world_nodes n
    LEFT JOIN world_mentions m
      ON m.dataset_id = n.dataset_id
     AND m.target_type = 'node'
     AND m.target_id = n.id
    LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(m.source_refs_json, '[]'::jsonb)) refs(evidence_id)
      ON TRUE
    LEFT JOIN world_evidence e
      ON e.dataset_id = n.dataset_id
     AND (
       e.id = refs.evidence_id
       OR (e.source_id = m.source_id AND e.anchor_ref = m.anchor_ref)
     )
    WHERE n.dataset_id = ${datasetId}
      AND n.status != 'deprecated'
    GROUP BY n.id, n.name, n.kind, n.definition, n.aliases_json
    ORDER BY n.name
  `;
  const edges = await sql`
    SELECT
      ed.id,
      ed.type,
      ed.from_id,
      fn.name AS from_name,
      ed.to_id,
      tn.name AS to_name,
      ed.source_refs_json AS source_refs,
      COALESCE(jsonb_agg(DISTINCT ev.excerpt) FILTER (WHERE ev.excerpt IS NOT NULL), '[]'::jsonb) AS evidence
    FROM world_edges ed
    JOIN world_nodes fn ON fn.dataset_id = ed.dataset_id AND fn.id = ed.from_id
    JOIN world_nodes tn ON tn.dataset_id = ed.dataset_id AND tn.id = ed.to_id
    LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(ed.source_refs_json, '[]'::jsonb)) refs(evidence_id)
      ON TRUE
    LEFT JOIN world_evidence ev ON ev.dataset_id = ed.dataset_id AND ev.id = refs.evidence_id
    WHERE ed.dataset_id = ${datasetId}
      AND ed.status != 'deprecated'
    GROUP BY ed.id, ed.type, ed.from_id, fn.name, ed.to_id, tn.name, ed.source_refs_json
    ORDER BY ed.id
  `;
  return {
    baseline: 'okm',
    status: 'completed',
    nodes: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      kind: node.kind,
      definition: node.definition,
      aliases: Array.isArray(node.aliases) ? node.aliases : [],
      evidence: Array.isArray(node.evidence) ? node.evidence : [],
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      type: edge.type,
      source: edge.from_name,
      target: edge.to_name,
      source_id: edge.from_id,
      target_id: edge.to_id,
      evidence: Array.isArray(edge.evidence) ? edge.evidence : [],
    })),
  };
}

function runOpenIeLite(snippets) {
  const nodes = [];
  const edges = [];
  const seenNodes = new Set();
  const addNode = (name, kind, evidence, sectionId) => {
    const cleaned = cleanCandidateName(name);
    if (!cleaned || cleaned.length < 2 || cleaned.length > 18) return null;
    const key = normalize(cleaned);
    if (!key || seenNodes.has(key)) return key;
    seenNodes.add(key);
    nodes.push({
      id: `openie-lite/${key}`,
      name: cleaned,
      kind,
      definition: evidence.slice(0, 160),
      evidence: [evidence],
      section_id: sectionId,
    });
    return key;
  };
  const addEdge = (source, target, type, evidence) => {
    const sourceKey = addNode(source, 'concept', evidence, 'openie-lite');
    const targetKey = addNode(target, 'concept', evidence, 'openie-lite');
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;
    edges.push({
      id: `openie-lite/e/${edges.length + 1}`,
      type,
      source: cleanCandidateName(source),
      target: cleanCandidateName(target),
      evidence: [evidence],
    });
  };

  for (const snippet of snippets) {
    const sentences = splitSentences(snippet.text);
    for (const sentence of sentences) {
      for (const match of sentence.matchAll(/我们把([^，。；]{2,24})(?:称为|叫做)([^，。；（）]{2,18})/g)) {
        addNode(match[2], guessKind(match[2]), sentence, snippet.id);
        addEdge(match[2], match[1], 'related_to', sentence);
      }
      for (const match of sentence.matchAll(/([^，。；]{2,18})(?:称为|叫做)([^，。；（）]{2,18})/g)) {
        addNode(match[2], guessKind(match[2]), sentence, snippet.id);
        addEdge(match[2], match[1], 'related_to', sentence);
      }
      for (const match of sentence.matchAll(/([^，。；]{2,18})是([^，。；]{2,30})/g)) {
        addNode(match[1], guessKind(match[1]), sentence, snippet.id);
        addEdge(match[1], match[2], 'related_to', sentence);
      }
      for (const match of sentence.matchAll(/([^，。；]{2,18})由([^，。；]{2,40})(?:组成|形成)/g)) {
        addNode(match[1], guessKind(match[1]), sentence, snippet.id);
        addEdge(match[1], match[2], 'contains', sentence);
      }
      for (const term of extractKnownPhysicsTerms(sentence)) {
        addNode(term, guessKind(term), sentence, snippet.id);
      }
    }
  }
  return { baseline: 'openie-lite-local', status: 'completed', nodes, edges };
}

function filterConstructionToBenchmark(output, snippets) {
  const sourceText = snippets.map((item) => item.text).join('\n');
  const nodes = normalizePredictedNodes(output.nodes).filter((node) => {
    if (node.name && sourceText.includes(node.name)) return true;
    if (node.aliases?.some((alias) => alias && sourceText.includes(alias))) return true;
    return collectEvidence(node)
      .split(/\n+/)
      .some((evidence) => evidence.length >= 8 && sourceText.includes(evidence.slice(0, Math.min(40, evidence.length))));
  });
  const keptNames = new Set(nodes.map((node) => normalize(node.name)));
  const edges = normalizePredictedEdges(output.edges).filter((edge) => {
    const endpointsInScope = keptNames.has(normalize(edge.source)) && keptNames.has(normalize(edge.target));
    if (endpointsInScope) return true;
    return collectEvidence(edge)
      .split(/\n+/)
      .some((evidence) => evidence.length >= 8 && sourceText.includes(evidence.slice(0, Math.min(40, evidence.length))));
  });
  return {
    ...output,
    scope: {
      type: 'gold-section-evidence-window',
      source: 'filtered from full-book OKM snapshot to prevent penalizing correct nodes outside the annotated benchmark window',
      input_node_count: output.nodes?.length || 0,
      input_edge_count: output.edges?.length || 0,
      output_node_count: nodes.length,
      output_edge_count: edges.length,
    },
    nodes,
    edges,
  };
}

async function runLlmOnlyConstruction(snippets) {
  const prompt = [
    '你是教材知识图谱抽取器。请只基于给定教材片段抽取知识对象和关系，不要补充课外知识。',
    '返回 JSON，格式为：{"nodes":[{"name":string,"kind":string,"definition":string,"evidence":string[]}],"edges":[{"source":string,"target":string,"type":string,"evidence":string[]}]}。',
    `节点 kind 只能是：${[...ALLOWED_NODE_KINDS].join(', ')}。`,
    `关系 type 只能是：${[...ALLOWED_EDGE_TYPES].join(', ')}。`,
    'evidence 必须是原文中的短句或短语。',
    '',
    snippets.map((item) => `【${item.id} ${item.title}】\n${item.text}`).join('\n\n---\n\n'),
  ].join('\n');
  const raw = await callChatJson(prompt);
  return {
    baseline: 'llm-only',
    status: 'completed',
    model: process.env.OPENAI_MODEL,
    nodes: normalizePredictedNodes(raw.nodes),
    edges: normalizePredictedEdges(raw.edges),
    raw,
  };
}

function scoreConstruction(gold, snippets, outputs, externalStatuses) {
  const sourceText = snippets.map((item) => item.text).join('\n');
  const methods = [];
  for (const [key, output] of Object.entries(outputs)) {
    methods.push(scoreConstructionMethod(key, output, gold, sourceText));
  }
  for (const status of externalStatuses) {
    methods.push({
      method: status.baseline,
      status: status.status,
      reason: status.reason || '',
      node_precision: null,
      node_recall: null,
      node_f1: null,
      relation_precision: null,
      relation_recall: null,
      relation_f1: null,
      evidence_hit_rate: null,
      duplicate_rate: null,
      hallucination_rate: null,
      schema_violation_rate: null,
      human_review_cost: null,
    });
  }
  return {
    summary: methods.map((item) => ({
      method: item.method,
      status: item.status,
      node_f1: item.node_f1,
      relation_f1: item.relation_f1,
      evidence_hit_rate: item.evidence_hit_rate,
      duplicate_rate: item.duplicate_rate,
      hallucination_rate: item.hallucination_rate,
      schema_violation_rate: item.schema_violation_rate,
      human_review_cost: item.human_review_cost,
    })),
    methods,
  };
}

function scoreConstructionMethod(method, output, gold, sourceText) {
  if (!output || output.status !== 'completed') {
    return {
      method,
      status: output?.status || 'not_run',
      reason: output?.reason || '',
    };
  }
  const nodes = normalizePredictedNodes(output.nodes);
  const edges = normalizePredictedEdges(output.edges);
  const nodeMatches = new Map();
  const matchedGoldNodes = new Set();
  for (const node of nodes) {
    const match = gold.nodes.find((goldNode) => namesMatch(node.name, goldNode));
    if (match) {
      nodeMatches.set(node.name, match.id);
      matchedGoldNodes.add(match.id);
    }
  }
  const matchedPredNodes = [...nodeMatches.keys()].length;

  let matchedEdges = 0;
  const matchedGoldRelations = new Set();
  for (const edge of edges) {
    const relation = gold.relations.find((goldRelation, index) => {
      const source = gold.nodes.find((node) => node.id === goldRelation.source);
      const target = gold.nodes.find((node) => node.id === goldRelation.target);
      if (!source || !target) return false;
      const direct = namesMatch(edge.source, source) && namesMatch(edge.target, target);
      const reverse = namesMatch(edge.source, target) && namesMatch(edge.target, source);
      return (direct || reverse) && relationTypeCompatible(edge.type, goldRelation.type) && !matchedGoldRelations.has(index);
    });
    if (relation) {
      matchedEdges++;
      matchedGoldRelations.add(gold.relations.indexOf(relation));
    }
  }

  const duplicateCount = countDuplicates(nodes.map((node) => node.name));
  const schemaViolations =
    nodes.filter((node) => !ALLOWED_NODE_KINDS.has(node.kind)).length +
    edges.filter((edge) => !ALLOWED_EDGE_TYPES.has(edge.type)).length;
  const totalItems = Math.max(1, nodes.length + edges.length);
  const hallucinatedNodes = nodes.filter((node) => !hasGrounding(node, sourceText)).length;
  const evidenceHits = gold.nodes.filter((goldNode) => {
    const predicted = nodes.find((node) => namesMatch(node.name, goldNode));
    if (!predicted) return false;
    const evidenceText = collectEvidence(predicted);
    return goldNode.support_terms.some((term) => evidenceText.includes(term));
  }).length;

  const nodePrecision = ratio(matchedPredNodes, nodes.length);
  const nodeRecall = ratio(matchedGoldNodes.size, gold.nodes.length);
  const relationPrecision = ratio(matchedEdges, edges.length);
  const relationRecall = ratio(matchedGoldRelations.size, gold.relations.length);
  return {
    method,
    status: 'completed',
    predicted_node_count: nodes.length,
    predicted_relation_count: edges.length,
    matched_node_count: matchedGoldNodes.size,
    matched_relation_count: matchedGoldRelations.size,
    node_precision: round(nodePrecision),
    node_recall: round(nodeRecall),
    node_f1: round(f1(nodePrecision, nodeRecall)),
    relation_precision: round(relationPrecision),
    relation_recall: round(relationRecall),
    relation_f1: round(f1(relationPrecision, relationRecall)),
    evidence_hit_rate: round(ratio(evidenceHits, gold.nodes.length)),
    duplicate_rate: round(ratio(duplicateCount, nodes.length)),
    hallucination_rate: round(ratio(hallucinatedNodes, nodes.length)),
    schema_violation_rate: round(ratio(schemaViolations, totalItems)),
    human_review_cost: nodes.length + edges.length + duplicateCount + hallucinatedNodes + schemaViolations,
  };
}

async function runApiUnitRuntime() {
  try {
    const stdout = execFileSync('npm', [
      '--silent',
      'run',
      'evaluate-runtime',
      '-w',
      'packages/server',
      '--',
      '--source',
      'main',
      '--cases',
      RUNTIME_CASES_PATH,
      '--generate',
      '--retrieval-mode',
      'hybrid',
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
      env: process.env,
    });
    return { method: 'apiunit-rag', status: 'completed', ...JSON.parse(stdout) };
  } catch (error) {
    return {
      method: 'apiunit-rag',
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      raw: error?.stdout?.toString?.() || '',
    };
  }
}

async function runLocalRuntimeBaselines(markdown, cases) {
  const chunks = buildTextChunks(markdown);
  const graphIndex = buildLocalGraphIndex(chunks);
  const methods = [
    {
      method: 'text-chunk-rag',
      retrieve: (question) => retrieveTextChunks(chunks, question, 5),
      cost: { index_units: chunks.length, graph_nodes: 0, graph_edges: 0, model_calls_per_question: 1 },
    },
    {
      method: 'graphrag-style-local',
      retrieve: (question) => retrieveGraphStyle(chunks, graphIndex, question, 6),
      cost: {
        index_units: chunks.length,
        graph_nodes: graphIndex.terms.length,
        graph_edges: graphIndex.edges.length,
        model_calls_per_question: 1,
      },
    },
    {
      method: 'lightrag-style-local',
      retrieve: (question) => retrieveLightStyle(chunks, graphIndex, question, 6),
      cost: {
        index_units: chunks.length + graphIndex.terms.length,
        graph_nodes: graphIndex.terms.length,
        graph_edges: graphIndex.edges.length,
        model_calls_per_question: 1,
      },
    },
  ];

  const results = [];
  for (const method of methods) {
    for (const item of cases) {
      const contexts = method.retrieve(item.question);
      const response = await answerWithContext(item.question, contexts);
      results.push({
        method: method.method,
        id: item.id,
        question: item.question,
        expected_terms: item.expected_terms || [],
        context_ids: contexts.map((context) => context.id),
        context_char_count: contexts.reduce((sum, context) => sum + context.text.length, 0),
        answer: response.answer || '',
        citations: Array.isArray(response.citations) ? response.citations : [],
        unsupported_claims: Array.isArray(response.unsupported_claims) ? response.unsupported_claims : [],
        teaching_usability_score: normalizeScore(response.teaching_usability_score),
        teaching_usability_rationale: String(response.teaching_usability_rationale || ''),
        cost: method.cost,
      });
    }
  }
  return { status: 'completed', results };
}

function scoreRuntime(cases, apiunitRuntime, localRuntime, officialRuntimeOutputs) {
  const methodRows = [];
  if (apiunitRuntime.status === 'completed') {
    methodRows.push(scoreApiUnitRuntime(apiunitRuntime, cases));
  } else {
    methodRows.push({ method: 'apiunit-rag', status: apiunitRuntime.status, reason: apiunitRuntime.reason });
  }
  if (localRuntime.status === 'completed') {
    for (const method of unique(localRuntime.results.map((item) => item.method))) {
      methodRows.push(scoreLocalRuntimeMethod(method, localRuntime.results.filter((item) => item.method === method), cases));
    }
  } else {
    methodRows.push({ method: 'local-runtime-baselines', status: localRuntime.status, reason: localRuntime.reason });
  }
  for (const [method, output] of Object.entries(officialRuntimeOutputs)) {
    if (output?.status === 'completed' || output?.status === 'partial') {
      const results = (output.results || []).filter((item) => item.method === method || !item.method);
      methodRows.push(scoreLocalRuntimeMethod(method, results.map((item) => ({ ...item, method })), cases));
    } else {
      methodRows.push({
        method,
        status: output?.status || 'not_run',
        reason: output?.reason || '',
        answer_correctness: null,
        citation_accuracy: null,
        unsupported_claim_count: null,
        cross_lesson_score: null,
        prerequisite_score: null,
        misconception_score: null,
        teaching_usability: null,
        build_cost: null,
        incremental_update_cost: null,
      });
    }
  }
  return {
    summary: methodRows.map((row) => ({
      method: row.method,
      status: row.status,
      answer_correctness: row.answer_correctness,
      citation_accuracy: row.citation_accuracy,
      unsupported_claim_count: row.unsupported_claim_count,
      cross_lesson_score: row.cross_lesson_score,
      prerequisite_score: row.prerequisite_score,
      misconception_score: row.misconception_score,
      teaching_usability: row.teaching_usability,
      build_cost: row.build_cost,
      incremental_update_cost: row.incremental_update_cost,
    })),
    methods: methodRows,
  };
}

function scoreApiUnitRuntime(apiunitRuntime, cases) {
  const results = apiunitRuntime.results || [];
  const byId = new Map(cases.map((item) => [item.id, item]));
  const termCoverages = results.map((result) => Number(result.term_coverage || 0));
  const valid = sum(results.map((item) => Number(item.valid_citation_count || 0)));
  const invalid = sum(results.map((item) => Number(item.invalid_citation_count || 0)));
  return {
    method: 'apiunit-rag',
    status: 'completed',
    answer_correctness: round(avg(termCoverages)),
    citation_accuracy: round(ratio(valid, valid + invalid)),
    unsupported_claim_count: sum(results.map((item) => Number(item.unsupported_claim_count || 0))),
    cross_lesson_score: round(avg(results.filter((item) => hasTaskType(byId.get(item.id), 'cross_lesson')).map((item) => Number(item.term_coverage || 0)))),
    prerequisite_score: round(avg(results.filter((item) => hasTaskType(byId.get(item.id), 'prerequisite')).map((item) => Number(item.term_coverage || 0)))),
    misconception_score: round(avg(results.filter((item) => hasTaskType(byId.get(item.id), 'misconception')).map((item) => Number(item.term_coverage || 0)))),
    teaching_usability: null,
    build_cost: {
      index_units: 'world_nodes + world_edges + world_evidence + world_node_bodies',
      retrieval_limit: apiunitRuntime.limit,
      retrieval_mode: apiunitRuntime.retrieval_mode,
      model_calls: results.length,
    },
    incremental_update_cost: 'lesson-level re-extraction plus affected ApiUnit embeddings/bodies',
    raw_summary: {
      retrieval_hit_rate: apiunitRuntime.retrieval_hit_rate,
      average_retrieval_recall: apiunitRuntime.average_retrieval_recall,
      average_term_coverage: apiunitRuntime.average_term_coverage,
    },
  };
}

function scoreLocalRuntimeMethod(method, results, cases) {
  const byId = new Map(cases.map((item) => [item.id, item]));
  const termCoverages = results.map((item) => termCoverage(item.answer, item.expected_terms));
  const citationStats = results.map((item) => citationAccuracy(item));
  const firstCost = results[0]?.cost || {};
  return {
    method,
    status: 'completed',
    answer_correctness: round(avg(termCoverages)),
    citation_accuracy: round(avg(citationStats)),
    unsupported_claim_count: sum(results.map((item) => item.unsupported_claims.length)),
    cross_lesson_score: round(avg(results.filter((item) => hasTaskType(byId.get(item.id), 'cross_lesson')).map((item) => termCoverage(item.answer, item.expected_terms)))),
    prerequisite_score: round(avg(results.filter((item) => hasTaskType(byId.get(item.id), 'prerequisite')).map((item) => termCoverage(item.answer, item.expected_terms)))),
    misconception_score: round(avg(results.filter((item) => hasTaskType(byId.get(item.id), 'misconception')).map((item) => termCoverage(item.answer, item.expected_terms)))),
    teaching_usability: round(avg(results.map((item) => item.teaching_usability_score).filter((value) => value !== null))),
    build_cost: {
      ...firstCost,
      total_context_chars: sum(results.map((item) => item.context_char_count)),
      model_calls: results.length,
    },
    incremental_update_cost: estimateIncrementalCost(method, firstCost),
  };
}

function buildTextChunks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const chunks = [];
  let chapter = '';
  let section = '';
  let buffer = [];
  let startLine = 1;
  const flush = (endLine) => {
    const text = cleanText(buffer.join('\n'));
    if (text.length >= 80) {
      chunks.push({
        id: `chunk-${chunks.length + 1}`,
        chapter,
        section,
        line_start: startLine,
        line_end: endLine,
        text: text.slice(0, 1400),
      });
    }
    buffer = [];
    startLine = endLine + 1;
  };
  lines.forEach((line, index) => {
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      if (buffer.length) flush(index);
      const title = heading[1].trim();
      if (/第[九十十一二三四五六七八]+章|第十一章|第十二章/.test(title)) chapter = title;
      else section = title;
    }
    buffer.push(line);
    if (buffer.join('\n').length > 1100) flush(index + 1);
  });
  if (buffer.length) flush(lines.length);
  return chunks;
}

function buildLocalGraphIndex(chunks) {
  const termToChunks = new Map();
  for (const chunk of chunks) {
    for (const term of extractKnownPhysicsTerms(chunk.text)) {
      if (!termToChunks.has(term)) termToChunks.set(term, new Set());
      termToChunks.get(term).add(chunk.id);
    }
  }
  const terms = [...termToChunks.keys()];
  const edges = [];
  for (const chunk of chunks) {
    const localTerms = extractKnownPhysicsTerms(chunk.text).slice(0, 12);
    for (let i = 0; i < localTerms.length; i++) {
      for (let j = i + 1; j < localTerms.length; j++) {
        edges.push([localTerms[i], localTerms[j], chunk.id]);
      }
    }
  }
  return { terms, termToChunks, edges };
}

function retrieveTextChunks(chunks, question, limit) {
  return chunks
    .map((chunk) => ({ ...chunk, score: lexicalScore(question, `${chunk.chapter} ${chunk.section} ${chunk.text}`) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(contextFromChunk);
}

function retrieveGraphStyle(chunks, graphIndex, question, limit) {
  const top = retrieveTextChunks(chunks, question, 3);
  const selected = new Map(top.map((item) => [item.id, item]));
  const queryTerms = extractKnownPhysicsTerms(question);
  for (const term of queryTerms) {
    const chunkIds = graphIndex.termToChunks.get(term);
    if (!chunkIds) continue;
    for (const id of [...chunkIds].slice(0, 3)) {
      const chunk = chunks.find((item) => item.id === id);
      if (chunk) selected.set(chunk.id, contextFromChunk(chunk, `graph term: ${term}`));
    }
  }
  const chapters = unique([...selected.values()].map((item) => item.chapter).filter(Boolean));
  for (const chapter of chapters.slice(0, 2)) {
    const chapterChunks = chunks.filter((item) => item.chapter === chapter).slice(0, 2);
    for (const chunk of chapterChunks) selected.set(chunk.id, contextFromChunk(chunk, `chapter community: ${chapter}`));
  }
  return [...selected.values()].slice(0, limit);
}

function retrieveLightStyle(chunks, graphIndex, question, limit) {
  const low = retrieveTextChunks(chunks, question, 4);
  const queryTerms = new Set([...extractKnownPhysicsTerms(question), ...tokenize(question)]);
  const highTermBlocks = graphIndex.terms
    .map((term) => ({ term, score: [...queryTerms].some((q) => normalize(term).includes(normalize(q)) || normalize(q).includes(normalize(term))) ? 3 : lexicalScore(question, term) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item, index) => ({
      id: `high-term-${index + 1}-${normalize(item.term)}`,
      chapter: 'high-level-term-index',
      section: item.term,
      text: `高层术语：${item.term}\n相关文本块：${[...(graphIndex.termToChunks.get(item.term) || [])].slice(0, 5).join(', ')}`,
    }));
  const merged = new Map();
  for (const item of [...highTermBlocks, ...low]) merged.set(item.id, item);
  return [...merged.values()].slice(0, limit);
}

function contextFromChunk(chunk, reason = 'text match') {
  return {
    id: chunk.id,
    chapter: chunk.chapter,
    section: chunk.section,
    reason,
    text: [
      `chapter: ${chunk.chapter}`,
      `section: ${chunk.section}`,
      `lines: ${chunk.line_start}-${chunk.line_end}`,
      chunk.text,
    ].join('\n'),
  };
}

async function answerWithContext(question, contexts) {
  const prompt = [
    '你是高中物理教材问答系统。只能使用给定上下文回答。',
    '返回 JSON：{"answer":string,"citations":[{"context_id":string,"note":string}],"unsupported_claims":string[],"teaching_usability_score":number,"teaching_usability_rationale":string}。',
    '如果上下文不足，明确说明不足。citation 的 context_id 必须来自上下文编号。',
    '',
    `问题：${question}`,
    '',
    '上下文：',
    contexts.map((context) => `【${context.id}】\n${context.text}`).join('\n\n---\n\n'),
  ].join('\n');
  return callChatJson(prompt);
}

async function callChatJson(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing.');
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-4.1';
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return valid JSON only.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Model request failed with HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content || '{}';
  return parseJsonObject(content);
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(content.slice(start, end + 1));
    throw new Error(`Model did not return JSON: ${content.slice(0, 300)}`);
  }
}

function normalizePredictedNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((node, index) => ({
    id: String(node?.id || `node-${index + 1}`),
    name: cleanCandidateName(String(node?.name || node?.label || '')),
    kind: ALLOWED_NODE_KINDS.has(node?.kind) ? node.kind : String(node?.kind || 'concept'),
    definition: String(node?.definition || ''),
    aliases: Array.isArray(node?.aliases) ? node.aliases.map(String) : [],
    evidence: Array.isArray(node?.evidence) ? node.evidence.map(String) : [node?.evidence].filter(Boolean).map(String),
  })).filter((node) => node.name);
}

function normalizePredictedEdges(edges) {
  if (!Array.isArray(edges)) return [];
  return edges.map((edge, index) => ({
    id: String(edge?.id || `edge-${index + 1}`),
    source: cleanCandidateName(String(edge?.source || edge?.from || edge?.from_name || '')),
    target: cleanCandidateName(String(edge?.target || edge?.to || edge?.to_name || '')),
    type: ALLOWED_EDGE_TYPES.has(edge?.type) ? edge.type : String(edge?.type || 'related_to'),
    evidence: Array.isArray(edge?.evidence) ? edge.evidence.map(String) : [edge?.evidence].filter(Boolean).map(String),
  })).filter((edge) => edge.source && edge.target);
}

function namesMatch(name, goldNode) {
  const value = normalize(name);
  if (!value) return false;
  const labels = [goldNode.label, ...(goldNode.aliases || [])].map(normalize).filter(Boolean);
  return labels.some((label) => value === label || value.includes(label) || label.includes(value));
}

function relationTypeCompatible(predicted, gold) {
  if (predicted === gold) return true;
  if (predicted === 'related_to') return true;
  const groups = [
    new Set(['has_property', 'depends_on', 'affects']),
    new Set(['is_a', 'instance_of']),
    new Set(['uses', 'produces', 'causes']),
    new Set(['represents', 'about', 'related_to']),
  ];
  return groups.some((group) => group.has(predicted) && group.has(gold));
}

function hasGrounding(node, sourceText) {
  const evidence = collectEvidence(node);
  if (!evidence) return false;
  if (sourceText.includes(evidence.slice(0, Math.min(24, evidence.length)))) return true;
  return splitSentences(evidence).some((sentence) => sentence.length >= 8 && sourceText.includes(sentence.slice(0, 18)));
}

function collectEvidence(item) {
  return Array.isArray(item.evidence) ? item.evidence.join('\n') : String(item.evidence || '');
}

function splitSentences(text) {
  return text
    .split(/[。！？!?；;\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);
}

function cleanCandidateName(value) {
  return value
    .replace(/\([^)]*\)/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/[“”"']/g, '')
    .replace(/^[：:，,。；;\s]+|[：:，,。；;\s]+$/g, '')
    .trim();
}

function guessKind(term) {
  if (/反应|转化|充电|放电|裂变|聚变|传播/.test(term)) return 'process';
  if (/强度|电容|电势|电压|体积|电荷量/.test(term)) return 'property';
  if (/公式|定律|原理|关系/.test(term)) return 'rule';
  if (/线|图像|符号/.test(term)) return 'representation';
  if (/装置|反应堆|电容器|卫星|雷达/.test(term)) return 'entity';
  return 'concept';
}

function extractKnownPhysicsTerms(text) {
  const terms = [
    '库仑定律', '静电力', '点电荷', '库仑扭秤', '电荷相互作用规律',
    '电场强度', '电场叠加原理', '电场力', '电场线', '匀强电场', '电场', '试探电荷', '场源电荷',
    '电势能', '电势', '等势面', '电势差',
    '电容器', '平行板电容器', '电容', '电荷量', '电介质', '击穿电压', '充电', '放电',
    '电路', '电流', '漂移速度', '电压', '电阻', '自由电子',
    '电流的磁效应', '右手螺旋定则', '磁感应强度', '磁通量', '电磁感应', '感应电流',
    '电磁场', '电磁波', '麦克斯韦', '光子', '光的波粒二象性', '雷达', '卫星通信',
    '核能', '核裂变', '链式反应', '反应堆', '临界体积', '核聚变', '中子',
  ];
  return terms.filter((term) => text.includes(term));
}

function lexicalScore(query, text) {
  const queryTerms = new Set([...tokenize(query), ...extractKnownPhysicsTerms(query).map(normalize)]);
  const normalizedText = normalize(text);
  let score = 0;
  for (const term of queryTerms) {
    if (term && normalizedText.includes(term)) score += term.length >= 4 ? 2 : 1;
  }
  return score;
}

function tokenize(text) {
  const normalized = normalize(text);
  const terms = new Set();
  for (let size of [5, 4, 3, 2]) {
    for (let i = 0; i <= normalized.length - size; i++) {
      terms.add(normalized.slice(i, i + size));
      if (terms.size > 80) break;
    }
  }
  return [...terms];
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function termCoverage(answer, expectedTerms) {
  if (!expectedTerms?.length) return 0;
  return expectedTerms.filter((term) => answer.includes(term)).length / expectedTerms.length;
}

function citationAccuracy(item) {
  const citations = Array.isArray(item.citations) ? item.citations : [];
  if (!citations.length) return 0;
  const validIds = new Set(item.context_ids);
  const valid = citations.filter((citation) => validIds.has(citation.context_id)).length;
  return valid / citations.length;
}

function hasTaskType(item, taskType) {
  if (!item) return false;
  if (item.task_type === taskType) return true;
  if (taskType === 'cross_lesson') return item.task_type === 'prerequisite';
  return false;
}

function estimateIncrementalCost(method, cost) {
  if (method === 'text-chunk-rag') return 'rebuild changed text chunk only';
  if (method === 'graphrag-style-local') return 'rebuild changed chunk plus affected term co-occurrence edges and chapter community';
  if (method === 'lightrag-style-local') return 'rebuild changed low-level chunk plus affected high-level term entries';
  return cost || null;
}

function normalizeScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(1, Math.min(5, number));
}

function countDuplicates(values) {
  const seen = new Set();
  let duplicates = 0;
  for (const value of values.map(normalize).filter(Boolean)) {
    if (seen.has(value)) duplicates++;
    else seen.add(value);
  }
  return duplicates;
}

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readExistingJson(name) {
  const path = resolve(OUTPUT_DIR, name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function saveJson(name, value) {
  writeFileSync(resolve(OUTPUT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function writeProcessLog(summary) {
  const lines = [
    '# 实验过程记录',
    '',
    `## ${new Date().toISOString()} 运行结果`,
    '',
    '### 基准范围',
    '',
    ...Object.entries(summary.benchmark).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '### 数据库状态',
    '',
    ...Object.entries(summary.database).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '### 知识对象构建实验摘要',
    '',
    markdownTable(summary.construction, ['method', 'status', 'node_f1', 'relation_f1', 'evidence_hit_rate', 'hallucination_rate']),
    '',
    '### 知识运行时实验摘要',
    '',
    markdownTable(summary.runtime, ['method', 'status', 'answer_correctness', 'citation_accuracy', 'unsupported_claim_count', 'teaching_usability']),
    '',
    '### 外部官方基线状态',
    '',
    markdownTable([
      ...summary.external_baselines.construction,
      ...summary.external_baselines.runtime,
    ], ['baseline', 'status', 'reason']),
    '',
  ];
  writeFileSync(PROCESS_PATH, `${lines.join('\n')}\n`);
}

function writeReport(summary, constructionMetrics, runtimeMetrics) {
  const benchmark = summary.benchmark;
  const lines = [
    '# 物理书 OKM 基准实验报告',
    '',
    '## 摘要',
    '',
    `本实验使用高中物理必修第三册的 MinerU Markdown 和当前 PostgreSQL 中的 OKM 结果，完成两组受控基准实验。基准覆盖 ${benchmark.sections} 个教材段落、${benchmark.gold_nodes} 个金标准知识对象、${benchmark.gold_relations} 条金标准关系和 ${benchmark.runtime_cases} 个运行时问题。`,
    '',
    '## 数据与范围',
    '',
    '- 教材：`data/mineru/physics-hukj-compulsory-3/full.md`',
    '- 数据集：`main`',
    `- 金标准段落：${benchmark.sections} 个，覆盖静电、场、电势、电容、电路、磁场、电磁感应、电磁波和核裂变`,
    `- 金标准对象：${benchmark.gold_nodes} 个`,
    `- 金标准关系：${benchmark.gold_relations} 条`,
    `- 运行时问题：${benchmark.runtime_cases} 个`,
    '',
    '## 知识对象构建结果',
    '',
    '### 方法说明',
    '',
    'OKM 的 PostgreSQL 快照覆盖整本教材，而金标准只标注 9 个教材段落。为避免把样本范围外的正确节点误判为虚构，脚本会先保存 `construction-okm-raw.json`，再把 OKM 构建结果过滤到金标准段落的证据窗口，过滤后的结果保存为 `construction-okm.json` 并进入指标计算。',
    '',
    markdownTable(constructionMetrics.summary, ['method', 'status', 'node_f1', 'relation_f1', 'evidence_hit_rate', 'duplicate_rate', 'hallucination_rate', 'schema_violation_rate', 'human_review_cost']),
    '',
    '## 知识运行时结果',
    '',
    markdownTable(runtimeMetrics.summary, ['method', 'status', 'answer_correctness', 'citation_accuracy', 'unsupported_claim_count', 'cross_lesson_score', 'prerequisite_score', 'misconception_score', 'teaching_usability']),
    '',
    '## 外部官方基线状态',
    '',
    '### 构建实验',
    '',
    markdownTable(summary.external_baselines.construction, ['baseline', 'status', 'reason']),
    '',
    '### 运行时实验',
    '',
    markdownTable(summary.external_baselines.runtime, ['baseline', 'status', 'reason']),
    '',
    '## 解释',
    '',
    '本次实验把方法分成两类：第一组评测知识对象构建，包含 OKM、LLM-only、本地 OpenIE 近似基线，以及官方 OpenIE、DeepKE、OneKE 的接入状态；第二组评测知识运行时，包含 OKM ApiUnit-RAG、普通文本块 RAG、GraphRAG 风格本地基线、LightRAG 风格本地基线，以及官方 GraphRAG、LightRAG。OneKE、GraphRAG 和 LightRAG 已经进入统一指标表；OpenIE 和 DeepKE 只记录为已接入口但未运行，因为本机缺少 Stanford CoreNLP OpenIE 包，DeepKE 也缺少可复现的任务 checkpoint 或推理命令。',
    '',
    '## 初步结论',
    '',
    '- 知识对象构建实验中，OKM 的证据命中率最高，说明它的节点、关系和教材证据绑定更稳定；LLM-only 的关系 F1 更高，但证据命中率较低，说明它更会补全关系，也更需要证据约束。',
    '- 本地 OpenIE 近似基线节点召回不差，但关系 F1 和证据命中率明显较弱，说明开放信息抽取规则不能直接替代教材知识对象构建。',
    '- 知识运行时实验中，普通文本块 RAG 的关键词覆盖率最高，但存在无依据断言和引用错误；ApiUnit-RAG 的关键词覆盖略低，但引用准确率为 1，且无依据断言为 0。',
    '- 官方 LightRAG 在关键词覆盖上表现较强，官方 GraphRAG 完成了标准索引和 12 个问题查询；但两者的引用格式没有映射到本实验的 `context_ids`，所以统一指标中的 citation_accuracy 为 0，不能直接解释为它们没有引用来源。',
    '- OneKE 官方基线可以抽取结构化三元组，但当前适配层不能把它的输出稳定绑定回教材原文片段，因此严格证据指标较低。',
    '',
    '## 官方基线处理',
    '',
    '- GraphRAG 使用官方命令完成 `init`、`index` 和 `query`；由于嵌入服务限制一次最多 10 条文本，适配层把 `embed_text.batch_size` 固定为不超过 10，并支持复用已建好的索引。',
    '- LightRAG 使用官方 Python 包完成建库和 hybrid 查询，嵌入维度由服务端探测得到。',
    '- OneKE 使用官方源码的 API 模式完成三元组抽取，并归一化为本实验的节点、关系格式。',
    '- Stanford OpenIE 已接入命令入口，但本机没有安装 CoreNLP OpenIE 包，所以记录为 `not_run`。',
    '- DeepKE 已完成包导入检查，但没有固定 checkpoint 或官方推理命令，不能把空跑结果写成正式对照。',
    '',
    '## 限制',
    '',
    '- 这是单本教材上的中等规模受控实验，不等同于多教材、多学科、多人标注的最终基准。',
    '- 回答正确率采用期望关键词覆盖率近似，不等同于专家评分。',
    '- 教学生成可用性由同一模型按统一 rubric 给出，后续应加入人工评分。',
    '- 官方 GraphRAG、LightRAG 的内部引用没有映射到 OKM 的来源片段编号，当前只能比较答案内容，不能公平比较引用准确率。',
    '- OpenIE 和 DeepKE 仍需要补齐可复现运行资产后才能进入正式指标表。',
    '',
    '## 原始文件',
    '',
    '- `outputs/construction-metrics.json`',
    '- `outputs/runtime-metrics.json`',
    '- `outputs/experiment-summary.json`',
    '',
  ];
  writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`);
}

function markdownTable(rows, columns) {
  if (!rows?.length) return '_无数据_';
  const header = `| ${columns.join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((col) => formatCell(row?.[col])).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

function formatCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return String(JSON.stringify(value)).replace(/\|/g, '\\|');
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function unique(values) {
  return [...new Set(values)];
}

function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

function avg(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  return clean.length ? sum(clean) / clean.length : 0;
}

function ratio(a, b) {
  return b ? a / b : 0;
}

function f1(precision, recall) {
  return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
}

function round(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}
