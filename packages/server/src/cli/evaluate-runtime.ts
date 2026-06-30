#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GroundedGenerationResponse, UnitRetrievalMode, UnitRetrievalResponse } from '@okm/types';
import { closePool, createPool } from '../db/connection.js';
import { resolveDatasetRow } from '../db/queries.js';
import { generateGroundedAnswer, MissingModelConfigurationError } from '../runtime/grounded-generation.js';
import { retrieveApiUnits } from '../runtime/unit-retrieval.js';
import { DEFAULT_DATABASE_URL, REPO_ROOT } from '../utils/paths.js';

interface EvalCase {
  id: string;
  question: string;
  expected_node_ids?: string[];
  expected_terms?: string[];
}

interface EvalCaseResult {
  id: string;
  question: string;
  expected_node_ids: string[];
  retrieved_node_ids: string[];
  retrieval_hit_count: number;
  retrieval_hit: boolean;
  answer: string | null;
  expected_terms: string[];
  matched_terms: string[];
  term_coverage: number | null;
  valid_citation_count: number | null;
  invalid_citation_count: number | null;
  unsupported_claim_count: number | null;
  grounding_status: GroundedGenerationResponse['grounding']['status'] | null;
}

interface EvalSummary {
  source: string;
  cases: number;
  generated: boolean;
  limit: number;
  retrieval_mode: UnitRetrievalMode;
  retrieval_hit_rate: number;
  average_retrieval_recall: number;
  average_term_coverage: number | null;
  valid_citation_rate: number | null;
  invalid_citation_count: number | null;
  unsupported_claim_count: number | null;
  results: EvalCaseResult[];
}

interface Flags {
  db: string;
  source: string;
  casesPath: string;
  limit: number;
  retrievalMode: UnitRetrievalMode;
  generate: boolean;
}

const DEFAULT_CASES_PATH = resolve(REPO_ROOT, 'experiments/runtime-apiunit-grounding-small.jsonl');

async function main(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const cases = readCases(flags.casesPath);
  const sql = createPool(flags.db);
  try {
    const dataset = await resolveDatasetRow(sql, flags.source);
    if (!dataset) throw new Error(`Source "${flags.source}" not found.`);

    const results: EvalCaseResult[] = [];
    for (const item of cases) {
      if (flags.generate) {
        const response = await generateGroundedAnswer(sql, {
          datasetId: dataset.dataset_id,
          sourceKey: flags.source,
          question: item.question,
          limit: flags.limit,
          retrievalMode: flags.retrievalMode,
        });
        results.push(scoreGeneratedCase(item, response));
      } else {
        const response = await retrieveApiUnits(sql, {
          datasetId: dataset.dataset_id,
          sourceKey: flags.source,
          query: item.question,
          limit: flags.limit,
          mode: flags.retrievalMode,
        });
        results.push(scoreRetrievalOnlyCase(item, response));
      }
    }

    const summary = summarize(flags, dataset.dataset_id, results);
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  } catch (error) {
    if (error instanceof MissingModelConfigurationError) {
      console.error('OPENAI_API_KEY is not configured. Re-run without --generate to evaluate retrieval only.');
      return 2;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await closePool(sql);
  }
}

function scoreGeneratedCase(item: EvalCase, response: GroundedGenerationResponse): EvalCaseResult {
  const retrieval = scoreRetrieval(response.retrieval, item.expected_node_ids ?? []);
  const expectedTerms = item.expected_terms ?? [];
  const matchedTerms = matchTerms(response.answer, expectedTerms);
  return {
    id: item.id,
    question: item.question,
    expected_node_ids: item.expected_node_ids ?? [],
    retrieved_node_ids: retrieval.retrievedNodeIds,
    retrieval_hit_count: retrieval.hitCount,
    retrieval_hit: retrieval.hit,
    answer: response.answer,
    expected_terms: expectedTerms,
    matched_terms: matchedTerms,
    term_coverage: expectedTerms.length ? matchedTerms.length / expectedTerms.length : null,
    valid_citation_count: response.grounding.valid_citation_count,
    invalid_citation_count: response.grounding.invalid_citation_count,
    unsupported_claim_count: response.unsupported_claims.length,
    grounding_status: response.grounding.status,
  };
}

function scoreRetrievalOnlyCase(item: EvalCase, response: UnitRetrievalResponse): EvalCaseResult {
  const retrieval = scoreRetrieval(response, item.expected_node_ids ?? []);
  return {
    id: item.id,
    question: item.question,
    expected_node_ids: item.expected_node_ids ?? [],
    retrieved_node_ids: retrieval.retrievedNodeIds,
    retrieval_hit_count: retrieval.hitCount,
    retrieval_hit: retrieval.hit,
    answer: null,
    expected_terms: item.expected_terms ?? [],
    matched_terms: [],
    term_coverage: null,
    valid_citation_count: null,
    invalid_citation_count: null,
    unsupported_claim_count: null,
    grounding_status: null,
  };
}

function scoreRetrieval(
  response: UnitRetrievalResponse,
  expectedNodeIds: string[],
): { retrievedNodeIds: string[]; hitCount: number; hit: boolean } {
  const retrievedNodeIds = response.hits.map((hit) => hit.node_id);
  const retrieved = new Set(retrievedNodeIds);
  const hitCount = expectedNodeIds.filter((id) => retrieved.has(id)).length;
  return {
    retrievedNodeIds,
    hitCount,
    hit: expectedNodeIds.length ? hitCount > 0 : retrievedNodeIds.length > 0,
  };
}

function summarize(flags: Flags, source: string, results: EvalCaseResult[]): EvalSummary {
  const expectedCases = results.filter((item) => item.expected_node_ids.length > 0);
  const retrievalHitRate = expectedCases.length
    ? expectedCases.filter((item) => item.retrieval_hit).length / expectedCases.length
    : 0;
  const averageRetrievalRecall = expectedCases.length
    ? average(expectedCases.map((item) => item.retrieval_hit_count / item.expected_node_ids.length))
    : 0;
  const generatedResults = results.filter((item) => item.term_coverage !== null);
  const citationResults = results.filter((item) => item.valid_citation_count !== null);
  const validCitationTotal = sum(citationResults.map((item) => item.valid_citation_count ?? 0));
  const invalidCitationTotal = sum(citationResults.map((item) => item.invalid_citation_count ?? 0));

  return {
    source,
    cases: results.length,
    generated: flags.generate,
    limit: flags.limit,
    retrieval_mode: flags.retrievalMode,
    retrieval_hit_rate: round(retrievalHitRate),
    average_retrieval_recall: round(averageRetrievalRecall),
    average_term_coverage: generatedResults.length
      ? round(average(generatedResults.map((item) => item.term_coverage ?? 0)))
      : null,
    valid_citation_rate: citationResults.length && validCitationTotal + invalidCitationTotal > 0
      ? round(validCitationTotal / (validCitationTotal + invalidCitationTotal))
      : null,
    invalid_citation_count: citationResults.length ? invalidCitationTotal : null,
    unsupported_claim_count: citationResults.length
      ? sum(citationResults.map((item) => item.unsupported_claim_count ?? 0))
      : null,
    results,
  };
}

function readCases(casesPath: string): EvalCase[] {
  if (!existsSync(casesPath)) throw new Error(`Cases file not found: ${casesPath}`);
  const rows = readFileSync(casesPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const cases = rows.map((line, index) => {
    try {
      return JSON.parse(line) as EvalCase;
    } catch (error) {
      throw new Error(`Invalid JSONL at ${casesPath}:${index + 1}: ${(error as Error).message}`);
    }
  });
  for (const item of cases) {
    if (!item.id || !item.question) throw new Error(`Each eval case requires id and question: ${JSON.stringify(item)}`);
  }
  return cases;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    db: DEFAULT_DATABASE_URL,
    source: 'main',
    casesPath: DEFAULT_CASES_PATH,
    limit: 8,
    retrievalMode: 'hybrid',
    generate: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--db':
        flags.db = requireValue(argv, ++i, arg);
        break;
      case '--source':
        flags.source = requireValue(argv, ++i, arg);
        break;
      case '--cases':
        flags.casesPath = resolve(requireValue(argv, ++i, arg));
        break;
      case '--limit':
        flags.limit = parsePositiveInteger(requireValue(argv, ++i, arg), arg);
        break;
      case '--retrieval-mode':
        flags.retrievalMode = parseRetrievalMode(requireValue(argv, ++i, arg));
        break;
      case '--generate':
        flags.generate = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return flags;
}

function parseRetrievalMode(value: string): UnitRetrievalMode {
  if (value === 'hybrid' || value === 'text' || value === 'vector') return value;
  throw new Error('--retrieval-mode must be one of: hybrid, text, vector.');
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

function printHelp(): void {
  console.log([
    'Usage: npm run evaluate-runtime -w packages/server -- [options]',
    '',
    'Options:',
    '  --source <key>              Dataset key or id. Default: main',
    '  --db <url>                  PostgreSQL URL. Default: DATABASE_URL or local okm database',
    '  --cases <path>              JSONL eval cases file',
    '  --limit <n>                 Retrieval limit. Default: 8',
    '  --retrieval-mode <mode>     hybrid, text, or vector. Default: hybrid',
    '  --generate                  Also call the configured model for grounded generation',
  ].join('\n'));
}

function matchTerms(text: string, terms: string[]): string[] {
  return terms.filter((term) => text.includes(term));
}

function average(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
