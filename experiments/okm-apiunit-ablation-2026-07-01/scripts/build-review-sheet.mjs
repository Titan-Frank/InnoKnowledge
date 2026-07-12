#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = resolve(SCRIPT_DIR, '..');
const DEFAULT_OUTPUT_DIR = resolve(EXP_DIR, 'outputs');
const DEFAULT_RESULTS_PATH = resolve(DEFAULT_OUTPUT_DIR, 'variant-results.json');

main();

function main() {
  const flags = parseFlags(process.argv.slice(2));
  mkdirSync(flags.outputDir, { recursive: true });
  if (!existsSync(flags.resultsPath)) throw new Error(`Result file not found: ${flags.resultsPath}`);

  const run = JSON.parse(readFileSync(flags.resultsPath, 'utf8'));
  const codeMap = methodCodes(run.variants.map((variant) => variant.variant_id), flags.seed);
  const rows = [];

  for (const variant of run.variants) {
    const methodCode = codeMap.get(variant.variant_id);
    for (const result of variant.results) {
      if (!result.answer) continue;
      rows.push({
        review_id: stableReviewId(methodCode, result.id),
        method_code: methodCode,
        case_id: result.id,
        task_type: result.task_type,
        question: result.question,
        answer: result.answer,
        citations: result.citations,
        unsupported_claims: result.unsupported_claims,
        expected_terms_for_calibration: result.expected_terms,
        scores: {
          correctness_1_5: '',
          evidence_1_5: '',
          teaching_1_5: '',
          total_3_15: '',
          notes: '',
        },
      });
    }
  }

  const sortedRows = deterministicShuffle(rows, flags.seed);
  const sheetPath = resolve(flags.outputDir, 'blind-review-sheet.jsonl');
  const csvPath = resolve(flags.outputDir, 'human-scores.csv');
  const keyPath = resolve(flags.outputDir, 'blind-review-key.json');

  writeFileSync(sheetPath, `${sortedRows.map((row) => JSON.stringify(row)).join('\n')}${sortedRows.length ? '\n' : ''}`, 'utf8');
  writeFileSync(csvPath, csvRows(sortedRows), 'utf8');
  writeFileSync(keyPath, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    note: 'Do not share this file with blind reviewers.',
    methods: run.variants.map((variant) => ({
      method_code: codeMap.get(variant.variant_id),
      variant_id: variant.variant_id,
      label: variant.label,
    })).sort((a, b) => a.method_code.localeCompare(b.method_code)),
  }, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    status: 'success',
    review_rows: sortedRows.length,
    sheet: sheetPath,
    scores: csvPath,
    key: keyPath,
  }, null, 2));
}

function parseFlags(argv) {
  const flags = {
    resultsPath: DEFAULT_RESULTS_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
    seed: 'okm-apiunit-ablation-2026-07-01',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--results':
        flags.resultsPath = resolve(requireValue(argv, ++index, arg));
        break;
      case '--output-dir':
        flags.outputDir = resolve(requireValue(argv, ++index, arg));
        break;
      case '--seed':
        flags.seed = requireValue(argv, ++index, arg);
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
    'Usage: node experiments/okm-apiunit-ablation-2026-07-01/scripts/build-review-sheet.mjs [options]',
    '',
    'Options:',
    '  --results <path>       variant-results.json path',
    '  --output-dir <path>    Output directory',
    '  --seed <text>          Deterministic shuffle seed',
  ].join('\n'));
}

function methodCodes(variantIds, seed) {
  const shuffled = deterministicShuffle([...variantIds], seed);
  return new Map(shuffled.map((variantId, index) => [variantId, `M${String(index + 1).padStart(2, '0')}`]));
}

function deterministicShuffle(items, seed) {
  return [...items].sort((a, b) => hash(`${seed}:${JSON.stringify(a)}`) - hash(`${seed}:${JSON.stringify(b)}`));
}

function stableReviewId(methodCode, caseId) {
  return `review-${methodCode}-${hash(caseId).toString(16).padStart(8, '0')}`;
}

function csvRows(rows) {
  const header = [
    'review_id',
    'method_code',
    'case_id',
    'task_type',
    'correctness_1_5',
    'evidence_1_5',
    'teaching_1_5',
    'total_3_15',
    'notes',
  ];
  const body = rows.map((row) => [
    row.review_id,
    row.method_code,
    row.case_id,
    row.task_type,
    '',
    '',
    '',
    '',
    '',
  ].map(csvCell).join(','));
  return `${header.join(',')}\n${body.join('\n')}${body.length ? '\n' : ''}`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function hash(value) {
  let h = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}
