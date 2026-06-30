import type {
  ApiEvidence,
  ApiUnit,
  GroundedGenerationCitation,
  GroundedGenerationInvalidCitation,
  GroundedGenerationResponse,
  UnitRetrievalMode,
  UnitRetrievalResponse,
} from '@okm/types';
import type { Sql } from '../db/connection.js';
import { loadDotenvIntoProcess } from '../utils/env.js';
import { retrieveApiUnits } from './unit-retrieval.js';

loadDotenvIntoProcess();

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4.1';
const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_CONTEXT_UNITS = 6;
const MAX_BODY_CHARS = 1200;
const MAX_SECTION_CHARS = 700;
const MAX_EVIDENCE_CHARS = 900;
const MAX_FRAGMENT_CHARS = 900;

interface GroundedGenerationOptions {
  datasetId: string;
  sourceKey: string;
  question: string;
  limit?: number;
  retrievalMode?: UnitRetrievalMode;
}

interface ModelJson {
  answer?: unknown;
  citations?: unknown;
  unsupported_claims?: unknown;
  used_node_ids?: unknown;
}

export class MissingModelConfigurationError extends Error {
  constructor() {
    super('OPENAI_API_KEY is not set.');
    this.name = 'MissingModelConfigurationError';
  }
}

export async function generateGroundedAnswer(
  sql: Sql,
  options: GroundedGenerationOptions,
): Promise<GroundedGenerationResponse> {
  const question = options.question.trim();
  const retrieval = await retrieveApiUnits(sql, {
    datasetId: options.datasetId,
    sourceKey: options.sourceKey,
    query: question,
    limit: options.limit,
    mode: options.retrievalMode,
  });

  if (!retrieval.hits.length || !retrieval.hits.some((hit) => hit.unit.evidence.length > 0)) {
    return buildNoContextResponse(question, options.datasetId, retrieval);
  }

  const context = buildGroundingContext(retrieval);
  const raw = await callModelJson(question, context);
  const parsed = normalizeModelJson(raw);
  const validation = validateCitations(parsed.citations, retrieval);
  const unsupportedClaims = normalizeStringArray(parsed.unsupported_claims);
  const usedNodeIds = normalizeStringArray(parsed.used_node_ids)
    .filter((id) => retrieval.hits.some((hit) => hit.node_id === id));

  const status = classifyGroundingStatus(
    validation.valid.length,
    validation.invalid.length,
    unsupportedClaims.length,
  );

  return {
    question,
    source: options.datasetId,
    answer: normalizeText(parsed.answer) || 'The available context is not sufficient to answer this question.',
    citations: validation.valid,
    unsupported_claims: unsupportedClaims,
    used_node_ids: usedNodeIds.length ? usedNodeIds : uniqueStrings(validation.valid.map((item) => item.node_id)),
    retrieval,
    grounding: {
      status,
      valid_citation_count: validation.valid.length,
      invalid_citation_count: validation.invalid.length,
      invalid_citations: validation.invalid,
      cited_evidence_ids: uniqueStrings(validation.valid.map((item) => item.evidence_id)),
    },
    model: DEFAULT_MODEL,
  };
}

export function buildGroundingContext(retrieval: UnitRetrievalResponse): string {
  const blocks = retrieval.hits.slice(0, MAX_CONTEXT_UNITS).map((hit, index) => {
    const unit = hit.unit;
    const node = unit.node;
    const semanticCore = node.properties?.semantic_core ?? {};
    const relationSummary = summarizeRelations(unit);
    const evidence = unit.evidence
      .slice(0, 5)
      .map((item) => formatEvidence(item))
      .join('\n');
    const fragments = unit.source_fragments
      .slice(0, 2)
      .map((fragment) => {
        const text = fragment.excerpts
          .slice(0, 2)
          .map((item) => truncate(item.excerpt, MAX_FRAGMENT_CHARS))
          .filter(Boolean)
          .join('\n');
        return text ? `Source fragment ${fragment.source_id}:${fragment.anchor_ref}\n${text}` : '';
      })
      .filter(Boolean)
      .join('\n');
    const sections = unit.card?.sections
      ?.slice(0, 4)
      .map((section) => `${section.title}: ${truncate(stringifyContent(section.content), MAX_SECTION_CHARS)}`)
      .filter((line) => line.trim().length > 0)
      .join('\n') ?? '';

    return [
      `Unit ${index + 1}`,
      `node_id: ${node.id}`,
      `name: ${node.name}`,
      `kind: ${node.kind}`,
      `definition: ${node.definition || ''}`,
      `aliases: ${Array.isArray(node.aliases) ? node.aliases.join(', ') : ''}`,
      `semantic_core: ${truncate(stringifyContent(semanticCore), MAX_SECTION_CHARS)}`,
      unit.card?.summary ? `card_summary: ${truncate(unit.card.summary, MAX_SECTION_CHARS)}` : '',
      sections ? `card_sections:\n${sections}` : '',
      unit.body?.content ? `body:\n${truncate(unit.body.content, MAX_BODY_CHARS)}` : '',
      relationSummary ? `relations:\n${relationSummary}` : '',
      evidence ? `evidence:\n${evidence}` : '',
      fragments ? `source_fragments:\n${fragments}` : '',
    ].filter(Boolean).join('\n');
  });

  return blocks.join('\n\n---\n\n');
}

export function validateCitations(
  citations: GroundedGenerationCitation[],
  retrieval: UnitRetrievalResponse,
): { valid: GroundedGenerationCitation[]; invalid: GroundedGenerationInvalidCitation[] } {
  const evidenceByNode = new Map<string, Set<string>>();
  for (const hit of retrieval.hits) {
    evidenceByNode.set(hit.node_id, new Set(hit.unit.evidence.map((item) => item.id)));
  }

  const valid: GroundedGenerationCitation[] = [];
  const invalid: GroundedGenerationInvalidCitation[] = [];
  for (const citation of citations) {
    const nodeId = normalizeText(citation.node_id);
    const evidenceId = normalizeText(citation.evidence_id);
    const normalized = {
      node_id: nodeId,
      evidence_id: evidenceId,
      note: normalizeText(citation.note) || undefined,
    };
    if (!nodeId || !evidenceId) {
      invalid.push({ ...normalized, reason: 'missing node_id or evidence_id' });
      continue;
    }
    if (!evidenceByNode.has(nodeId)) {
      invalid.push({ ...normalized, reason: 'node was not retrieved' });
      continue;
    }
    if (!evidenceByNode.get(nodeId)?.has(evidenceId)) {
      invalid.push({ ...normalized, reason: 'evidence does not belong to retrieved node' });
      continue;
    }
    valid.push(normalized);
  }

  return { valid: dedupeCitations(valid), invalid };
}

export function normalizeModelJson(value: unknown): {
  answer: string;
  citations: GroundedGenerationCitation[];
  unsupported_claims: string[];
  used_node_ids: string[];
} {
  const object = isRecord(value) ? value as ModelJson : {};
  return {
    answer: normalizeText(object.answer),
    citations: normalizeCitations(object.citations),
    unsupported_claims: normalizeStringArray(object.unsupported_claims),
    used_node_ids: normalizeStringArray(object.used_node_ids),
  };
}

async function callModelJson(question: string, context: string): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new MissingModelConfigurationError();

  const messages = [
    {
      role: 'system',
      content: [
        'You answer questions only from the provided Open Knowledge Map ApiUnit context.',
        'Use the same language as the user question.',
        'Every factual claim should be grounded in the context.',
        'Citations must use evidence_id values that appear in the context.',
        'If the context is insufficient, say so and leave citations empty.',
        'Return JSON only with keys: answer, citations, unsupported_claims, used_node_ids.',
        'Each citation must be { "node_id": string, "evidence_id": string, "note": string }.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Question:\n${question}`,
        '',
        `ApiUnit context:\n${context}`,
      ].join('\n'),
    },
  ];

  const first = await requestChatCompletion(apiKey, messages, true);
  if (!first.ok && first.status === 400) {
    const fallback = await requestChatCompletion(apiKey, messages, false);
    if (fallback.ok) return parseJsonObject(fallback.content);
    throw new Error(`Model request failed with HTTP ${fallback.status}: ${truncate(fallback.detail, 300)}`);
  }
  if (!first.ok) {
    throw new Error(`Model request failed with HTTP ${first.status}: ${truncate(first.detail, 300)}`);
  }
  return parseJsonObject(first.content);
}

async function requestChatCompletion(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  jsonMode: boolean,
): Promise<{ ok: true; content: string } | { ok: false; status: number; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${DEFAULT_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, status: response.status, detail };
    }

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    return { ok: true, content };
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function buildNoContextResponse(
  question: string,
  datasetId: string,
  retrieval: UnitRetrievalResponse,
): GroundedGenerationResponse {
  return {
    question,
    source: datasetId,
    answer: 'The available context is not sufficient to answer this question.',
    citations: [],
    unsupported_claims: [],
    used_node_ids: [],
    retrieval,
    grounding: {
      status: 'insufficient_context',
      valid_citation_count: 0,
      invalid_citation_count: 0,
      invalid_citations: [],
      cited_evidence_ids: [],
    },
    model: DEFAULT_MODEL,
  };
}

function classifyGroundingStatus(
  validCitationCount: number,
  invalidCitationCount: number,
  unsupportedClaimCount: number,
): GroundedGenerationResponse['grounding']['status'] {
  if (validCitationCount === 0) return 'insufficient_context';
  if (invalidCitationCount > 0 || unsupportedClaimCount > 0) return 'partial';
  return 'grounded';
}

function summarizeRelations(unit: ApiUnit): string {
  return [...unit.relations.outgoing, ...unit.relations.incoming]
    .slice(0, 8)
    .map((relation) => {
      const direction = relation.from_id === unit.node.id
        ? `${relation.type} -> ${relation.to_id}`
        : `${relation.from_id} -> ${relation.type}`;
      return `${direction} confidence=${relation.confidence}`;
    })
    .join('\n');
}

function formatEvidence(item: ApiEvidence): string {
  const locator = item.locator ? ` locator=${item.locator}` : '';
  const page = item.page_start ? ` page=${item.page_start}` : '';
  return [
    `evidence_id: ${item.id}${locator}${page}`,
    truncate(item.excerpt, MAX_EVIDENCE_CHARS),
  ].join('\n');
}

function normalizeCitations(value: unknown): GroundedGenerationCitation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      node_id: normalizeText(item.node_id),
      evidence_id: normalizeText(item.evidence_id),
      note: normalizeText(item.note) || undefined,
    }));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map(normalizeText));
}

function normalizeText(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function stringifyContent(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxChars: number): string {
  const text = value.trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function dedupeCitations(citations: GroundedGenerationCitation[]): GroundedGenerationCitation[] {
  const seen = new Set<string>();
  const result: GroundedGenerationCitation[] = [];
  for (const citation of citations) {
    const key = `${citation.node_id}:${citation.evidence_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(citation);
  }
  return result;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
