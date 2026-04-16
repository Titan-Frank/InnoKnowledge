/**
 * GET /api/source/:key/search?q=...&limit=60
 *
 * Server-side semantic + text search using pgvector and SQL LIKE.
 * Returns ranked results fused via Reciprocal Rank Fusion (RRF).
 */

import type { Hono } from 'hono';
import type { Sql } from '../db/connection.js';
import type { SearchHit, SearchResponse } from '@okm/types';
import { resolveDatasetRow } from '../db/queries.js';
import { embedQuery } from '../services/embedding.js';

const RRF_K = 60;
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

interface TextRow {
  id: string;
  canonical_name: string;
  node_kind: string;
  node_layer: string;
}

interface VectorRow extends TextRow {
  similarity: number;
}

export function registerSearchRoutes(app: Hono, sql: Sql): void {
  app.get('/api/source/:key/search', async (c) => {
    const key = c.req.param('key');
    const q = (c.req.query('q') ?? '').trim();
    const limitParam = Math.min(
      Math.max(parseInt(c.req.query('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    if (!q) {
      return c.json({ error: 'Missing query parameter "q"' }, 400);
    }

    const dataset = await resolveDatasetRow(sql, key);
    if (!dataset) {
      return c.json({ error: `Source "${key}" not found` }, 404);
    }

    const datasetId = dataset.dataset_id;

    // ── Text search ────────────────────────────────────────
    const textLimit = limitParam * 2;
    const safeQ = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${safeQ}%`;

    const textPromise = sql<TextRow[]>`
      SELECT id, canonical_name, node_kind, node_layer
      FROM nodes
      WHERE dataset_id = ${datasetId}
        AND status != 'deprecated'
        AND (
          canonical_name LIKE ${pattern}
          OR definition LIKE ${pattern}
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(aliases_json) AS a WHERE a LIKE ${pattern}
          )
        )
      ORDER BY canonical_name
      LIMIT ${textLimit}
    `.catch(() => [] as TextRow[]);

    // ── Vector search ──────────────────────────────────────
    const vectorPromise = (async (): Promise<{ rows: VectorRow[]; ok: boolean }> => {
      try {
        const vector = await embedQuery(q);
        if (!vector) return { rows: [], ok: false };

        const vecStr = `[${vector.join(',')}]`;
        const rows = await sql<VectorRow[]>`
          SELECT id, canonical_name, node_kind, node_layer,
                 1 - (embedding <=> ${vecStr}::vector) AS similarity
          FROM nodes
          WHERE dataset_id = ${datasetId}
            AND status != 'deprecated'
            AND embedding IS NOT NULL
          ORDER BY embedding <=> ${vecStr}::vector
          LIMIT ${limitParam}
        `;
        return { rows, ok: true };
      } catch {
        return { rows: [], ok: false };
      }
    })();

    // ── Run both in parallel ───────────────────────────────
    const [textRows, vectorResult] = await Promise.all([textPromise, vectorPromise]);

    // ── RRF fusion ─────────────────────────────────────────
    const fused = new Map<string, SearchHit>();

    for (let i = 0; i < textRows.length; i++) {
      const row = textRows[i];
      const rrf = 1 / (RRF_K + i + 1);
      fused.set(row.id, {
        id: row.id,
        canonical_name: row.canonical_name,
        node_kind: row.node_kind,
        node_layer: row.node_layer,
        score: rrf,
        text_match: true,
        vector_match: false,
        similarity: null,
      });
    }

    for (let i = 0; i < vectorResult.rows.length; i++) {
      const row = vectorResult.rows[i];
      const rrf = 1 / (RRF_K + i + 1);
      const existing = fused.get(row.id);
      if (existing) {
        existing.score += rrf;
        existing.vector_match = true;
        existing.similarity = row.similarity;
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
        });
      }
    }

    const hits = [...fused.values()]
      .sort((a, b) => b.score - a.score || a.canonical_name.localeCompare(b.canonical_name, 'zh-CN'))
      .slice(0, limitParam);

    const response: SearchResponse = {
      query: q,
      source: datasetId,
      hits,
      mode: vectorResult.ok ? 'full' : 'text_only',
    };

    return c.json(response);
  });
}
