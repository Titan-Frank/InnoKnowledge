import type { Hono } from 'hono';
import type { TextbookReaderRelatedUnit } from '@okm/types';
import type { Sql } from '../db/connection.js';
import { resolveDatasetRow } from '../db/queries.js';
import { DATA_DIR, REPO_ROOT } from '../utils/paths.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  listTextbookReaderBooks,
  loadTextbookReaderPage,
  matchReaderEvidenceBlocks,
  resolveTextbookReaderPdf,
  type ReaderEvidence,
} from '../services/textbook-reader.js';

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RawRecord : {};
}

function optionalPage(value: string | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const page = Number(value);
  if (!Number.isInteger(page) || page < 0) throw new Error('Page must be a zero-based non-negative integer.');
  return page;
}

export function registerTextbookReaderRoutes(app: Hono, sql: Sql) {
  app.get('/api/source/:key/textbooks/readers', async (c) => {
    const key = c.req.param('key');
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) return c.json({ error: `Unknown source '${key}'` }, 404);
    const sourceRows = await sql<RawRecord[]>`
      SELECT book_id, source_markdown_path, raw_markdown_path, extract_dir, source_pdf_path
      FROM world_mineru_sources
      WHERE dataset_id = ${datasetRow.dataset_id}
    `;
    return c.json({
      dataset_id: datasetRow.dataset_id,
      books: await listTextbookReaderBooks(DATA_DIR, sourceRows.map((row) => ({
        book_id: String(row.book_id ?? ''),
        source_markdown_path: String(row.source_markdown_path ?? ''),
        raw_markdown_path: String(row.raw_markdown_path ?? ''),
        extract_dir: String(row.extract_dir ?? ''),
        source_pdf_path: String(row.source_pdf_path ?? ''),
      }))),
    });
  });

  app.get('/api/source/:key/textbooks/:book_id/original.pdf', async (c) => {
    const key = c.req.param('key');
    const bookId = c.req.param('book_id');
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) return c.json({ error: `Unknown source '${key}'` }, 404);
    const sourceRows = await sql<RawRecord[]>`
      SELECT source_markdown_path, raw_markdown_path, extract_dir, source_pdf_path
      FROM world_mineru_sources
      WHERE dataset_id = ${datasetRow.dataset_id}
        AND book_id = ${bookId}
      LIMIT 1
    `;
    const source = sourceRows[0] ?? {};
    const pdfPath = await resolveTextbookReaderPdf({
      repoRoot: REPO_ROOT,
      dataRoot: DATA_DIR,
      datasetId: datasetRow.dataset_id,
      bookId,
      pdfPath: String(source.source_pdf_path ?? ''),
      sourcePaths: [
        String(source.source_markdown_path ?? ''),
        String(source.raw_markdown_path ?? ''),
        String(source.extract_dir ?? ''),
      ].filter(Boolean),
    });
    if (!pdfPath) return c.json({ error: `Original PDF was not found for textbook '${bookId}'.` }, 404);
    const info = await stat(pdfPath);
    const body = Readable.toWeb(createReadStream(pdfPath)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(`${bookId}.pdf`)}`,
        'Content-Length': String(info.size),
        'Content-Type': 'application/pdf',
      },
    });
  });

  app.get('/api/source/:key/textbooks/:book_id/reader', async (c) => {
    const key = c.req.param('key');
    const bookId = c.req.param('book_id');
    const evidenceId = c.req.query('evidence_id')?.trim() || '';

    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) return c.json({ error: `Unknown source '${key}'` }, 404);

    let requestedPage: number | undefined;
    try {
      requestedPage = optionalPage(c.req.query('page'));
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }

    const sourceRows = await sql<RawRecord[]>`
      SELECT source_markdown_path, raw_markdown_path, extract_dir, source_pdf_path
      FROM world_mineru_sources
      WHERE dataset_id = ${datasetRow.dataset_id}
        AND book_id = ${bookId}
      LIMIT 1
    `;
    const source = sourceRows[0] ?? {};

    let evidence: ReaderEvidence | null = null;
    if (evidenceId) {
      const evidenceRows = await sql<RawRecord[]>`
        SELECT id, excerpt, locator, page_start, page_end, properties_json
        FROM world_evidence
        WHERE dataset_id = ${datasetRow.dataset_id}
          AND id = ${evidenceId}
          AND source_id = ${bookId}
        LIMIT 1
      `;
      const row = evidenceRows[0];
      if (!row) return c.json({ error: `Evidence '${evidenceId}' was not found.` }, 404);
      evidence = {
        id: String(row.id ?? evidenceId),
        excerpt: String(row.excerpt ?? ''),
        locator: String(row.locator ?? ''),
        page_start: row.page_start == null ? null : Number(row.page_start),
        page_end: row.page_end == null ? null : Number(row.page_end),
        properties: asRecord(row.properties_json),
      };
    }

    try {
      const result = await loadTextbookReaderPage({
        repoRoot: REPO_ROOT,
        dataRoot: DATA_DIR,
        datasetId: datasetRow.dataset_id,
        bookId,
        pdfPath: String(source.source_pdf_path ?? ''),
        requestedPage,
        evidence,
        sourcePaths: [
          String(source.source_markdown_path ?? ''),
          String(source.raw_markdown_path ?? ''),
          String(source.extract_dir ?? ''),
        ].filter(Boolean),
      });
      const relatedRows = await sql<RawRecord[]>`
        SELECT
          node.id AS node_id,
          node.name,
          node.kind,
          node.definition,
          COALESCE(card.summary, '') AS summary,
          evidence.id AS evidence_id,
          evidence.excerpt,
          evidence.locator,
          evidence.page_start,
          evidence.page_end,
          evidence.properties_json
        FROM world_evidence AS evidence
        JOIN world_mentions AS mention
          ON mention.dataset_id = evidence.dataset_id
          AND mention.source_id = evidence.source_id
          AND mention.target_type = 'node'
          AND (
            mention.anchor_ref = evidence.anchor_ref
            OR mention.source_refs_json @> jsonb_build_array(evidence.id)
          )
        JOIN world_nodes AS node
          ON node.dataset_id = mention.dataset_id
          AND node.id = mention.target_id
          AND node.status != 'deprecated'
        LEFT JOIN world_node_cards AS card
          ON card.dataset_id = node.dataset_id
          AND card.node_id = node.id
          AND card.status != 'deprecated'
        WHERE evidence.dataset_id = ${datasetRow.dataset_id}
          AND evidence.source_id = ${bookId}
          AND (
            evidence.id = ${evidenceId || '__none__'}
            OR (
              evidence.page_start IS NOT NULL
              AND evidence.page_start <= ${result.page_number}
              AND COALESCE(evidence.page_end, evidence.page_start) >= ${result.page_number}
            )
          )
        ORDER BY node.name, evidence.id
        LIMIT 300
      `;
      const relatedByNode = new Map<string, TextbookReaderRelatedUnit>();
      for (const row of relatedRows) {
        const nodeId = String(row.node_id ?? '').trim();
        const evidenceIdValue = String(row.evidence_id ?? '').trim();
        if (!nodeId || !evidenceIdValue) continue;
        const blockIds = matchReaderEvidenceBlocks(result.blocks, {
          id: evidenceIdValue,
          excerpt: String(row.excerpt ?? ''),
          locator: String(row.locator ?? ''),
          page_start: row.page_start == null ? null : Number(row.page_start),
          page_end: row.page_end == null ? null : Number(row.page_end),
          properties: asRecord(row.properties_json),
        });
        const existing = relatedByNode.get(nodeId);
        if (existing) {
          if (!existing.evidence_ids.includes(evidenceIdValue)) existing.evidence_ids.push(evidenceIdValue);
          for (const blockId of blockIds) {
            if (!existing.block_ids.includes(blockId)) existing.block_ids.push(blockId);
          }
          continue;
        }
        relatedByNode.set(nodeId, {
          node_id: nodeId,
          name: String(row.name ?? nodeId),
          kind: String(row.kind ?? ''),
          definition: String(row.definition ?? ''),
          summary: String(row.summary ?? ''),
          evidence_ids: [evidenceIdValue],
          block_ids: blockIds,
        });
      }
      result.related_units = [...relatedByNode.values()];
      return c.json(result);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 404);
    }
  });
}
