#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(EXP_DIR, '..', '..');
const OUTPUT_DIR = resolve(EXP_DIR, 'outputs');
const WORK_DIR = resolve(EXP_DIR, 'external', 'work');
const CACHE_DIR = resolve(EXP_DIR, 'external', 'cache');
const SNIPPETS_PATH = resolve(OUTPUT_DIR, 'gold-snippets.json');
const RUNTIME_CASES_PATH = resolve(EXP_DIR, 'fixtures', 'runtime-cases.jsonl');
const GOLD_PATH = resolve(EXP_DIR, 'fixtures', 'gold-construction.json');
const RUNTIME_CONDA_ENV = 'okm-runtime-benchmark-20260701';
const KG_CONDA_ENV = 'okm-kg-benchmark-20260701';
const ONEKE_CONDA_ENV = 'okm-oneke-benchmark-20260701';

const args = new Set(process.argv.slice(2));
const constructionOnly = args.has('--construction-only');
const runtimeOnly = args.has('--runtime-only');
const only = readOption('--only');

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(WORK_DIR, { recursive: true });
  loadEnv();

  const gold = JSON.parse(readFileSync(GOLD_PATH, 'utf8'));
  const snippets = readJson(SNIPPETS_PATH);
  const markdownPath = resolve(REPO_ROOT, gold.source_markdown);
  const markdown = readFileSync(markdownPath, 'utf8');
  const cases = readJsonl(RUNTIME_CASES_PATH);

  const summary = {
    generated_at: new Date().toISOString(),
    selection: {
      construction_only: constructionOnly,
      runtime_only: runtimeOnly,
      only: only || null,
    },
    construction: {},
    runtime: {},
  };

  if (!runtimeOnly) {
    if (shouldRun('openie-official')) summary.construction['openie-official'] = runStanfordOpenIe(snippets);
    if (shouldRun('deepke-official')) summary.construction['deepke-official'] = runDeepKe(snippets);
    if (shouldRun('oneke-official')) summary.construction['oneke-official'] = runOneKe(snippets);
  }

  if (!constructionOnly) {
    if (shouldRun('graphrag-official')) summary.runtime['graphrag-official'] = runGraphRag(officialRuntimeCorpus(markdown, snippets), cases);
    if (shouldRun('lightrag-official')) summary.runtime['lightrag-official'] = runLightRag(markdownPath, cases);
  }

  mergeExistingOfficialOutputs(summary);
  saveJson('official-baseline-run.json', summary);
  console.log(JSON.stringify(redactSummary(summary), null, 2));
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

function readOption(name) {
  const argv = process.argv.slice(2);
  const exact = argv.indexOf(name);
  if (exact >= 0) return argv[exact + 1] || '';
  const prefixed = argv.find((item) => item.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : '';
}

function shouldRun(name) {
  return !only || only === name;
}

function mergeExistingOfficialOutputs(summary) {
  const constructionFiles = {
    'openie-official': 'construction-openie-official.json',
    'deepke-official': 'construction-deepke-official.json',
    'oneke-official': 'construction-oneke-official.json',
  };
  const runtimeFiles = {
    'graphrag-official': 'runtime-graphrag-official.json',
    'lightrag-official': 'runtime-lightrag-official.json',
  };
  for (const [name, file] of Object.entries(constructionFiles)) {
    const path = resolve(OUTPUT_DIR, file);
    if (!summary.construction[name] && existsSync(path)) {
      summary.construction[name] = readJson(path);
    }
  }
  for (const [name, file] of Object.entries(runtimeFiles)) {
    const path = resolve(OUTPUT_DIR, file);
    if (!summary.runtime[name] && existsSync(path)) {
      summary.runtime[name] = readJson(path);
    }
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function officialRuntimeCorpus(markdown, snippets) {
  if (process.env.OFFICIAL_RUNTIME_CORPUS === 'full') return markdown;
  return snippets.map((item) => `# ${item.title}\n\n${item.text}`).join('\n\n---\n\n');
}

function runStanfordOpenIe(snippets) {
  const outName = 'construction-openie-official.json';
  const inputPath = resolve(WORK_DIR, 'stanford-openie-input.txt');
  writeFileSync(inputPath, snippets.map((item) => item.text).join('\n\n'), 'utf8');

  const command = process.env.STANFORD_OPENIE_CMD;
  const coreNlpHome = process.env.STANFORD_CORENLP_HOME || process.env.CORENLP_HOME || findCoreNlpHome();
  if (!command && !coreNlpHome) {
    const output = {
      baseline: 'openie-official',
      status: 'not_run',
      reason: 'Stanford CoreNLP OpenIE is not installed. Set STANFORD_CORENLP_HOME or STANFORD_OPENIE_CMD to run the official Java OpenIE baseline.',
      java: commandStatus('java', ['-version']),
      nodes: [],
      edges: [],
    };
    saveJson(outName, output);
    return output;
  }

  try {
    const stdout = command
      ? execShell(command, { input: readFileSync(inputPath, 'utf8'), cwd: REPO_ROOT })
      : execFileSync('java', [
        '-mx3g',
        '-cp',
        `${coreNlpHome}/*`,
        'edu.stanford.nlp.naturalli.OpenIE',
        inputPath,
      ], {
        cwd: coreNlpHome,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 20,
      });
    const output = normalizeOpenIeOutput(stdout, snippets);
    saveJson(outName, output);
    return output;
  } catch (error) {
    const output = {
      baseline: 'openie-official',
      status: 'failed',
      reason: errorMessage(error),
      stderr: bufferText(error?.stderr).slice(0, 4000),
      stdout: bufferText(error?.stdout).slice(0, 4000),
      nodes: [],
      edges: [],
    };
    saveJson(outName, output);
    return output;
  }
}

function runDeepKe() {
  const outName = 'construction-deepke-official.json';
  const command = process.env.DEEPKE_CMD;
  const outputPath = resolve(OUTPUT_DIR, outName);
  if (command) {
    try {
      execShell(command, {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          OKM_SNIPPETS_PATH: SNIPPETS_PATH,
          OKM_OUTPUT_PATH: outputPath,
        },
      });
      const output = readJson(outputPath);
      return saveAndReturn(outName, {
        baseline: 'deepke-official',
        ...output,
        nodes: normalizeNodes(output.nodes),
        edges: normalizeEdges(output.edges),
      });
    } catch (error) {
      const output = {
        baseline: 'deepke-official',
        status: 'failed',
        reason: errorMessage(error),
        stderr: bufferText(error?.stderr).slice(0, 4000),
        stdout: bufferText(error?.stdout).slice(0, 4000),
        nodes: [],
        edges: [],
      };
      saveJson(outName, output);
      return output;
    }
  }

  const importStatus = condaImportStatus(KG_CONDA_ENV, 'deepke');
  const output = {
    baseline: 'deepke-official',
    status: importStatus.status === 'installed' ? 'not_run' : 'failed',
    reason: importStatus.status === 'installed'
      ? 'DeepKE imports successfully, but no task checkpoint or official DeepKE inference command is configured. Set DEEPKE_CMD to a command that reads OKM_SNIPPETS_PATH and writes OKM_OUTPUT_PATH.'
      : importStatus.reason,
    package_status: importStatus,
    nodes: [],
    edges: [],
  };
  saveJson(outName, output);
  return output;
}

function runOneKe(snippets) {
  const outName = 'construction-oneke-official.json';
  const sourceDir = process.env.ONEKE_SOURCE_DIR || resolve(CACHE_DIR, 'OneKE');
  if (!existsSync(resolve(sourceDir, 'src', 'run.py'))) {
    const output = {
      baseline: 'oneke-official',
      status: 'not_run',
      reason: 'OneKE source is not available. Clone https://github.com/zjunlp/OneKE into external/cache/OneKE or set ONEKE_SOURCE_DIR.',
      nodes: [],
      edges: [],
    };
    saveJson(outName, output);
    return output;
  }
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_BASE_URL || !process.env.OPENAI_MODEL) {
    const output = {
      baseline: 'oneke-official',
      status: 'not_run',
      reason: 'OPENAI_API_KEY, OPENAI_BASE_URL, and OPENAI_MODEL are required for the OneKE ChatGPT-compatible API baseline.',
      nodes: [],
      edges: [],
    };
    saveJson(outName, output);
    return output;
  }

  const workDir = resolve(WORK_DIR, 'oneke-official');
  mkdirSync(workDir, { recursive: true });
  const inputPath = resolve(workDir, 'okm-physics-snippets.txt');
  const configPath = resolve(workDir, 'okm-oneke-triple.yaml');
  writeFileSync(inputPath, snippets.map((item) => `【${item.id} ${item.title}】\n${item.text}`).join('\n\n---\n\n'), 'utf8');
  patchOneKeSourceForApiMode(sourceDir);
  writeFileSync(configPath, oneKeConfig(snippets), 'utf8');

  const python = process.env.ONEKE_PYTHON || `conda run -n ${ONEKE_CONDA_ENV} python`;
  try {
    execShell(`${python} src/run.py --config ${shellQuote(configPath)}`, {
      cwd: sourceDir,
      env: process.env,
      timeout: 1000 * 60 * 20,
    });
    const resultPath = resolve(sourceDir, 'examples', 'results', 'okm-oneke-triple.json');
    const raw = existsSync(resultPath) ? readJson(resultPath) : null;
    const output = normalizeOneKeOutput(raw, snippets);
    saveJson(outName, output);
    return output;
  } catch (error) {
    const output = {
      baseline: 'oneke-official',
      status: 'failed',
      reason: errorMessage(error),
      stderr: bufferText(error?.stderr).slice(0, 4000),
      stdout: bufferText(error?.stdout).slice(0, 4000),
      nodes: [],
      edges: [],
      adapter: {
        source_dir: sourceDir,
        python,
        config_path: configPath,
      },
    };
    saveJson(outName, output);
    return output;
  }
}

function runGraphRag(markdown, cases) {
  const outName = 'runtime-graphrag-official.json';
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_BASE_URL || !process.env.OPENAI_MODEL) {
    const output = {
      method: 'graphrag-official',
      status: 'not_run',
      reason: 'OPENAI_API_KEY, OPENAI_BASE_URL, and OPENAI_MODEL are required.',
      results: [],
    };
    saveJson(outName, output);
    return output;
  }
  if (!process.env.EMBEDDING_API_KEY || !process.env.EMBEDDING_URL || !process.env.EMBEDDING_MODEL) {
    const output = {
      method: 'graphrag-official',
      status: 'not_run',
      reason: 'EMBEDDING_API_KEY, EMBEDDING_URL, and EMBEDDING_MODEL are required.',
      results: [],
    };
    saveJson(outName, output);
    return output;
  }

  const workDir = resolve(WORK_DIR, 'graphrag-official');
  const reuseIndex = process.env.GRAPHRAG_REUSE_INDEX === '1' && graphRagIndexReady(workDir);

  try {
    if (!reuseIndex) {
      rmSync(workDir, { recursive: true, force: true });
      mkdirSync(resolve(workDir, 'input'), { recursive: true });
      writeFileSync(resolve(workDir, 'input', 'okm-physics.txt'), markdown, 'utf8');
      execFileSync('conda', [
        'run',
        '-n',
        RUNTIME_CONDA_ENV,
        'graphrag',
        'init',
        '--root',
        workDir,
        '--model',
        process.env.OPENAI_MODEL,
        '--embedding',
        process.env.EMBEDDING_MODEL,
        '--force',
      ], commandOptions(REPO_ROOT, 1000 * 60 * 5));
      writeGraphRagEnv(workDir);
      patchGraphRagSettings(workDir);
      execFileSync('conda', [
        'run',
        '-n',
        RUNTIME_CONDA_ENV,
        'graphrag',
        'index',
        '--root',
        workDir,
        '--method',
        process.env.GRAPHRAG_INDEX_METHOD || 'fast',
      ], commandOptions(REPO_ROOT, 1000 * 60 * 40));
    } else {
      writeGraphRagEnv(workDir);
      patchGraphRagSettings(workDir);
    }

    const results = [];
    const queryFailures = [];
    for (const item of cases) {
      let answer = '';
      let queryError = null;
      try {
        answer = queryGraphRag(workDir, item.question);
      } catch (error) {
        queryError = {
          reason: briefErrorMessage(error),
          stderr: bufferText(error?.stderr).slice(0, 2000),
          stdout: bufferText(error?.stdout).slice(0, 2000),
        };
        queryFailures.push({ id: item.id, reason: queryError.reason });
      }
      results.push({
        method: 'graphrag-official',
        status: queryError ? 'failed' : 'completed',
        id: item.id,
        question: item.question,
        expected_terms: item.expected_terms || [],
        context_ids: [],
        context_char_count: 0,
        answer,
        citations: [],
        unsupported_claims: [],
        teaching_usability_score: null,
        teaching_usability_rationale: '',
        reason: queryError?.reason || '',
        stderr: queryError?.stderr || '',
        stdout: queryError?.stdout || '',
        cost: {
          index_root: workDir,
          index_method: process.env.GRAPHRAG_INDEX_METHOD || 'fast',
          index_reused: reuseIndex,
          query_method: process.env.GRAPHRAG_QUERY_METHOD || 'local',
          model_calls_per_question: 1,
        },
      });
    }
    const output = {
      method: 'graphrag-official',
      status: queryFailures.length ? 'partial' : 'completed',
      reason: queryFailures.length ? `${queryFailures.length} GraphRAG queries failed after the index was built.` : '',
      query_failures: queryFailures,
      results,
      work_dir: workDir,
    };
    saveJson(outName, output);
    return output;
  } catch (error) {
    const output = {
      method: 'graphrag-official',
      status: 'failed',
      reason: errorMessage(error),
      stderr: bufferText(error?.stderr).slice(0, 6000),
      stdout: bufferText(error?.stdout).slice(0, 6000),
      results: [],
      work_dir: workDir,
    };
    saveJson(outName, output);
    return output;
  }
}

function runLightRag(markdownPath, cases) {
  const outName = 'runtime-lightrag-official.json';
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_BASE_URL || !process.env.OPENAI_MODEL) {
    const output = {
      method: 'lightrag-official',
      status: 'not_run',
      reason: 'OPENAI_API_KEY, OPENAI_BASE_URL, and OPENAI_MODEL are required.',
      results: [],
    };
    saveJson(outName, output);
    return output;
  }
  if (!process.env.EMBEDDING_API_KEY || !process.env.EMBEDDING_URL || !process.env.EMBEDDING_MODEL) {
    const output = {
      method: 'lightrag-official',
      status: 'not_run',
      reason: 'EMBEDDING_API_KEY, EMBEDDING_URL, and EMBEDDING_MODEL are required.',
      results: [],
    };
    saveJson(outName, output);
    return output;
  }

  const workDir = resolve(WORK_DIR, 'lightrag-official');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const outputPath = resolve(OUTPUT_DIR, outName);
  try {
    execFileSync('conda', [
      'run',
      '-n',
      RUNTIME_CONDA_ENV,
      'python',
      resolve(SCRIPT_DIR, 'lightrag-official.py'),
      '--markdown',
      markdownPath,
      '--cases',
      RUNTIME_CASES_PATH,
      '--work-dir',
      workDir,
      '--output',
      outputPath,
    ], commandOptions(REPO_ROOT, 1000 * 60 * 40));
    return readJson(outputPath);
  } catch (error) {
    const output = {
      method: 'lightrag-official',
      status: 'failed',
      reason: errorMessage(error),
      stderr: bufferText(error?.stderr).slice(0, 6000),
      stdout: bufferText(error?.stdout).slice(0, 6000),
      results: [],
      work_dir: workDir,
    };
    saveJson(outName, output);
    return output;
  }
}

function normalizeOpenIeOutput(stdout, snippets) {
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const sourceText = snippets.map((item) => item.text).join('\n');
  const addNode = (name, evidence) => {
    const clean = cleanCandidateName(name);
    if (!clean) return null;
    const key = normalize(clean);
    if (!seen.has(key)) {
      seen.add(key);
      nodes.push({
        id: `openie-official/${key}`,
        name: clean,
        kind: 'concept',
        definition: evidence || '',
        evidence: evidence ? [evidence] : [],
      });
    }
    return clean;
  };
  for (const line of stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const triple = parseOpenIeLine(line);
    if (!triple) continue;
    const source = addNode(triple.subject, triple.evidence);
    const target = addNode(triple.object, triple.evidence);
    if (!source || !target) continue;
    edges.push({
      id: `openie-official/e/${edges.length + 1}`,
      source,
      target,
      type: 'related_to',
      relation_text: triple.relation,
      evidence: triple.evidence && sourceText.includes(triple.evidence.slice(0, 20)) ? [triple.evidence] : [],
    });
  }
  return {
    baseline: 'openie-official',
    status: 'completed',
    parser: 'stanford-corenlp-openie',
    nodes,
    edges,
    raw_line_count: stdout.split(/\r?\n/).filter(Boolean).length,
  };
}

function parseOpenIeLine(line) {
  const tab = line.split(/\t/).map((item) => item.trim()).filter(Boolean);
  if (tab.length >= 4) {
    const maybeScore = Number(tab[0]);
    const offset = Number.isFinite(maybeScore) ? 1 : 0;
    if (tab.length >= offset + 3) {
      return {
        subject: tab[offset],
        relation: tab[offset + 1],
        object: tab[offset + 2],
        evidence: tab.slice(offset).join(' '),
      };
    }
  }
  const tuple = line.match(/\(([^;()]+);\s*([^;()]+);\s*([^;()]+)\)/);
  if (tuple) {
    return {
      subject: tuple[1],
      relation: tuple[2],
      object: tuple[3],
      evidence: line,
    };
  }
  return null;
}

function normalizeOneKeOutput(raw, snippets) {
  const triples = collectTriples(raw);
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const sourceText = snippets.map((item) => item.text).join('\n');
  const addNode = (name, kind, evidence) => {
    const clean = cleanCandidateName(name);
    if (!clean) return null;
    const key = normalize(clean);
    if (!seen.has(key)) {
      seen.add(key);
      nodes.push({
        id: `oneke-official/${key}`,
        name: clean,
        kind: kind || 'concept',
        definition: evidence || '',
        evidence: evidence ? [evidence] : [],
      });
    }
    return clean;
  };
  for (const triple of triples) {
    const source = addNode(triple.head, mapKind(triple.head_type), triple.evidence);
    const target = addNode(triple.tail, mapKind(triple.tail_type), triple.evidence);
    if (!source || !target) continue;
    edges.push({
      id: `oneke-official/e/${edges.length + 1}`,
      source,
      target,
      type: mapRelationType(triple.relation_type || triple.relation),
      relation_text: triple.relation || '',
      evidence: triple.evidence && sourceText.includes(triple.evidence.slice(0, 20)) ? [triple.evidence] : [],
    });
  }
  return {
    baseline: 'oneke-official',
    status: 'completed',
    adapter: 'OneKE src/run.py Triple task',
    nodes,
    edges,
    raw: decodeJsonStrings(raw),
  };
}

function collectTriples(value) {
  const triples = [];
  const visit = (item) => {
    if (!item) return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (typeof item !== 'object') return;
    if (Array.isArray(item.triple_list)) {
      for (const triple of item.triple_list) visit(triple);
      return;
    }
    if (Array.isArray(item.triples)) {
      for (const triple of item.triples) visit(triple);
      return;
    }
    if ((item.head || item.subject) && (item.tail || item.object)) {
      triples.push({
        head: decodeMojibake(String(item.head || item.subject || '')),
        tail: decodeMojibake(String(item.tail || item.object || '')),
        relation: decodeMojibake(String(item.relation || item.predicate || 'related_to')),
        head_type: decodeMojibake(String(item.head_type || item.subject_type || '')),
        tail_type: decodeMojibake(String(item.tail_type || item.object_type || '')),
        relation_type: decodeMojibake(String(item.relation_type || '')),
        evidence: decodeMojibake(String(item.evidence || '')),
      });
      return;
    }
    for (const child of Object.values(item)) visit(child);
  };
  visit(value);
  return triples;
}

function decodeJsonStrings(value) {
  if (Array.isArray(value)) return value.map(decodeJsonStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decodeJsonStrings(child)]));
  }
  return typeof value === 'string' ? decodeMojibake(value) : value;
}

function decodeMojibake(value) {
  if (!/[ÃÂäåçèéæ]/.test(value)) return value;
  try {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? value : decoded;
  } catch {
    return value;
  }
}

function graphRagIndexReady(workDir) {
  return existsSync(resolve(workDir, 'settings.yaml')) &&
    existsSync(resolve(workDir, 'output', 'entities.parquet')) &&
    existsSync(resolve(workDir, 'output', 'relationships.parquet')) &&
    existsSync(resolve(workDir, 'output', 'text_units.parquet'));
}

function queryGraphRag(workDir, question) {
  const method = process.env.GRAPHRAG_QUERY_METHOD || 'local';
  try {
    return execFileSync('conda', [
      'run',
      '-n',
      RUNTIME_CONDA_ENV,
      'graphrag',
      'query',
      '--root',
      workDir,
      '--method',
      method,
      question,
    ], commandOptions(REPO_ROOT, 1000 * 60 * 10)).trim();
  } catch (error) {
    if (method === 'basic') throw error;
    return execFileSync('conda', [
      'run',
      '-n',
      RUNTIME_CONDA_ENV,
      'graphrag',
      'query',
      '--root',
      workDir,
      '--method',
      'basic',
      question,
    ], commandOptions(REPO_ROOT, 1000 * 60 * 10)).trim();
  }
}

function writeGraphRagEnv(workDir) {
  const lines = [
    `GRAPHRAG_CHAT_API_KEY=${process.env.OPENAI_API_KEY || ''}`,
    `GRAPHRAG_CHAT_BASE_URL=${process.env.OPENAI_BASE_URL || ''}`,
    `GRAPHRAG_EMBEDDING_API_KEY=${process.env.EMBEDDING_API_KEY || ''}`,
    `GRAPHRAG_EMBEDDING_BASE_URL=${embeddingBaseUrl()}`,
  ];
  writeFileSync(resolve(workDir, '.env'), `${lines.join('\n')}\n`, 'utf8');
}

function patchGraphRagSettings(workDir) {
  const settingsPath = resolve(workDir, 'settings.yaml');
  const requestedEmbedBatchSize = Number(process.env.GRAPHRAG_EMBED_BATCH_SIZE || 10);
  const requestedEmbedBatchMaxTokens = Number(process.env.GRAPHRAG_EMBED_BATCH_MAX_TOKENS || 8191);
  const embedBatchSize = Number.isFinite(requestedEmbedBatchSize)
    ? Math.max(1, Math.min(requestedEmbedBatchSize, 10))
    : 10;
  const embedBatchMaxTokens = Number.isFinite(requestedEmbedBatchMaxTokens)
    ? Math.max(1, requestedEmbedBatchMaxTokens)
    : 8191;
  let text = readFileSync(settingsPath, 'utf8');
  text = text.replace(
    /api_key: \$\{GRAPHRAG_API_KEY\}/g,
    'api_key: ${GRAPHRAG_CHAT_API_KEY}',
  );
  text = text.replace(
    /completion_models:\n([\s\S]*?)embedding_models:/,
    `completion_models:
  default_completion_model:
    model_provider: openai
    model: "${yamlString(process.env.OPENAI_MODEL || 'gpt-4.1')}"
    auth_method: api_key
    api_key: \${GRAPHRAG_CHAT_API_KEY}
    api_base: \${GRAPHRAG_CHAT_BASE_URL}
    call_args:
      extra_body:
        chat_template_kwargs:
          enable_thinking: false
    retry:
      type: exponential_backoff

embedding_models:`,
  );
  text = text.replace(
    /embedding_models:\n([\s\S]*?)### Document processing settings ###/,
    `embedding_models:
  default_embedding_model:
    model_provider: openai
    model: "${yamlString(process.env.EMBEDDING_MODEL || 'text-embedding-3-small')}"
    auth_method: api_key
    api_key: \${GRAPHRAG_EMBEDDING_API_KEY}
    api_base: \${GRAPHRAG_EMBEDDING_BASE_URL}
    retry:
      type: exponential_backoff

### Document processing settings ###`,
  );
  text = text.replace(
    /entity_types: \[[^\]]+\]/,
    'entity_types: [concept, property, law, process, representation, device, phenomenon]',
  );
  text = text.replace(
    /embed_text:\n([\s\S]*?)\nextract_graph:/,
    `embed_text:
  embedding_model_id: default_embedding_model
  batch_size: ${embedBatchSize}
  batch_max_tokens: ${embedBatchMaxTokens}

extract_graph:`,
  );
  writeFileSync(settingsPath, text, 'utf8');
}

function oneKeConfig(snippets) {
  const snippetChars = Number(process.env.ONEKE_SNIPPET_CHARS || 1500);
  const text = snippets.map((item) => `【${item.id} ${item.title}】\n${item.text.slice(0, snippetChars)}`).join('\n\n---\n\n');
  return [
    'model:',
    '  category: ChatGPT',
    `  model_name_or_path: "${yamlString(process.env.OPENAI_MODEL || '')}"`,
    `  api_key: "${yamlString(process.env.OPENAI_API_KEY || '')}"`,
    `  base_url: "${yamlString(process.env.OPENAI_BASE_URL || '')}"`,
    '  vllm_serve: false',
    '',
    'extraction:',
    '  mode: quick',
    '  task: Triple',
    '  use_file: false',
    '  file_path: ""',
    '  text: |-',
    indentYamlBlock(text, 4),
    '  constraint:',
    '    - [concept, property, process, rule, representation, entity]',
    '    - [is_a, part_of, has_property, uses, produces, depends_on, causes, affects, represents, related_to]',
    '  update_case: false',
    '  show_trajectory: false',
    '',
  ].join('\n');
}

function indentYamlBlock(value, spaces) {
  const prefix = ' '.repeat(spaces);
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function patchOneKeSourceForApiMode(sourceDir) {
  const llmPath = resolve(sourceDir, 'src', 'models', 'llm_def.py');
  if (existsSync(llmPath)) {
    let text = readFileSync(llmPath, 'utf8');
    text = text.replace(
      "from transformers import pipeline\nfrom transformers import AutoTokenizer, AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, AutoConfig, GenerationConfig\nimport torch\nimport openai",
      "try:\n    from transformers import pipeline\n    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig, AutoConfig, GenerationConfig\nexcept Exception:\n    pipeline = AutoTokenizer = AutoModelForCausalLM = BitsAndBytesConfig = AutoConfig = GenerationConfig = None\ntry:\n    import torch\nexcept Exception:\n    class _Cuda:\n        @staticmethod\n        def is_available():\n            return False\n    class _Torch:\n        bfloat16 = None\n        cuda = _Cuda()\n        @staticmethod\n        def device(value):\n            return value\n    torch = _Torch()\nimport openai",
    );
    text = text.replace(
    "# Set proxy for requests\nos.environ['http_proxy'] = 'http://127.0.0.1:7890'\nos.environ['https_proxy'] = 'http://127.0.0.1:7890'",
    "# Set proxy for requests only when explicitly requested by the benchmark runner.\nif os.environ.get('ONEKE_ENABLE_PROXY'):\n    os.environ['http_proxy'] = os.environ.get('ONEKE_HTTP_PROXY', 'http://127.0.0.1:7890')\n    os.environ['https_proxy'] = os.environ.get('ONEKE_HTTPS_PROXY', 'http://127.0.0.1:7890')",
    );
    text = text.replace(
      /class ChatGPT\(BaseEngine\):[\s\S]*?\nclass DeepSeek\(BaseEngine\):/,
      `class ChatGPT(BaseEngine):
    def __init__(self, model_name_or_path: str, api_key: str, base_url=openai.base_url):
        self.name = "ChatGPT"
        self.model = model_name_or_path
        self.base_url = base_url
        self.temperature = 0.1
        self.top_p = 0.9
        self.max_tokens = 4096
        if api_key != "":
            self.api_key = api_key
        else:
            self.api_key = os.environ["OPENAI_API_KEY"]
        self.client = OpenAI(api_key=self.api_key, base_url=self.base_url)

    def get_chat_response(self, input):
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": "You are an information extraction engine. Return final valid JSON only. Do not output reasoning."},
                {"role": "user", "content": input},
            ],
            stream=False,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            stop=None,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        message = response.choices[0].message
        content = getattr(message, "content", None)
        if content:
            return content
        reasoning = getattr(message, "reasoning", None) or getattr(message, "reasoning_content", None)
        if reasoning:
            return str(reasoning)
        return ""

class DeepSeek(BaseEngine):`,
    );
    writeFileSync(llmPath, text, 'utf8');
  }

  const processPath = resolve(sourceDir, 'src', 'utils', 'process.py');
  if (existsSync(processPath)) {
    let text = readFileSync(processPath, 'utf8');
    text = text.replace(
      'from langchain_community.document_loaders import TextLoader, PyPDFLoader, Docx2txtLoader, BSHTMLLoader, JSONLoader\nfrom nltk.tokenize import sent_tokenize',
      "try:\n    from langchain_community.document_loaders import TextLoader, PyPDFLoader, Docx2txtLoader, BSHTMLLoader, JSONLoader\nexcept Exception:\n    TextLoader = PyPDFLoader = Docx2txtLoader = BSHTMLLoader = JSONLoader = None\ntry:\n    from nltk.tokenize import sent_tokenize\nexcept Exception:\n    sent_tokenize = None",
    );
    text = text.replace(
      '    sentences = sent_tokenize(text)',
      "    if sent_tokenize is not None:\n        try:\n            sentences = sent_tokenize(text)\n        except Exception:\n            sentences = re.split(r'(?<=[。！？.!?])\\s*|\\n+', text)\n    else:\n        sentences = re.split(r'(?<=[。！？.!?])\\s*|\\n+', text)",
    );
    text = text.replace(
      /def chunk_str\(text\):[\s\S]*?\n# Load and split the content of a file/,
      `def chunk_str(text):
    if sent_tokenize is not None:
        try:
            sentences = sent_tokenize(text)
        except Exception:
            sentences = re.split(r'(?<=[。！？.!?])\\s*|\\n+', text)
    else:
        sentences = re.split(r'(?<=[。！？.!?])\\s*|\\n+', text)
    chunks = []
    current_chunk = []
    current_length = 0

    for sentence in sentences:
        token_count = len(sentence.split())
        if current_length + token_count <= config['agent']['chunk_token_limit']:
            current_chunk.append(sentence)
            current_length += token_count
        else:
            if current_chunk:
                chunks.append(' '.join(current_chunk))
            current_chunk = [sentence]
            current_length = token_count
    if current_chunk:
        chunks.append(' '.join(current_chunk))
    return chunks

# Load and split the content of a file`,
    );
    writeFileSync(processPath, text, 'utf8');
  }

  const schemaAgentPath = resolve(sourceDir, 'src', 'modules', 'schema_agent.py');
  if (existsSync(schemaAgentPath)) {
    let text = readFileSync(schemaAgentPath, 'utf8');
    text = text.replace(
      /from models import \*[\s\S]*?class SchemaAnalyzer:/,
      "from models import *\nfrom utils import *\nfrom .knowledge_base import schema_repository\ntry:\n    from langchain_core.output_parsers import JsonOutputParser\nexcept Exception:\n    JsonOutputParser = None\n\nclass SchemaAnalyzer:",
    );
    text = text.replace(
      '        try:\n            parser = JsonOutputParser(pydantic_object = schema)',
      '        try:\n            if JsonOutputParser is None:\n                return str(schema)\n            parser = JsonOutputParser(pydantic_object = schema)',
    );
    writeFileSync(schemaAgentPath, text, 'utf8');
  }

  const schemaRepoPath = resolve(sourceDir, 'src', 'modules', 'knowledge_base', 'schema_repository.py');
  if (existsSync(schemaRepoPath)) {
    let text = readFileSync(schemaRepoPath, 'utf8');
    text = text.replace(
      /from typing import List, Optional[\s\S]*?# ==================================================================== #\n#                                NER TASK/,
      "from typing import List, Optional\nfrom pydantic import BaseModel, Field\ntry:\n    from langchain_core.output_parsers import JsonOutputParser\nexcept Exception:\n    JsonOutputParser = None\n\n# ==================================================================== #\n#                                NER TASK",
    );
    writeFileSync(schemaRepoPath, text, 'utf8');
  }

  const caseRepoPath = resolve(sourceDir, 'src', 'modules', 'knowledge_base', 'case_repository.py');
  if (existsSync(caseRepoPath)) {
    let text = readFileSync(caseRepoPath, 'utf8');
    text = text.replace(
      'import torch\nimport numpy as np\nfrom utils import *\nfrom sentence_transformers import SentenceTransformer\nfrom rapidfuzz import process',
      "try:\n    import torch\nexcept Exception:\n    class _Cuda:\n        @staticmethod\n        def is_available():\n            return False\n    class _Torch:\n        float32 = None\n        cuda = _Cuda()\n        @staticmethod\n        def device(value):\n            return value\n        @staticmethod\n        def tensor(*args, **kwargs):\n            raise RuntimeError('torch is required for OneKE case retrieval')\n    torch = _Torch()\ntry:\n    import numpy as np\nexcept Exception:\n    np = None\nfrom utils import *\ntry:\n    from sentence_transformers import SentenceTransformer\nexcept Exception:\n    SentenceTransformer = None\ntry:\n    from rapidfuzz import process\nexcept Exception:\n    process = None",
    );
    writeFileSync(caseRepoPath, text, 'utf8');
  }

  const promptTemplatePath = resolve(sourceDir, 'src', 'models', 'prompt_template.py');
  if (existsSync(promptTemplatePath)) {
    let text = readFileSync(promptTemplatePath, 'utf8');
    text = text.replace(
      /[\s\S]*?from \.prompt_example import \*/,
      "try:\n    from langchain.prompts import PromptTemplate\nexcept Exception:\n    class PromptTemplate:\n        def __init__(self, input_variables=None, template=''):\n            self.input_variables = input_variables or []\n            self.template = template\n        def format(self, **kwargs):\n            return self.template.format(**kwargs)\nfrom .prompt_example import *",
    );
    writeFileSync(promptTemplatePath, text, 'utf8');
  }

  const constructPath = resolve(sourceDir, 'src', 'construct', 'convert.py');
  if (existsSync(constructPath)) {
    let text = readFileSync(constructPath, 'utf8');
    text = text.replace(
      /import json\nimport re[\s\S]*?\n\ndef sanitize_string/,
      "import json\nimport re\ntry:\n    from neo4j import GraphDatabase\nexcept Exception:\n    GraphDatabase = None\n\n\ndef sanitize_string",
    );
    text = text.replace(
      /    if GraphDatabase is None:\n        raise RuntimeError\('neo4j is required for OneKE graph construction'\)\n(?:    if GraphDatabase is None:\n        raise RuntimeError\('neo4j is required for OneKE graph construction'\)\n)*    driver = GraphDatabase\.driver\(uri, auth=\(user, password\)\)/,
      "    if GraphDatabase is None:\n        raise RuntimeError('neo4j is required for OneKE graph construction')\n    driver = GraphDatabase.driver(uri, auth=(user, password))",
    );
    writeFileSync(constructPath, text, 'utf8');
  }
}

function findCoreNlpHome() {
  const candidates = [
    resolve(CACHE_DIR, 'stanford-corenlp'),
    resolve(CACHE_DIR, 'stanford-corenlp-4.5.7'),
    resolve(CACHE_DIR, 'stanford-corenlp-4.5.6'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || '';
}

function condaImportStatus(condaEnv, moduleName) {
  try {
    execFileSync('conda', [
      'run',
      '-n',
      condaEnv,
      'python',
      '-c',
      `import ${moduleName}; print("ok")`,
    ], commandOptions(REPO_ROOT, 1000 * 60));
    return { conda_env: condaEnv, module: moduleName, status: 'installed' };
  } catch (error) {
    return {
      conda_env: condaEnv,
      module: moduleName,
      status: 'not_importable',
      reason: errorMessage(error),
    };
  }
}

function commandStatus(command, commandArgs) {
  try {
    execFileSync(command, commandArgs, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    });
    return 'available';
  } catch (error) {
    return `unavailable: ${errorMessage(error)}`;
  }
}

function commandOptions(cwd, timeout = 1000 * 60 * 10) {
  return {
    cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 80,
    timeout,
  };
}

function execShell(command, options = {}) {
  return execFileSync('/bin/sh', ['-lc', command], {
    cwd: options.cwd || REPO_ROOT,
    env: options.env || process.env,
    input: options.input,
    encoding: 'utf8',
    stdio: options.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 80,
    timeout: options.timeout || 1000 * 60 * 10,
  });
}

function normalizeNodes(nodes) {
  return Array.isArray(nodes) ? nodes.map((node, index) => ({
    id: String(node?.id || `node-${index + 1}`),
    name: cleanCandidateName(String(node?.name || node?.label || '')),
    kind: String(node?.kind || 'concept'),
    definition: String(node?.definition || ''),
    aliases: Array.isArray(node?.aliases) ? node.aliases.map(String) : [],
    evidence: Array.isArray(node?.evidence) ? node.evidence.map(String) : [node?.evidence].filter(Boolean).map(String),
  })).filter((node) => node.name) : [];
}

function normalizeEdges(edges) {
  return Array.isArray(edges) ? edges.map((edge, index) => ({
    id: String(edge?.id || `edge-${index + 1}`),
    source: cleanCandidateName(String(edge?.source || edge?.head || edge?.from || '')),
    target: cleanCandidateName(String(edge?.target || edge?.tail || edge?.to || '')),
    type: mapRelationType(edge?.type || edge?.relation),
    evidence: Array.isArray(edge?.evidence) ? edge.evidence.map(String) : [edge?.evidence].filter(Boolean).map(String),
  })).filter((edge) => edge.source && edge.target) : [];
}

function mapKind(value) {
  const normalized = normalize(value);
  if (['property', 'process', 'representation', 'entity', 'concept'].includes(normalized)) return normalized;
  if (normalized.includes('rule') || normalized.includes('law')) return 'rule';
  if (normalized.includes('device')) return 'entity';
  return 'concept';
}

function mapRelationType(value) {
  const normalized = normalize(value);
  if (['is_a', 'part_of', 'contains', 'has_property', 'uses', 'produces', 'depends_on', 'causes', 'affects', 'represents', 'about', 'related_to'].includes(normalized)) return normalized;
  if (normalized.includes('part')) return 'part_of';
  if (normalized.includes('property')) return 'has_property';
  if (normalized.includes('cause')) return 'causes';
  if (normalized.includes('represent')) return 'represents';
  if (normalized.includes('depend')) return 'depends_on';
  return 'related_to';
}

function cleanCandidateName(value) {
  return String(value || '')
    .replace(/\([^)]*\)/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/[“”"']/g, '')
    .replace(/^[：:，,。；;\s]+|[：:，,。；;\s]+$/g, '')
    .trim();
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, '')
    .trim();
}

function yamlString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function embeddingBaseUrl() {
  return String(process.env.EMBEDDING_URL || '').replace(/\/embeddings\/?$/i, '');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function saveAndReturn(name, value) {
  saveJson(name, value);
  return value;
}

function saveJson(name, value) {
  writeFileSync(resolve(OUTPUT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function bufferText(value) {
  if (!value) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function briefErrorMessage(error) {
  const text = [
    errorMessage(error),
    bufferText(error?.stderr),
    bufferText(error?.stdout),
  ].join('\n');
  if (/no healthy upstream/i.test(text)) return 'Model service returned no healthy upstream.';
  if (/batch size is invalid/i.test(text)) return 'Embedding service rejected the GraphRAG batch size.';
  if (/No .*\\.txt\\$ matches found/i.test(text)) return 'GraphRAG did not find input text files matching its configured pattern.';
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('Traceback') && !item.startsWith('│') && !item.startsWith('╭') && !item.startsWith('╰'));
  return (line || errorMessage(error)).slice(0, 500);
}

function redactSummary(value) {
  return JSON.parse(JSON.stringify(value, (key, child) => {
    if (/api_key|key|token|password/i.test(key) && typeof child === 'string') return child ? '[redacted]' : '';
    return child;
  }));
}
