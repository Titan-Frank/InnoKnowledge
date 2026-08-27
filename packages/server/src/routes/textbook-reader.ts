import type { Hono } from 'hono';
import type { Sql } from '../db/connection.js';
import { resolveDatasetRow } from '../db/queries.js';
import { DATA_DIR, REPO_ROOT } from '../utils/paths.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  listTextbookReaderBooks,
  loadTextbookReaderPage,
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
    return c.json({ dataset_id: datasetRow.dataset_id, books: await listTextbookReaderBooks(DATA_DIR) });
  });

  app.get('/api/source/:key/textbooks/:book_id/original.pdf', async (c) => {
    const key = c.req.param('key');
    const bookId = c.req.param('book_id');
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) return c.json({ error: `Unknown source '${key}'` }, 404);
    const pdfPath = await resolveTextbookReaderPdf({
      repoRoot: REPO_ROOT,
      dataRoot: DATA_DIR,
      datasetId: datasetRow.dataset_id,
      bookId,
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
      SELECT source_markdown_path, raw_markdown_path, extract_dir
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
        requestedPage,
        evidence,
        sourcePaths: [
          String(source.source_markdown_path ?? ''),
          String(source.raw_markdown_path ?? ''),
          String(source.extract_dir ?? ''),
        ].filter(Boolean),
      });
      return c.json(result);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 404);
    }
  });
}
