#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVE_EDGE_TYPES, edgeTypeLabelZh } from '@okm/types';
import postgres from 'postgres';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(EXP_DIR, '..', '..');
const DATA_DIR = resolve(EXP_DIR, 'data');
const DEFAULT_OUTPUT_DIR = resolve(EXP_DIR, 'outputs');
const DEFAULT_CASES_PATH = resolve(DATA_DIR, 'runtime-cases-ablation.jsonl');

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

const ALLOWED_EDGE_TYPES = new Set(ACTIVE_EDGE_TYPES);

const VARIANTS = [
  {
    id: 'A0',
    label: 'OKM full',
    source: 'canonical',
    retrieval: 'unit_text',
    includeBody: true,
    includeEvidence: true,
    includeProfiles: true,
    includePedagogicalProfile: true,
    includeRelations: true,
    includeCard: true,
    relationExpansion: true,
    requireCitations: true,
  },
  {
    id: 'A1',
    label: 'no evidence anchoring',
    source: 'canonical',
    retrieval: 'unit_text',
    includeBody: true,
    includeEvidence: false,
    includeProfiles: true,
    includePedagogicalProfile: true,
    includeRelations: true,
    includeCard: true,
    relationExpansion: true,
    requireCitations: false,
  },
  {
    id: 'A2',
    label: 'no node_bodies',
    source: 'canonical',
    retrieval: 'unit_text',
    includeBody: false,
    includeEvidence: true,
    includeProfiles: true,
    includePedagogicalProfile: true,
    includeRelations: true,
    includeCard: true,
    relationExpansion: true,
    requireCitations: true,
  },
  {
    id: 'A3',
    label: 'no domain_profiles / curriculum_projections',
    source: 'canonical',
    retrieval: 'unit_text',
    includeBody: true,
    includeEvidence: true,
    includeProfiles: false,
    includePedagogicalProfile: false,
    includeRelations: true,
    includeCard: true,
    relationExpansion: true,
    requireCitations: true,
  },
  {
    id: 'A4',
    label: 'no graph relations, object vector retrieval',
    source: 'canonical',
    retrieval: 'node_vector',
    includeBody: true,
    includeEvidence: true,
    includeProfiles: true,
    includePedagogicalProfile: true,
    includeRelations: false,
    includeCard: true,
    relationExpansion: false,
    requireCitations: true,
  },
  {
    id: 'A5',
    label: 'no relation expansion',
    source: 'canonical',
    retrieval: 'unit_text',
    includeBody: true,
    includeEvidence: true,
    includeProfiles: true,
    includePedagogicalProfile: true,
    includeRelations: true,
    includeCard: true,
    relationExpansion: false,
    requireCitations: true,
  },
  {
    id: 'A6',
    label: 'no QA / normalize / merge, raw staging extraction',
    source: 'staging',
    retrieval: 'staging_text',
    includeBody: false,
    includeEvidence: true,
    includeProfiles: true,
    includePedagogicalProfile: true,
    includeRelations: true,
    includeCard: true,
    relationExpansion: false,
    requireCitations: true,
  },
  {
    id: 'A7',
    label: 'node-only retrieval',
    source: 'canonical',
    retrieval: 'node_text',
    includeBody: false,
    includeEvidence: false,
    includeProfiles: false,
    includePedagogicalProfile: false,
    includeRelations: false,
    includeCard: false,
    relationExpansion: false,
    nodeOnly: true,
    requireCitations: false,
  },
];

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  loadEnv();
  const flags = parseFlags(process.argv.slice(2));
  mkdirSync(flags.outputDir, { recursive: true });

  const cases = readCases(flags.casesPath).slice(0, flags.caseLimit ?? undefined);
  const selectedVariants = VARIANTS.filter((variant) => flags.variants.has(variant.id));
  if (selectedVariants.length === 0) {
    throw new Error('No ablation variants selected.');
  }

  const sql = postgres(flags.db, { max: 4 });
  try {
    const dataset = await resolveDataset(sql, flags.source);
    const canonicalStore = await loadCanonicalStore(sql, dataset.dataset_id);
    const stagingStore = await loadStagingStore(sql, dataset.dataset_id);
    const constructionMetrics = scoreStagingConstruction(stagingStore);

    const variantOutputs = [];
    for (const variant of selectedVariants) {
      const store = variant.source === 'staging' ? stagingStore : canonicalStore;
      const output = await runVariant(sql, dataset.dataset_id, cases, variant, store, flags);
      variantOutputs.push(output);
      writeJson(resolve(flags.outputDir, 'partial-variant-results.json'), {
        generated_at: new Date().toISOString(),
        completed_variants: variantOutputs.map((item) => item.variant_id),
        variants: variantOutputs,
      });
    }

    const run = {
      generated_at: new Date().toISOString(),
      experiment: 'okm-apiunit-ablation-2026-07-01',
      source: dataset.dataset_id,
      case_count: cases.length,
      generated_answers: flags.generate,
      retrieval_limit: flags.limit,
      seed_limit: flags.seedLimit,
      db_embeddings_enabled: flags.useDbEmbeddings,
      variants: variantOutputs,
      construction_metrics: {
        A6: constructionMetrics,
      },
      notes: [
        'This experiment is read-only. It does not write canonical world_* tables.',
        'A6 uses world_staging_* rows and intentionally avoids canonical node mapping.',
        'Precomputed unit embeddings are used only when --use-db-embeddings is passed; otherwise retrieval is based on the ablated view text to avoid leakage from removed fields.',
      ],
    };

    const retrievalMetrics = summarizeRetrieval(run);
    const summary = summarizeRun(run, retrievalMetrics);
    writeJson(resolve(flags.outputDir, 'variant-results.json'), run);
    writeJson(resolve(flags.outputDir, 'retrieval-metrics.json'), retrievalMetrics);
    writeJson(resolve(flags.outputDir, 'ablation-summary.json'), summary);
    writeReport(resolve(flags.outputDir, 'ablation-report.md'), summary, retrievalMetrics, constructionMetrics);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function parseFlags(argv) {
  const flags = {
    db: process.env.DATABASE_URL || 'postgresql://okm:okm@localhost:5432/knowledge',
    source: 'main',
    casesPath: DEFAULT_CASES_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
    limit: 8,
    seedLimit: 5,
    caseLimit: null,
    concurrency: 4,
    generate: false,
    useDbEmbeddings: false,
    variants: new Set(VARIANTS.map((variant) => variant.id)),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--db':
        flags.db = requireValue(argv, ++index, arg);
        break;
      case '--source':
        flags.source = requireValue(argv, ++index, arg);
        break;
      case '--cases':
        flags.casesPath = resolve(requireValue(argv, ++index, arg));
        break;
      case '--output-dir':
        flags.outputDir = resolve(requireValue(argv, ++index, arg));
        break;
      case '--limit':
        flags.limit = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
        break;
      case '--seed-limit':
        flags.seedLimit = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
        break;
      case '--case-limit':
        flags.caseLimit = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
        break;
      case '--concurrency':
        flags.concurrency = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
        break;
      case '--smoke':
        flags.caseLimit = 12;
        break;
      case '--generate':
        flags.generate = true;
        break;
      case '--use-db-embeddings':
        flags.useDbEmbeddings = true;
        break;
      case '--variants':
        flags.variants = new Set(requireValue(argv, ++index, arg).split(',').map((item) => item.trim()).filter(Boolean));
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return flags;
}

function printHelp() {
  console.log([
    'Usage: node experiments/okm-apiunit-ablation-2026-07-01/scripts/run-ablation.mjs [options]',
    '',
    'Options:',
    '  --source <key>             Dataset id or name. Default: main',
    '  --db <url>                 PostgreSQL URL. Default: DATABASE_URL or local okm database',
    '  --cases <path>             JSONL case file',
    '  --output-dir <path>        Output directory',
    '  --limit <n>                Final context unit limit. Default: 8',
    '  --seed-limit <n>           Seed retrieval limit before expansion. Default: 5',
    '  --case-limit <n>           Only run the first n cases',
    '  --smoke                   Alias for --case-limit 12',
    '  --concurrency <n>          Concurrent cases per variant. Default: 4',
    '  --variants <A0,A1>         Comma-separated variants',
    '  --generate                Call the configured chat model for answers',
    '  --use-db-embeddings       Allow A0/A5 to use precomputed world_unit_embeddings',
  ].join('\n'));
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

async function resolveDataset(sql, source) {
  const rows = await sql`
    SELECT dataset_id, dataset_name
    FROM world_datasets
    WHERE dataset_id = ${source} OR dataset_name = ${source}
    ORDER BY is_active DESC, updated_at DESC
    LIMIT 1
  `;
  if (rows.length) return rows[0];
  const activeRows = await sql`
    SELECT dataset_id, dataset_name
    FROM world_datasets
    WHERE is_active = 1
    LIMIT 1
  `;
  if (activeRows.length) return activeRows[0];
  throw new Error(`Dataset not found: ${source}`);
}

async function loadCanonicalStore(sql, datasetId) {
  const [nodes, edges, profiles, curriculumProjections, mentions, evidence, cards, bodies] = await Promise.all([
    sql`SELECT * FROM world_nodes WHERE dataset_id = ${datasetId} AND status != 'deprecated' ORDER BY id`,
    sql`SELECT * FROM world_edges WHERE dataset_id = ${datasetId} AND status != 'deprecated' ORDER BY id`,
    sql`SELECT * FROM world_domain_profiles WHERE dataset_id = ${datasetId} AND status != 'deprecated' ORDER BY id`,
    sql`SELECT * FROM world_curriculum_projections WHERE dataset_id = ${datasetId} AND status != 'deprecated' ORDER BY id`,
    sql`SELECT * FROM world_mentions WHERE dataset_id = ${datasetId} ORDER BY id`,
    sql`SELECT * FROM world_evidence WHERE dataset_id = ${datasetId} ORDER BY id`,
    sql`SELECT * FROM world_node_cards WHERE dataset_id = ${datasetId} AND status != 'deprecated' ORDER BY node_id`,
    sql`SELECT * FROM world_node_bodies WHERE dataset_id = ${datasetId} AND status != 'deprecated' ORDER BY node_id`,
  ]);

  const evidenceById = new Map(evidence.map((row) => [row.id, toEvidence(row)]));
  const evidenceByAnchor = groupBy(evidence.map(toEvidence), (row) => `${row.source_id}::${row.anchor_ref}`);
  const mentionsByNode = groupBy(mentions.filter((row) => row.target_type === 'node').map(toMention), (row) => row.target_id);
  const edgesByFrom = groupBy(edges.map(toRelation), (row) => row.from_id);
  const edgesByTo = groupBy(edges.map(toRelation), (row) => row.to_id);
  const profilesByNode = groupBy(profiles.map(toDomainProfile), (row) => row.node_id);
  const curriculumProjectionsByNode = groupBy(curriculumProjections.map(toCurriculumProjection), (row) => row.node_id);
  const cardByNode = new Map(cards.map((row) => [row.node_id, toCard(row)]));
  const bodyByNode = new Map(bodies.map((row) => [row.node_id, toBody(row)]));

  const units = nodes.map((row) => {
    const node = toNode(row);
    const unitMentions = mentionsByNode.get(node.id) ?? [];
    const unitEvidence = collectEvidence(unitMentions, evidenceById, evidenceByAnchor);
    return {
      node,
      relations: {
        outgoing: edgesByFrom.get(node.id) ?? [],
        incoming: edgesByTo.get(node.id) ?? [],
      },
      domain_profiles: profilesByNode.get(node.id) ?? [],
      curriculum_projections: curriculumProjectionsByNode.get(node.id) ?? [],
      mentions: unitMentions,
      evidence: unitEvidence,
      media: [],
      source_fragments: sourceFragmentsFromEvidence(unitEvidence),
      card: cardByNode.get(node.id) ?? null,
      body: bodyByNode.get(node.id) ?? null,
      completeness: {},
    };
  });
  return makeStore('canonical', units);
}

async function loadStagingStore(sql, datasetId) {
  const [nodes, edges, profiles, curriculumProjections, mentions, evidence, cards] = await Promise.all([
    sql`SELECT * FROM world_staging_nodes WHERE dataset_id = ${datasetId} ORDER BY lesson_run_id, raw_node_id`.catch(() => []),
    sql`SELECT * FROM world_staging_edges WHERE dataset_id = ${datasetId} ORDER BY lesson_run_id, raw_edge_id`.catch(() => []),
    sql`SELECT * FROM world_staging_domain_profiles WHERE dataset_id = ${datasetId} ORDER BY lesson_run_id, raw_profile_id`.catch(() => []),
    sql`SELECT * FROM world_staging_curriculum_projections WHERE dataset_id = ${datasetId} ORDER BY lesson_run_id, raw_projection_id`.catch(() => []),
    sql`SELECT * FROM world_staging_mentions WHERE dataset_id = ${datasetId} ORDER BY lesson_run_id, raw_mention_id`.catch(() => []),
    sql`SELECT * FROM world_staging_evidence WHERE dataset_id = ${datasetId} ORDER BY lesson_run_id, raw_evidence_id`.catch(() => []),
    sql`SELECT * FROM world_staging_node_cards WHERE dataset_id = ${datasetId} ORDER BY lesson_run_id, raw_card_id`.catch(() => []),
  ]);

  const evidenceById = new Map(evidence.map((row) => [`${row.lesson_run_id}:${row.raw_evidence_id}`, toStagingEvidence(row)]));
  const evidenceByAnchor = groupBy(evidence.map(toStagingEvidence), (row) => `${row.source_id}::${row.anchor_ref}`);
  const mentionsByNode = groupBy(mentions.filter((row) => row.target_type === 'node').map(toStagingMention), (row) => row.target_id);
  const edgesByFrom = groupBy(edges.map(toStagingRelation), (row) => row.from_id);
  const edgesByTo = groupBy(edges.map(toStagingRelation), (row) => row.to_id);
  const profilesByNode = groupBy(profiles.map(toStagingDomainProfile), (row) => row.node_id);
  const curriculumProjectionsByNode = groupBy(curriculumProjections.map(toStagingCurriculumProjection), (row) => row.node_id);
  const cardByNode = new Map(cards.map((row) => [`${row.lesson_run_id}:${row.raw_node_id}`, toStagingCard(row)]));

  const units = nodes.map((row) => {
    const node = toStagingNode(row);
    const unitMentions = mentionsByNode.get(node.id) ?? [];
    const unitEvidence = collectEvidence(unitMentions, evidenceById, evidenceByAnchor);
    return {
      node,
      relations: {
        outgoing: edgesByFrom.get(node.id) ?? [],
        incoming: edgesByTo.get(node.id) ?? [],
      },
      domain_profiles: profilesByNode.get(node.id) ?? [],
      curriculum_projections: curriculumProjectionsByNode.get(node.id) ?? [],
      mentions: unitMentions,
      evidence: unitEvidence,
      media: [],
      source_fragments: sourceFragmentsFromEvidence(unitEvidence),
      card: cardByNode.get(node.id) ?? null,
      body: null,
      completeness: {},
    };
  });
  const store = makeStore('staging', units);
  store.raw = { nodes, edges, profiles, curriculumProjections, mentions, evidence, cards };
  return store;
}

function makeStore(kind, units) {
  return {
    kind,
    units,
    byId: new Map(units.map((unit) => [unit.node.id, unit])),
  };
}

async function runVariant(sql, datasetId, cases, variant, store, flags) {
  let completed = 0;
  console.error(`[${variant.id}] start ${cases.length} cases`);
  const results = await mapLimit(cases, flags.concurrency, async (item) => {
    const retrieval = await retrieveForCase(sql, datasetId, item.question, variant, store, flags);
    const context = buildContext(item.question, retrieval.hits, variant);
    const generated = flags.generate
      ? await answerWithContext(item.question, context.text, variant)
      : null;
    const citationStats = generated
      ? validateCitations(generated.citations, retrieval.hits)
      : { valid: [], invalid: [] };
    const result = scoreCase(item, retrieval, context, generated, citationStats);
    completed += 1;
    console.error(`[${variant.id}] ${completed}/${cases.length} ${item.id}`);
    return result;
  });
  console.error(`[${variant.id}] completed`);

  const output = {
    variant_id: variant.id,
    label: variant.label,
    source: variant.source,
    retrieval: variant.retrieval,
    component_check: inspectVariantResults(variant, results),
    results,
  };
  output.summary = summarizeVariant(output);
  return output;
}

async function retrieveForCase(sql, datasetId, question, variant, store, flags) {
  if (variant.retrieval === 'node_vector') {
    const vectorHits = await retrieveNodeVector(sql, datasetId, question, flags.limit);
    const hits = vectorHits.rows
      .map((row) => store.byId.get(row.node_id))
      .filter(Boolean)
      .map((unit, index) => makeHit(unit, applyVariant(unit, variant), 1 / (index + 1), ['node_embedding'], rowSimilarity(vectorHits.rows[index])));
    return {
      requested_mode: 'node_vector',
      execution_mode: vectorHits.used ? 'full' : 'unavailable',
      hits,
      diagnostics: vectorHits,
    };
  }

  const seedLimit = variant.relationExpansion ? Math.min(flags.seedLimit, flags.limit) : flags.limit;
  const lexical = retrieveLexical(store.units, question, variant, seedLimit);
  let seedHits = lexical.map((row) => makeHit(row.unit, row.view, row.score, row.reasons, null));

  if (flags.useDbEmbeddings && variant.source === 'canonical' && (variant.id === 'A0' || variant.id === 'A5')) {
    const vectorHits = await retrieveUnitVector(sql, datasetId, question, seedLimit);
    seedHits = fuseSeedHits(seedHits, vectorHits.rows
      .map((row) => store.byId.get(row.node_id))
      .filter(Boolean)
      .map((unit, index) => makeHit(unit, applyVariant(unit, variant), 1 / (index + 1), ['unit_embedding'], rowSimilarity(vectorHits.rows[index]))), seedLimit);
  }

  const expanded = expandWithRelations(seedHits, store, variant, flags.limit);
  return {
    requested_mode: variant.retrieval,
    execution_mode: flags.useDbEmbeddings && (variant.id === 'A0' || variant.id === 'A5') ? 'hybrid_optional' : 'text_only',
    hits: expanded,
    diagnostics: {
      seed_count: seedHits.length,
      expanded_count: expanded.length - seedHits.length,
    },
  };
}

function retrieveLexical(units, question, variant, limit) {
  return units
    .map((unit) => {
      const view = applyVariant(unit, variant);
      const text = variant.nodeOnly ? nodeOnlyText(view.node) : composeRetrievalText(view);
      const score = lexicalScore(question, text);
      return { unit, view, score, reasons: ['variant_text'] };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.view.node.name.localeCompare(b.view.node.name, 'zh-CN'))
    .slice(0, limit);
}

async function retrieveUnitVector(sql, datasetId, question, limit) {
  const vector = await embedQuery(question);
  if (!vector.length) return { used: false, reason: 'embedding unavailable', rows: [] };
  const vecStr = `[${vector.join(',')}]`;
  const rows = await sql`
    SELECT node_id, 1 - (embedding <=> ${vecStr}::vector) AS similarity
    FROM world_unit_embeddings
    WHERE dataset_id = ${datasetId} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vecStr}::vector
    LIMIT ${limit}
  `.catch((error) => ({ error }));
  if (!Array.isArray(rows)) return { used: false, reason: rows.error?.message || 'unit vector query failed', rows: [] };
  return { used: true, rows };
}

async function retrieveNodeVector(sql, datasetId, question, limit) {
  const vector = await embedQuery(question);
  if (!vector.length) return { used: false, reason: 'embedding unavailable', rows: [] };
  const vecStr = `[${vector.join(',')}]`;
  const rows = await sql`
    SELECT id AS node_id, 1 - (embedding <=> ${vecStr}::vector) AS similarity
    FROM world_nodes
    WHERE dataset_id = ${datasetId}
      AND status != 'deprecated'
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vecStr}::vector
    LIMIT ${limit}
  `.catch((error) => ({ error }));
  if (!Array.isArray(rows)) return { used: false, reason: rows.error?.message || 'node vector query failed', rows: [] };
  return { used: true, rows };
}

async function embedQuery(text) {
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) return [];
  const url = process.env.EMBEDDING_URL || 'https://api.openai.com/v1/embeddings';
  const model = process.env.EMBEDDING_MODEL || 'Qwen/Qwen3-Embedding-4B';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: [text] }),
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const body = await response.json();
    const vector = body?.data?.[0]?.embedding;
    return Array.isArray(vector) ? vector.filter((value) => typeof value === 'number' && Number.isFinite(value)) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function expandWithRelations(seedHits, store, variant, limit) {
  if (!variant.relationExpansion || !variant.includeRelations || seedHits.length >= limit) return seedHits.slice(0, limit);
  const hits = [...seedHits];
  const seen = new Set(hits.map((hit) => hit.node_id));
  for (const hit of seedHits) {
    const relationIds = [...hit.unit.relations.outgoing, ...hit.unit.relations.incoming]
      .flatMap((relation) => [relation.from_id, relation.to_id])
      .filter((id) => id !== hit.node_id && !seen.has(id));
    for (const nodeId of relationIds) {
      const unit = store.byId.get(nodeId);
      if (!unit) continue;
      const view = applyVariant(unit, variant);
      hits.push(makeHit(unit, view, hit.score * 0.25, ['relation_expansion'], null));
      seen.add(nodeId);
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

function fuseSeedHits(first, second, limit) {
  const byId = new Map();
  for (const list of [first, second]) {
    for (const hit of list) {
      const existing = byId.get(hit.node_id);
      if (existing) {
        existing.score += hit.score;
        existing.reasons = unique([...existing.reasons, ...hit.reasons]);
        existing.similarity = existing.similarity ?? hit.similarity;
      } else {
        byId.set(hit.node_id, { ...hit });
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

function makeHit(unit, view, score, reasons, similarity) {
  return {
    node_id: view.node.id,
    canonical_name: view.node.name,
    node_kind: view.node.kind,
    score: round(score),
    similarity,
    reasons,
    unit: view,
  };
}

function applyVariant(unit, variant) {
  const view = cloneJson(unit);
  if (variant.nodeOnly) {
    view.node = nodeSkeleton(view.node);
    view.relations = { outgoing: [], incoming: [] };
    view.domain_profiles = [];
    view.curriculum_projections = [];
    view.mentions = [];
    view.evidence = [];
    view.media = [];
    view.source_fragments = [];
    view.card = null;
    view.body = null;
    view.completeness = {};
    return view;
  }
  if (!variant.includeBody) view.body = null;
  if (!variant.includeCard) view.card = null;
  if (!variant.includeRelations) view.relations = { outgoing: [], incoming: [] };
  if (!variant.includeProfiles) {
    view.domain_profiles = [];
    view.curriculum_projections = [];
  }
  if (variant.includeProfiles && !variant.includePedagogicalProfile) {
    view.curriculum_projections = view.curriculum_projections.map((projection) => {
      const next = cloneJson(projection);
      if (next.properties) delete next.properties.pedagogical_profile;
      return next;
    });
  }
  if (!variant.includeEvidence) {
    view.evidence = [];
    view.media = [];
    view.source_fragments = [];
    stripSourceRefs(view);
  }
  return view;
}

function stripSourceRefs(view) {
  for (const relation of [...view.relations.outgoing, ...view.relations.incoming]) relation.source_refs = [];
  for (const profile of view.domain_profiles) profile.source_refs = [];
  for (const projection of view.curriculum_projections) projection.source_refs = [];
  if (view.card) {
    view.card.source_refs = [];
    for (const section of view.card.sections ?? []) section.source_refs = [];
  }
  if (view.body) view.body.source_refs = [];
  for (const mention of view.mentions ?? []) mention.source_refs = [];
}

function buildContext(question, hits, variant) {
  const blocks = hits.map((hit, index) => unitContextBlock(hit.unit, index + 1, variant));
  const text = blocks.join('\n\n---\n\n');
  return {
    question,
    text,
    char_count: text.length,
  };
}

function unitContextBlock(unit, index, variant) {
  const node = unit.node;
  const relations = variant.includeRelations ? [...unit.relations.outgoing, ...unit.relations.incoming]
    .slice(0, 8)
    .map((relation) => `${relation.from_id} --${edgeTypeLabelZh(relation.type)}--> ${relation.to_id}`)
    .join('\n') : '';
  const profiles = variant.includeProfiles ? unit.domain_profiles
    .slice(0, 4)
    .map((profile) => `${profile.domain} ${profile.domain_role} ${stringifyCompact(profile.properties)}`.trim())
    .filter(Boolean)
    .join('\n') : '';
  const curriculumProjections = variant.includeProfiles ? unit.curriculum_projections
    .slice(0, 4)
    .map((projection) => {
      const pedagogical = projection.properties?.pedagogical_profile
        ? ` pedagogical_profile=${stringifyCompact(projection.properties.pedagogical_profile)}`
        : '';
      return `${projection.domain} ${projection.curriculum_id} ${projection.school_stage} ${projection.grade_band ?? ''} ${projection.curriculum_roles.join(',')}${pedagogical}`.trim();
    })
    .filter(Boolean)
    .join('\n') : '';
  const cardSections = unit.card?.sections
    ?.slice(0, 4)
    .map((section) => `${section.title}: ${truncate(stringifyContent(section.content), 700)}`)
    .join('\n') ?? '';
  const evidence = variant.includeEvidence ? unit.evidence
    .slice(0, 5)
    .map((item) => `evidence_id: ${item.id}\n${truncate(item.excerpt, 900)}`)
    .join('\n') : '';
  const fragments = variant.includeEvidence ? unit.source_fragments
    .slice(0, 2)
    .map((fragment) => `source_fragment: ${fragment.source_id}:${fragment.anchor_ref}\n${fragment.excerpts.map((item) => truncate(item.excerpt, 500)).join('\n')}`)
    .join('\n') : '';
  return [
    `Unit ${index}`,
    `node_id: ${node.id}`,
    `name: ${node.name}`,
    `kind: ${node.kind}`,
    node.definition ? `definition: ${node.definition}` : '',
    arrayText('aliases', node.aliases),
    arrayText('domains', node.domains),
    profiles ? `domain_profiles:\n${profiles}` : '',
    curriculumProjections ? `curriculum_projections:\n${curriculumProjections}` : '',
    unit.card?.summary ? `card_summary: ${truncate(unit.card.summary, 700)}` : '',
    cardSections ? `card_sections:\n${cardSections}` : '',
    unit.body?.content ? `body:\n${truncate(unit.body.content, 1200)}` : '',
    relations ? `relations:\n${relations}` : '',
    evidence ? `evidence:\n${evidence}` : '',
    fragments ? `source_fragments:\n${fragments}` : '',
  ].filter(Boolean).join('\n');
}

function composeRetrievalText(unit) {
  const node = unit.node;
  return normalizeText([
    node.name,
    node.kind,
    node.definition,
    ...(node.aliases ?? []),
    ...(node.domains ?? []),
    stringifyContent(node.properties?.semantic_core),
    unit.card?.summary,
    ...(unit.card?.sections ?? []).map((section) => `${section.title} ${stringifyContent(section.content)}`),
    unit.body?.content,
    ...unit.domain_profiles.map((profile) => [
      profile.domain,
      profile.domain_role,
      stringifyContent(profile.properties),
    ].join(' ')),
    ...unit.curriculum_projections.map((projection) => [
      projection.domain,
      projection.curriculum_id,
      projection.school_stage,
      projection.grade_band,
      ...(projection.curriculum_roles ?? []),
      stringifyContent(projection.properties),
    ].join(' ')),
    ...[...unit.relations.outgoing, ...unit.relations.incoming].map((relation) => `${edgeTypeLabelZh(relation.type)} ${relation.from_id} ${relation.to_id}`),
    ...unit.evidence.map((item) => `${item.id} ${item.excerpt}`),
  ].filter(Boolean).join('\n'));
}

function nodeOnlyText(node) {
  return normalizeText([node.id, node.name, node.kind, node.definition, ...(node.aliases ?? []), ...(node.domains ?? [])].join('\n'));
}

async function answerWithContext(question, context, variant) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing. Re-run without --generate for retrieval-only evaluation.');
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-4.1';
  const citationRule = variant.requireCitations
    ? '每个事实性回答尽量引用上下文中的 evidence_id。'
    : '本消融组不提供证据编号，citations 必须返回空数组。';
  const messages = [
    {
      role: 'system',
      content: '你是高中物理教材问答系统。只能使用给定上下文回答。返回严格 JSON，不要输出额外文本。',
    },
    {
      role: 'user',
      content: [
        `问题：${question}`,
        '',
        `消融组：${variant.id} ${variant.label}`,
        citationRule,
        '返回 JSON：{"answer":string,"citations":[{"node_id":string,"evidence_id":string,"note":string}],"unsupported_claims":string[]}',
        '',
        `上下文：\n${context}`,
      ].join('\n'),
    },
  ];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          await sleep(1500);
          continue;
        }
        throw new Error(`Model request failed with HTTP ${response.status}: ${detail.slice(0, 500)}`);
      }
      const body = await response.json();
      return normalizeModelJson(parseJsonObject(body?.choices?.[0]?.message?.content || '{}'));
    } catch (error) {
      if (attempt === 0) {
        await sleep(1500);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  return normalizeModelJson({});
}

function normalizeModelJson(value) {
  const object = isRecord(value) ? value : {};
  return {
    answer: String(object.answer || ''),
    citations: Array.isArray(object.citations)
      ? object.citations.filter(isRecord).map((item) => ({
        node_id: String(item.node_id || ''),
        evidence_id: String(item.evidence_id || ''),
        note: String(item.note || ''),
      }))
      : [],
    unsupported_claims: Array.isArray(object.unsupported_claims) ? object.unsupported_claims.map(String) : [],
  };
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = String(content).match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}

function validateCitations(citations, hits) {
  const evidenceByNode = new Map(hits.map((hit) => [hit.node_id, new Set(hit.unit.evidence.map((item) => item.id))]));
  const valid = [];
  const invalid = [];
  for (const citation of citations) {
    if (!citation.node_id || !citation.evidence_id) {
      invalid.push({ ...citation, reason: 'missing node_id or evidence_id' });
    } else if (!evidenceByNode.has(citation.node_id)) {
      invalid.push({ ...citation, reason: 'node was not retrieved' });
    } else if (!evidenceByNode.get(citation.node_id).has(citation.evidence_id)) {
      invalid.push({ ...citation, reason: 'evidence does not belong to retrieved node' });
    } else {
      valid.push(citation);
    }
  }
  return { valid, invalid };
}

function scoreCase(item, retrieval, context, generated, citationStats) {
  const retrievedNodeIds = retrieval.hits.map((hit) => hit.node_id);
  const expectedNodeIds = item.expected_node_ids ?? [];
  const expected = new Set(expectedNodeIds);
  const hitCount = retrievedNodeIds.filter((id) => expected.has(id)).length;
  const matchedTerms = generated ? matchTerms(generated.answer, item.expected_terms ?? []) : [];
  return {
    id: item.id,
    question: item.question,
    task_type: item.task_type || 'unknown',
    expected_node_ids: expectedNodeIds,
    expected_terms: item.expected_terms ?? [],
    retrieved_node_ids: retrievedNodeIds,
    retrieval_hit_count: hitCount,
    retrieval_hit: expectedNodeIds.length ? hitCount > 0 : retrievedNodeIds.length > 0,
    retrieval_recall: expectedNodeIds.length ? round(hitCount / expectedNodeIds.length) : null,
    context_char_count: context.char_count,
    answer: generated?.answer ?? null,
    matched_terms: matchedTerms,
    term_coverage: generated && (item.expected_terms ?? []).length ? round(matchedTerms.length / item.expected_terms.length) : null,
    citations: generated?.citations ?? [],
    valid_citation_count: generated ? citationStats.valid.length : null,
    invalid_citation_count: generated ? citationStats.invalid.length : null,
    unsupported_claim_count: generated ? generated.unsupported_claims.length : null,
    unsupported_claims: generated?.unsupported_claims ?? [],
    retrieval_diagnostics: retrieval.diagnostics,
    component_probe: inspectHits(retrieval.hits),
  };
}

function inspectVariantResults(variant, results) {
  const probes = results.map((result) => result.component_probe);
  const merged = {
    evidence_count: sum(probes.map((probe) => probe.evidence_count)),
    source_fragment_count: sum(probes.map((probe) => probe.source_fragment_count)),
    body_count: sum(probes.map((probe) => probe.body_count)),
    domain_profile_count: sum(probes.map((probe) => probe.domain_profile_count)),
    curriculum_projection_count: sum(probes.map((probe) => probe.curriculum_projection_count)),
    pedagogical_profile_count: sum(probes.map((probe) => probe.pedagogical_profile_count)),
    relation_count: sum(probes.map((probe) => probe.relation_count)),
    card_count: sum(probes.map((probe) => probe.card_count)),
  };
  return {
    ...merged,
    passed: componentCheckPassed(variant, merged),
  };
}

function componentCheckPassed(variant, probe) {
  if (variant.id === 'A1') return probe.evidence_count === 0 && probe.source_fragment_count === 0;
  if (variant.id === 'A2') return probe.body_count === 0;
  if (variant.id === 'A3') return probe.domain_profile_count === 0 && probe.curriculum_projection_count === 0 && probe.pedagogical_profile_count === 0;
  if (variant.id === 'A4') return probe.relation_count === 0;
  if (variant.id === 'A6') return true;
  if (variant.id === 'A7') return probe.evidence_count === 0 && probe.body_count === 0 && probe.domain_profile_count === 0 && probe.curriculum_projection_count === 0 && probe.relation_count === 0 && probe.card_count === 0;
  return true;
}

function inspectHits(hits) {
  return {
    evidence_count: sum(hits.map((hit) => hit.unit.evidence.length)),
    source_fragment_count: sum(hits.map((hit) => hit.unit.source_fragments.length)),
    body_count: hits.filter((hit) => hit.unit.body?.content).length,
    domain_profile_count: sum(hits.map((hit) => hit.unit.domain_profiles.length)),
    curriculum_projection_count: sum(hits.map((hit) => hit.unit.curriculum_projections.length)),
    pedagogical_profile_count: sum(hits.map((hit) => hit.unit.curriculum_projections.filter((projection) => projection.properties?.pedagogical_profile).length)),
    relation_count: sum(hits.map((hit) => hit.unit.relations.outgoing.length + hit.unit.relations.incoming.length)),
    card_count: hits.filter((hit) => hit.unit.card).length,
  };
}

function summarizeVariant(output) {
  const results = output.results;
  const generated = results.filter((item) => item.term_coverage !== null);
  const validCitationTotal = sum(results.map((item) => item.valid_citation_count ?? 0));
  const invalidCitationTotal = sum(results.map((item) => item.invalid_citation_count ?? 0));
  return {
    cases: results.length,
    retrieval_hit_rate: round(avg(results.map((item) => item.retrieval_hit ? 1 : 0))),
    average_retrieval_recall: round(avg(results.map((item) => item.retrieval_recall ?? 0))),
    average_term_coverage: generated.length ? round(avg(generated.map((item) => item.term_coverage ?? 0))) : null,
    valid_citation_rate: validCitationTotal + invalidCitationTotal > 0 ? round(validCitationTotal / (validCitationTotal + invalidCitationTotal)) : null,
    invalid_citation_count: results.some((item) => item.invalid_citation_count !== null) ? invalidCitationTotal : null,
    unsupported_claim_count: results.some((item) => item.unsupported_claim_count !== null) ? sum(results.map((item) => item.unsupported_claim_count ?? 0)) : null,
    average_context_chars: round(avg(results.map((item) => item.context_char_count))),
  };
}

function summarizeRetrieval(run) {
  return {
    generated_at: run.generated_at,
    source: run.source,
    case_count: run.case_count,
    methods: run.variants.map((variant) => ({
      variant_id: variant.variant_id,
      label: variant.label,
      source: variant.source,
      retrieval: variant.retrieval,
      component_check_passed: variant.component_check.passed,
      ...variant.summary,
      by_task_type: summarizeByTaskType(variant.results),
    })),
  };
}

function summarizeByTaskType(results) {
  const groups = groupBy(results, (item) => item.task_type);
  return Object.fromEntries([...groups.entries()].map(([taskType, rows]) => [taskType, {
    cases: rows.length,
    retrieval_hit_rate: round(avg(rows.map((item) => item.retrieval_hit ? 1 : 0))),
    average_retrieval_recall: round(avg(rows.map((item) => item.retrieval_recall ?? 0))),
    average_term_coverage: rows.some((item) => item.term_coverage !== null)
      ? round(avg(rows.map((item) => item.term_coverage ?? 0)))
      : null,
  }]));
}

function summarizeRun(run, retrievalMetrics) {
  return {
    generated_at: run.generated_at,
    experiment: run.experiment,
    source: run.source,
    case_count: run.case_count,
    generated_answers: run.generated_answers,
    variants: retrievalMetrics.methods.map((item) => ({
      variant_id: item.variant_id,
      label: item.label,
      component_check_passed: item.component_check_passed,
      retrieval_hit_rate: item.retrieval_hit_rate,
      average_retrieval_recall: item.average_retrieval_recall,
      average_term_coverage: item.average_term_coverage,
      valid_citation_rate: item.valid_citation_rate,
      unsupported_claim_count: item.unsupported_claim_count,
      average_context_chars: item.average_context_chars,
    })),
    construction_metrics: run.construction_metrics,
  };
}

function scoreStagingConstruction(store) {
  const raw = store.raw ?? { nodes: [], edges: [], profiles: [], curriculumProjections: [], evidence: [], cards: [] };
  const nodeNames = raw.nodes.map((node) => normalizeForMatch(node.name)).filter(Boolean);
  const duplicateCount = nodeNames.length - new Set(nodeNames).size;
  const nodeEvidenceRefs = raw.nodes.flatMap((node) => jsonArray(node.source_refs_json));
  const nodesWithEvidence = raw.nodes.filter((node) => jsonArray(node.source_refs_json).length > 0).length;
  const invalidNodeKinds = raw.nodes.filter((node) => !ALLOWED_NODE_KINDS.has(String(node.kind))).length;
  const invalidEdgeTypes = raw.edges.filter((edge) => !ALLOWED_EDGE_TYPES.has(String(edge.type))).length;
  return {
    status: 'proxy_only',
    reason: 'A6 intentionally uses raw staging rows without canonical merge mapping. F1 requires a separate gold-construction file and is not inferred here.',
    raw_nodes: raw.nodes.length,
    raw_edges: raw.edges.length,
    raw_evidence: raw.evidence.length,
    raw_domain_profiles: raw.profiles.length,
    raw_curriculum_projections: raw.curriculumProjections.length,
    raw_cards: raw.cards.length,
    node_f1: null,
    relation_f1: null,
    evidence_hit_rate: raw.nodes.length ? round(nodesWithEvidence / raw.nodes.length) : null,
    duplicate_rate: nodeNames.length ? round(duplicateCount / nodeNames.length) : null,
    schema_violation_rate: raw.nodes.length + raw.edges.length
      ? round((invalidNodeKinds + invalidEdgeTypes) / (raw.nodes.length + raw.edges.length))
      : null,
    hallucination_rate: null,
    human_review_cost: raw.nodes.length - nodesWithEvidence + duplicateCount + invalidNodeKinds + invalidEdgeTypes,
    evidence_ref_count: nodeEvidenceRefs.length,
  };
}

function writeReport(path, summary, retrievalMetrics, constructionMetrics) {
  const lines = [
    '# OKM ApiUnit 消融实验报告',
    '',
    `生成时间：${summary.generated_at}`,
    '',
    '## 运行范围',
    '',
    `- 数据集：${summary.source}`,
    `- 题目数：${summary.case_count}`,
    `- 是否生成回答：${summary.generated_answers ? '是' : '否'}`,
    '',
    '## 消融结果摘要',
    '',
    '| variant | component check | hit@8 | recall@8 | term coverage | citation rate | unsupported | avg context chars |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...summary.variants.map((item) => [
      item.variant_id,
      item.component_check_passed ? 'pass' : 'fail',
      item.retrieval_hit_rate,
      item.average_retrieval_recall,
      item.average_term_coverage ?? '',
      item.valid_citation_rate ?? '',
      item.unsupported_claim_count ?? '',
      item.average_context_chars,
    ].join(' | ')).map((row) => `| ${row} |`),
    '',
    '## A6 构建治理消融',
    '',
    'A6 使用 `world_staging_*` 暂存结果，不读取 canonical 映射，也不写入正式表。',
    '',
    '```json',
    JSON.stringify(constructionMetrics, null, 2),
    '```',
    '',
    '## 输出文件',
    '',
    '- `variant-results.json`：每个题目、每个消融组的检索与生成结果。',
    '- `retrieval-metrics.json`：按方法和题型聚合的检索指标。',
    '- `ablation-summary.json`：论文表格可读摘要。',
    '- `blind-review-sheet.jsonl`：由 `build-review-sheet.mjs` 生成。',
  ];
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

function readCases(path) {
  if (!existsSync(path)) throw new Error(`Case file not found: ${path}`);
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line, index) => {
      try {
        const item = JSON.parse(line);
        if (!item.id || !item.question) throw new Error('missing id or question');
        return item;
      } catch (error) {
        throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error.message}`);
      }
    });
}

function toNode(row) {
  return {
    id: row.id,
    dataset_id: row.dataset_id,
    name: row.name,
    kind: row.kind,
    subkind: row.subkind ?? null,
    definition: row.definition ?? '',
    aliases: jsonArray(row.aliases_json),
    domains: jsonArray(row.domains_json),
    knowledge_form: jsonArray(row.knowledge_form_json),
    learning_mode: jsonArray(row.learning_mode_json),
    scope: row.scope ?? null,
    properties: jsonObject(row.properties_json),
    external_ids: jsonObject(row.external_ids_json),
    tags: jsonArray(row.tags_json),
    status: row.status,
  };
}

function toStagingNode(row) {
  return {
    id: `${row.lesson_run_id}:${row.raw_node_id}`,
    raw_node_id: row.raw_node_id,
    lesson_run_id: row.lesson_run_id,
    dataset_id: row.dataset_id,
    name: row.name,
    kind: row.kind,
    subkind: row.subkind ?? null,
    definition: row.definition ?? '',
    aliases: jsonArray(row.aliases_json),
    domains: jsonArray(row.domains_json),
    knowledge_form: jsonArray(row.knowledge_form_json),
    learning_mode: jsonArray(row.learning_mode_json),
    scope: row.scope ?? null,
    properties: jsonObject(row.properties_json),
    external_ids: jsonObject(row.external_ids_json),
    tags: jsonArray(row.tags_json),
    status: row.status,
  };
}

function toRelation(row) {
  return {
    id: row.id,
    dataset_id: row.dataset_id,
    type: row.type,
    from_id: row.from_id,
    to_id: row.to_id,
    directionality: row.directionality,
    confidence: Number(row.confidence ?? 0),
    source_refs: jsonArray(row.source_refs_json),
    properties: jsonObject(row.properties_json),
    status: row.status,
  };
}

function toStagingRelation(row) {
  return {
    id: `${row.lesson_run_id}:${row.raw_edge_id}`,
    dataset_id: row.dataset_id,
    type: row.type,
    from_id: `${row.lesson_run_id}:${row.from_raw_node_id}`,
    to_id: `${row.lesson_run_id}:${row.to_raw_node_id}`,
    directionality: row.directionality,
    confidence: Number(row.confidence ?? 0),
    source_refs: jsonArray(row.source_refs_json).map((ref) => `${row.lesson_run_id}:${ref}`),
    properties: jsonObject(row.properties_json),
    status: row.status,
  };
}

function toDomainProfile(row) {
  return {
    id: row.id,
    dataset_id: row.dataset_id,
    node_id: row.node_id,
    domain: row.domain,
    schema_id: row.schema_id,
    schema_version: row.schema_version,
    domain_role: row.domain_role,
    source_refs: jsonArray(row.source_refs_json),
    properties: jsonObject(row.properties_json),
    status: row.status,
  };
}

function toStagingDomainProfile(row) {
  return {
    id: `${row.lesson_run_id}:${row.raw_profile_id}`,
    dataset_id: row.dataset_id,
    node_id: `${row.lesson_run_id}:${row.raw_node_id}`,
    domain: row.domain,
    schema_id: row.schema_id,
    schema_version: row.schema_version,
    domain_role: row.domain_role,
    source_refs: jsonArray(row.source_refs_json).map((ref) => `${row.lesson_run_id}:${ref}`),
    properties: jsonObject(row.properties_json),
    status: row.status,
  };
}

function toCurriculumProjection(row) {
  return {
    id: row.id,
    dataset_id: row.dataset_id,
    node_id: row.node_id,
    domain: row.domain,
    curriculum_id: row.curriculum_id,
    school_stage: row.school_stage,
    grade_band: row.grade_band ?? null,
    curriculum_roles: jsonArray(row.curriculum_roles_json),
    source_refs: jsonArray(row.source_refs_json),
    properties: jsonObject(row.properties_json),
    status: row.status,
  };
}

function toStagingCurriculumProjection(row) {
  return {
    id: `${row.lesson_run_id}:${row.raw_projection_id}`,
    dataset_id: row.dataset_id,
    node_id: `${row.lesson_run_id}:${row.raw_node_id}`,
    domain: row.domain,
    curriculum_id: row.curriculum_id,
    school_stage: row.school_stage,
    grade_band: row.grade_band ?? null,
    curriculum_roles: jsonArray(row.curriculum_roles_json),
    source_refs: jsonArray(row.source_refs_json).map((ref) => `${row.lesson_run_id}:${ref}`),
    properties: jsonObject(row.properties_json),
    status: row.status,
  };
}

function toMention(row) {
  return {
    id: row.id,
    dataset_id: row.dataset_id,
    source_type: row.source_type,
    source_id: row.source_id,
    anchor_ref: row.anchor_ref,
    target_type: row.target_type,
    target_id: row.target_id,
    role: row.role,
    source_refs: jsonArray(row.source_refs_json),
    confidence: Number(row.confidence ?? 0),
    properties: jsonObject(row.properties_json),
  };
}

function toStagingMention(row) {
  return {
    id: `${row.lesson_run_id}:${row.raw_mention_id}`,
    dataset_id: row.dataset_id,
    source_type: row.source_type,
    source_id: row.source_id,
    anchor_ref: row.anchor_ref,
    target_type: row.target_type,
    target_id: `${row.lesson_run_id}:${row.target_raw_id}`,
    role: row.role,
    source_refs: jsonArray(row.source_refs_json).map((ref) => `${row.lesson_run_id}:${ref}`),
    confidence: Number(row.confidence ?? 0),
    properties: jsonObject(row.properties_json),
  };
}

function toEvidence(row) {
  return {
    id: row.id,
    dataset_id: row.dataset_id,
    source_type: row.source_type,
    source_id: row.source_id,
    anchor_ref: row.anchor_ref,
    excerpt: row.excerpt ?? '',
    locator: row.locator ?? '',
    extraction_method: row.extraction_method ?? '',
    normalized_claims: jsonArray(row.normalized_claims_json),
    properties: jsonObject(row.properties_json),
  };
}

function toStagingEvidence(row) {
  return {
    id: `${row.lesson_run_id}:${row.raw_evidence_id}`,
    dataset_id: row.dataset_id,
    source_type: row.source_type,
    source_id: row.source_id,
    anchor_ref: row.anchor_ref,
    excerpt: row.excerpt ?? '',
    locator: row.locator ?? '',
    extraction_method: row.extraction_method ?? '',
    normalized_claims: jsonArray(row.normalized_claims_json),
    properties: jsonObject(row.properties_json),
  };
}

function toCard(row) {
  return {
    id: row.id,
    node_id: row.node_id,
    title: row.title,
    summary: row.summary,
    source_refs: jsonArray(row.source_refs_json),
    sections: jsonArray(row.sections_json),
    properties: jsonObject(row.properties_json),
    status: row.status,
  };
}

function toStagingCard(row) {
  return {
    id: `${row.lesson_run_id}:${row.raw_card_id}`,
    node_id: `${row.lesson_run_id}:${row.raw_node_id}`,
    title: row.title,
    summary: row.summary,
    source_refs: jsonArray(row.source_refs_json).map((ref) => `${row.lesson_run_id}:${ref}`),
    sections: jsonArray(row.sections_json),
    properties: jsonObject(row.properties_json),
    status: row.status,
  };
}

function toBody(row) {
  return {
    node_id: row.node_id,
    format: row.format,
    content: row.content,
    media_refs: jsonArray(row.media_refs_json),
    source_refs: jsonArray(row.source_refs_json),
    generated_from: row.generated_from,
    properties: jsonObject(row.properties_json),
    status: row.status,
  };
}

function collectEvidence(mentions, evidenceById, evidenceByAnchor) {
  const byId = new Map();
  for (const mention of mentions) {
    for (const ref of mention.source_refs ?? []) {
      const evidence = evidenceById.get(ref);
      if (evidence) byId.set(evidence.id, evidence);
    }
    for (const evidence of evidenceByAnchor.get(`${mention.source_id}::${mention.anchor_ref}`) ?? []) {
      byId.set(evidence.id, evidence);
    }
  }
  return [...byId.values()];
}

function sourceFragmentsFromEvidence(evidence) {
  const groups = groupBy(evidence, (item) => `${item.source_id}::${item.anchor_ref}`);
  return [...groups.entries()].map(([key, excerpts]) => {
    const [source_id, anchor_ref] = key.split('::');
    return {
      source_id,
      anchor_ref,
      modalities: unique(excerpts.map((item) => item.properties?.modality || item.modality || 'text').map(String)),
      excerpts,
    };
  });
}

function lexicalScore(query, text) {
  const terms = buildSearchTerms(query);
  const haystack = normalizeForMatch(text);
  let score = 0;
  for (const term of terms) {
    const normalized = normalizeForMatch(term);
    if (!normalized) continue;
    if (haystack.includes(normalized)) score += Math.max(1, Math.min(8, normalized.length));
  }
  return score;
}

function buildSearchTerms(query) {
  const normalized = query.trim();
  const terms = new Set([normalized]);
  for (const part of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (part.trim().length >= 2) terms.add(part.trim());
  }
  for (const match of normalized.matchAll(/[\u3400-\u9fff]{2,}/g)) {
    const text = match[0];
    for (let size = Math.min(8, text.length); size >= 2; size -= 1) {
      for (let index = 0; index <= text.length - size; index += 1) {
        terms.add(text.slice(index, index + size));
        if (terms.size >= 60) return [...terms];
      }
    }
  }
  return [...terms];
}

function matchTerms(text, terms) {
  return terms.filter((term) => normalizeForMatch(text).includes(normalizeForMatch(term)));
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function nodeSkeleton(node) {
  return {
    id: node.id,
    dataset_id: node.dataset_id,
    name: node.name,
    kind: node.kind,
    subkind: node.subkind ?? null,
    definition: node.definition ?? '',
    aliases: node.aliases ?? [],
    domains: node.domains ?? [],
    properties: {},
  };
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function jsonObject(value) {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stringifyContent(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function stringifyCompact(value) {
  return JSON.stringify(value);
}

function arrayText(label, values) {
  return Array.isArray(values) && values.length ? `${label}: ${values.join(', ')}` : '';
}

function truncate(value, maxChars) {
  const text = String(value ?? '').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeForMatch(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '');
}

function rowSimilarity(row) {
  const value = Number(row?.similarity);
  return Number.isFinite(value) ? round(value) : null;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim()))];
}

function sum(values) {
  return values.reduce((acc, value) => acc + Number(value || 0), 0);
}

function avg(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length ? sum(usable) / usable.length : 0;
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
