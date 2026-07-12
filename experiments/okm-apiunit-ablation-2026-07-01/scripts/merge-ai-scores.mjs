#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = resolve(SCRIPT_DIR, '..');
const OUTPUT_DIR = resolve(EXP_DIR, 'outputs');
const SHEET_PATH = resolve(OUTPUT_DIR, 'blind-review-sheet.jsonl');

const SCORE_FIELDS = ['correctness_1_5', 'evidence_1_5', 'teaching_1_5'];
const CSV_HEADERS = [
  'review_id',
  'method_code',
  'case_id',
  'task_type',
  ...SCORE_FIELDS,
  'total_3_15',
  'notes',
];

main();

function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (!existsSync(flags.sheetPath)) throw new Error(`Review sheet not found: ${flags.sheetPath}`);
  const reviewRows = readJsonl(flags.sheetPath);
  const reviewById = new Map(reviewRows.map((row) => [row.review_id, row]));
  const files = flags.files.length ? flags.files : discoverScoreFiles(flags.outputDir);
  if (!files.length) throw new Error(`No score files found in ${flags.outputDir}`);

  const rows = [];
  const issues = [];
  const seen = new Set();
  for (const file of files) {
    const parsed = readScoreCsv(file);
    for (const row of parsed.rows) {
      const issuePrefix = `${file}:${row.review_id || '<missing review_id>'}`;
      if (!reviewById.has(row.review_id)) {
        issues.push(`${issuePrefix}: unknown review_id`);
        continue;
      }
      if (seen.has(row.review_id)) {
        issues.push(`${issuePrefix}: duplicate review_id`);
        continue;
      }
      const review = reviewById.get(row.review_id);
      const normalized = normalizeScoreRow(row, review, issuePrefix, issues);
      rows.push(normalized);
      seen.add(row.review_id);
    }
  }

  const missing = reviewRows.filter((row) => !seen.has(row.review_id));
  const sortedRows = reviewRows
    .map((row) => rows.find((score) => score.review_id === row.review_id))
    .filter(Boolean);

  writeFileSync(flags.outPath, `${CSV_HEADERS.join(',')}\n${sortedRows.map(csvRow).join('\n')}${sortedRows.length ? '\n' : ''}`, 'utf8');

  const summary = {
    generated_at: new Date().toISOString(),
    input_files: files,
    output_file: flags.outPath,
    expected_rows: reviewRows.length,
    merged_rows: sortedRows.length,
    missing_rows: missing.length,
    duplicate_or_invalid_issues: issues.length,
    issues,
    by_method: summarizeBy(sortedRows, 'method_code'),
    by_task_type: summarizeBy(sortedRows, 'task_type'),
  };
  writeFileSync(flags.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

function parseFlags(argv) {
  const flags = {
    outputDir: OUTPUT_DIR,
    sheetPath: SHEET_PATH,
    outPath: resolve(OUTPUT_DIR, 'ai-assisted-scores.csv'),
    summaryPath: resolve(OUTPUT_DIR, 'ai-assisted-scores-summary.json'),
    files: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') {
      flags.outputDir = resolve(requireValue(argv, ++index, arg));
      flags.outPath = resolve(flags.outputDir, 'ai-assisted-scores.csv');
      flags.summaryPath = resolve(flags.outputDir, 'ai-assisted-scores-summary.json');
    } else if (arg === '--sheet') {
      flags.sheetPath = resolve(requireValue(argv, ++index, arg));
    } else if (arg === '--out') {
      flags.outPath = resolve(requireValue(argv, ++index, arg));
    } else if (arg === '--summary') {
      flags.summaryPath = resolve(requireValue(argv, ++index, arg));
    } else if (arg === '--files') {
      flags.files = requireValue(argv, ++index, arg).split(',').map((file) => resolve(file.trim())).filter(Boolean);
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
    'Usage: node experiments/okm-apiunit-ablation-2026-07-01/scripts/merge-ai-scores.mjs [options]',
    '',
    'Options:',
    '  --output-dir <dir>       Directory containing ai-scores-agent-*.csv',
    '  --files <a.csv,b.csv>    Explicit score files',
    '  --sheet <path>           blind-review-sheet.jsonl path',
    '  --out <path>             merged CSV path',
    '  --summary <path>         summary JSON path',
  ].join('\n'));
}

function discoverScoreFiles(outputDir) {
  if (!existsSync(outputDir)) return [];
  return readdirSync(outputDir)
    .filter((file) => /^ai-scores-agent-.+\.csv$/.test(file))
    .sort()
    .map((file) => resolve(outputDir, file));
}

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readScoreCsv(path) {
  if (!existsSync(path)) throw new Error(`Score file not found: ${path}`);
  const [header, ...body] = parseCsv(readFileSync(path, 'utf8'));
  const missingHeaders = CSV_HEADERS.filter((name) => !header.includes(name));
  if (missingHeaders.length) throw new Error(`${path} is missing headers: ${missingHeaders.join(', ')}`);
  const index = new Map(header.map((name, offset) => [name, offset]));
  return {
    path,
    rows: body
      .filter((cells) => cells.some((cell) => cell !== ''))
      .map((cells) => Object.fromEntries(CSV_HEADERS.map((name) => [name, cells[index.get(name)] ?? '']))),
  };
}

function normalizeScoreRow(row, review, issuePrefix, issues) {
  const next = {
    review_id: review.review_id,
    method_code: review.method_code,
    case_id: review.case_id,
    task_type: review.task_type,
    correctness_1_5: normalizeScore(row.correctness_1_5, `${issuePrefix}: correctness_1_5`, issues),
    evidence_1_5: normalizeScore(row.evidence_1_5, `${issuePrefix}: evidence_1_5`, issues),
    teaching_1_5: normalizeScore(row.teaching_1_5, `${issuePrefix}: teaching_1_5`, issues),
    total_3_15: '',
    notes: String(row.notes || ''),
  };
  if (SCORE_FIELDS.every((field) => next[field] !== '')) {
    next.total_3_15 = String(SCORE_FIELDS.reduce((sum, field) => sum + Number(next[field]), 0));
  }
  if (row.total_3_15 && next.total_3_15 && String(row.total_3_15) !== next.total_3_15) {
    issues.push(`${issuePrefix}: total_3_15 corrected from ${row.total_3_15} to ${next.total_3_15}`);
  }
  return next;
}

function normalizeScore(value, label, issues) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) {
    issues.push(`${label} must be an integer from 1 to 5`);
    return '';
  }
  return String(number);
}

function summarizeBy(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[field] || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups.entries()].sort().map(([key, items]) => [key, {
    rows: items.length,
    average_total_3_15: round(avg(items.map((item) => Number(item.total_3_15 || 0)).filter(Boolean))),
  }]));
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

function csvRow(row) {
  return CSV_HEADERS.map((name) => csvCell(row[name] ?? '')).join(',');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function avg(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value) {
  return value === null ? null : Math.round(value * 1000) / 1000;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}
