import type {
  UnitRetrievalExecutionMode,
  UnitRetrievalHit,
  UnitRetrievalMode,
  UnitRetrievalResponse,
} from '@okm/types';
import type { Sql } from '../db/connection.js';
import { loadUnit } from '../db/queries.js';
import { embedQuery } from '../services/embedding.js';

const RRF_K = 60;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 30;

interface RetrievalOptions {
  datasetId: string;
  sourceKey: string;
  query: string;
  limit?: number;
  mode?: UnitRetrievalMode;
}

interface CandidateRow {
  id: string;
  canonical_name: string;
  node_kind: string;
  node_layer: string;
  reasons: string[];
}

interface VectorRow extends Omit<CandidateRow, 'reasons'> {
  similarity: number;
  reason?: string;
}

interface FusedCandidate {
  id: string;
  canonical_name: string;
  node_kind: string;
  node_layer: string;
  score: number;
  text_match: boolean;
  vector_match: boolean;
  similarity: number | null;
  reasons: string[];
}

export function normalizeRetrievalLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(value ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
}

export function buildSearchTerms(q: string): string[] {
  const normalized = q.trim();
  if (!normalized) return [];
  const terms = new Set<string>();
  terms.add(normalized);

  for (const part of normalized.split(/[^\p{L}\p{N}]+/u)) {
    const value = part.trim();
    if (value.length >= 2) terms.add(value);
  }

  for (const match of normalized.matchAll(/[\u3400-\u9fff]{2,}/g)) {
    const text = match[0];
    for (let size = Math.min(8, text.length); size >= 2; size--) {
      for (let i = 0; i <= text.length - size; i++) {
        terms.add(text.slice(i, i + size));
        if (terms.size >= 40) return [...terms];
      }
    }
  }

  return [...terms].slice(0, 40);
}

export async function retrieveApiUnits(
  sql: Sql,
  options: RetrievalOptions,
): Promise<UnitRetrievalResponse> {
  const q = options.query.trim();
  const requestedMode = options.mode ?? 'hybrid';
  const limit = normalizeRetrievalLimit(options.limit);
  if (!q) {
    return {
      query: q,
      source: options.datasetId,
      mode: 'text_only',
      requested_mode: requestedMode,
      hits: [],
    };
  }

  const textPromise = requestedMode === 'vector'
    ? Promise.resolve([] as CandidateRow[])
    : runTextSearch(sql, options.datasetId, q, limit * 3);
  const vectorPromise = requestedMode === 'text'
    ? Promise.resolve({ rows: [] as VectorRow[], ok: false })
    : runVectorSearch(sql, options.datasetId, q, limit);

  const [textRows, vectorResult] = await Promise.all([textPromise, vectorPromise]);
  const fused = fuseCandidates(textRows, vectorResult.rows, limit);

  const unitPairs = await Promise.all(fused.map(async (candidate) => {
    const unit = await loadUnit(sql, options.datasetId, candidate.id, options.sourceKey);
    return unit ? { candidate, unit } : null;
  }));

  const hits: UnitRetrievalHit[] = unitPairs
    .filter((pair): pair is NonNullable<typeof pair> => pair !== null)
    .map(({ candidate, unit }) => ({
      node_id: candidate.id,
      canonical_name: candidate.canonical_name,
      node_kind: candidate.node_kind,
      node_layer: candidate.node_layer,
      score: candidate.score,
      text_match: candidate.text_match,
      vector_match: candidate.vector_match,
      similarity: candidate.similarity,
      reasons: candidate.reasons,
      unit,
    }));

  const executionMode: UnitRetrievalExecutionMode =
    requestedMode !== 'text' && vectorResult.ok ? 'full' : 'text_only';

  return {
    query: q,
    source: options.datasetId,
    mode: executionMode,
    requested_mode: requestedMode,
    hits,
  };
}

async function runTextSearch(
  sql: Sql,
  datasetId: string,
  q: string,
  limit: number,
): Promise<CandidateRow[]> {
  const terms = buildSearchTerms(q);
  const patterns = terms.map((term) => `%${escapeLike(term)}%`);
  const termsJson = sql.json(terms);
  const patternsJson = sql.json(patterns);

  return sql<CandidateRow[]>`
    SELECT
      n.id,
      n.name AS canonical_name,
      n.kind AS node_kind,
      COALESCE(n.properties_json->>'node_layer', n.properties_json->>'layer', '') AS node_layer,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE n.name LIKE p.pattern) THEN 'name' END,
        CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE n.definition LIKE p.pattern) THEN 'definition' END,
        CASE WHEN EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(n.aliases_json, '[]'::jsonb)) AS a
          WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE a LIKE p.pattern)
        ) THEN 'alias' END,
        CASE WHEN EXISTS (
          SELECT 1 FROM world_node_cards c
          WHERE c.dataset_id = n.dataset_id
            AND c.node_id = n.id
            AND (
              EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE c.summary LIKE p.pattern)
              OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE c.sections_json::text LIKE p.pattern)
            )
        ) THEN 'card' END,
        CASE WHEN EXISTS (
          SELECT 1 FROM world_node_bodies b
          WHERE b.dataset_id = n.dataset_id
            AND b.node_id = n.id
            AND b.status != 'deprecated'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE b.content LIKE p.pattern)
        ) THEN 'body' END,
        CASE WHEN EXISTS (
          SELECT 1
          FROM world_mentions m
          JOIN world_evidence e ON e.dataset_id = m.dataset_id
          WHERE m.dataset_id = n.dataset_id
            AND m.target_type = 'node'
            AND m.target_id = n.id
            AND (
              EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(COALESCE(m.source_refs_json, '[]'::jsonb)) AS ref(value)
                WHERE ref.value = e.id
              )
              OR (e.source_id = m.source_id AND e.anchor_ref = m.anchor_ref)
            )
            AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE e.excerpt LIKE p.pattern)
        ) THEN 'evidence' END
      ], NULL) AS reasons
    FROM world_nodes n
    WHERE n.dataset_id = ${datasetId}
      AND n.status != 'deprecated'
      AND (
        EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE n.name LIKE p.pattern)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE n.definition LIKE p.pattern)
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(n.aliases_json, '[]'::jsonb)) AS a
          WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE a LIKE p.pattern)
        )
        OR EXISTS (
          SELECT 1 FROM world_node_cards c
          WHERE c.dataset_id = n.dataset_id
            AND c.node_id = n.id
            AND (
              EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE c.summary LIKE p.pattern)
              OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE c.sections_json::text LIKE p.pattern)
            )
        )
        OR EXISTS (
          SELECT 1 FROM world_node_bodies b
          WHERE b.dataset_id = n.dataset_id
            AND b.node_id = n.id
            AND b.status != 'deprecated'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE b.content LIKE p.pattern)
        )
        OR EXISTS (
          SELECT 1
          FROM world_mentions m
          JOIN world_evidence e ON e.dataset_id = m.dataset_id
          WHERE m.dataset_id = n.dataset_id
            AND m.target_type = 'node'
            AND m.target_id = n.id
            AND (
              EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(COALESCE(m.source_refs_json, '[]'::jsonb)) AS ref(value)
                WHERE ref.value = e.id
              )
              OR (e.source_id = m.source_id AND e.anchor_ref = m.anchor_ref)
            )
            AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE e.excerpt LIKE p.pattern)
        )
      )
    ORDER BY
      CASE
        WHEN n.name = ${q} THEN 0
        WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(${termsJson}::jsonb) AS t(term) WHERE n.name = t.term) THEN 1
        WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE n.name LIKE p.pattern) THEN 2
        WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(${patternsJson}::jsonb) AS p(pattern) WHERE n.definition LIKE p.pattern) THEN 3
        ELSE 4
      END,
      char_length(n.name),
      n.name
    LIMIT ${limit}
  `.catch(() => [] as CandidateRow[]);
}

async function runVectorSearch(
  sql: Sql,
  datasetId: string,
  q: string,
  limit: number,
): Promise<{ rows: VectorRow[]; ok: boolean }> {
  try {
    const vector = await embedQuery(q);
    if (!vector) return { rows: [], ok: false };

    const vecStr = `[${vector.join(',')}]`;
    const unitRows = await sql<VectorRow[]>`
      SELECT
        n.id,
        n.name AS canonical_name,
        n.kind AS node_kind,
        COALESCE(n.properties_json->>'node_layer', n.properties_json->>'layer', '') AS node_layer,
        1 - (u.embedding <=> ${vecStr}::vector) AS similarity,
        'apiunit_embedding' AS reason
      FROM world_unit_embeddings u
      JOIN world_nodes n
        ON n.dataset_id = u.dataset_id
       AND n.id = u.node_id
      WHERE u.dataset_id = ${datasetId}
        AND n.status != 'deprecated'
        AND u.embedding IS NOT NULL
      ORDER BY u.embedding <=> ${vecStr}::vector
      LIMIT ${limit}
    `.catch(() => [] as VectorRow[]);
    if (unitRows.length > 0) return { rows: unitRows, ok: true };

    const rows = await sql<VectorRow[]>`
      SELECT
        id,
        name AS canonical_name,
        kind AS node_kind,
        COALESCE(properties_json->>'node_layer', properties_json->>'layer', '') AS node_layer,
        1 - (embedding <=> ${vecStr}::vector) AS similarity,
        'node_embedding' AS reason
      FROM world_nodes
      WHERE dataset_id = ${datasetId}
        AND status != 'deprecated'
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vecStr}::vector
      LIMIT ${limit}
    `;
    return { rows, ok: true };
  } catch {
    return { rows: [], ok: false };
  }
}

function fuseCandidates(
  textRows: CandidateRow[],
  vectorRows: VectorRow[],
  limit: number,
): FusedCandidate[] {
  const fused = new Map<string, FusedCandidate>();

  for (let i = 0; i < textRows.length; i++) {
    const row = textRows[i];
    fused.set(row.id, {
      id: row.id,
      canonical_name: row.canonical_name,
      node_kind: row.node_kind,
      node_layer: row.node_layer,
      score: 1 / (RRF_K + i + 1),
      text_match: true,
      vector_match: false,
      similarity: null,
      reasons: row.reasons.length ? row.reasons : ['text'],
    });
  }

  for (let i = 0; i < vectorRows.length; i++) {
    const row = vectorRows[i];
    const rrf = 1 / (RRF_K + i + 1);
    const existing = fused.get(row.id);
    if (existing) {
      existing.score += rrf;
      existing.vector_match = true;
      existing.similarity = row.similarity;
      existing.reasons = uniqueStrings([...existing.reasons, row.reason || 'embedding']);
    } else {
      fused.set(row.id, {
        id: row.id,
        canonical_name: row.canonical_name,
        node_kind: row.node_kind,
        node_layer: row.node_layer,
        score: rrf,
        text_match: false,
        vector_match: true,
        similarity: row.similarity,
        reasons: [row.reason || 'embedding'],
      });
    }
  }

  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.canonical_name.localeCompare(b.canonical_name, 'zh-CN'))
    .slice(0, limit);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
