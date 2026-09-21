import type { Hono } from 'hono';
import type { Sql } from '../db/connection.js';
import { resolveDatasetRow, loadUnit } from '../db/queries.js';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, REPO_ROOT } from '../utils/paths.js';
import { resolveExistingMineruAssetPath } from '../utils/markdown-image-paths.js';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

function decodeAssetPath(encodedPath: string): string {
  const decoded = decodeURIComponent(encodedPath);
  const normalized = decoded.replace(/\\/g, '/');
  const resolved = path.isAbsolute(decoded)
    ? path.resolve(decoded)
    : normalized.startsWith('data/')
      ? path.resolve(DATA_DIR, normalized.slice('data/'.length))
      : path.resolve(REPO_ROOT, decoded);
  return resolved;
}

async function allowedAssetPath(filePath: string, sourceRows: Record<string, unknown>[]): Promise<string | null> {
  const realFilePath = await realpath(filePath).catch(() => null);
  if (!realFilePath) return null;
  const candidates = [
    path.resolve(DATA_DIR),
    path.resolve(REPO_ROOT, 'ocr'),
    ...sourceRows.flatMap((row) => [row.source_markdown_path, row.raw_markdown_path, row.extract_dir]),
  ];
  for (const value of candidates) {
    const sourcePath = String(value ?? '').trim();
    if (!sourcePath || /^https?:/i.test(sourcePath)) continue;
    const resolved = path.isAbsolute(sourcePath) ? path.resolve(sourcePath) : path.resolve(REPO_ROOT, sourcePath);
    const info = await stat(resolved).catch(() => null);
    const directory = info?.isDirectory() ? resolved : info?.isFile() ? path.dirname(resolved) : null;
    if (!directory) continue;
    const root = await realpath(directory).catch(() => null);
    if (root && (realFilePath === root || realFilePath.startsWith(`${root}${path.sep}`))) return realFilePath;
  }
  return null;
}

export function registerUnitRoutes(app: Hono, sql: Sql) {
  app.get('/api/source/:key/assets/:asset_path{.+}', async (c) => {
    const key = c.req.param('key');
    const assetPath = c.req.param('asset_path');
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) {
      return c.json({ error: `Unknown source '${key}'` }, 404);
    }

    const sourceRows = await sql<Record<string, unknown>[]>`
      SELECT source_markdown_path, raw_markdown_path, extract_dir
      FROM world_mineru_sources
      WHERE dataset_id = ${datasetRow.dataset_id}
    `;
    const requestedPath = decodeAssetPath(assetPath);
    const resolvedPath = await allowedAssetPath(resolveExistingMineruAssetPath(requestedPath), sourceRows);
    if (!resolvedPath) {
      return c.json({ error: 'Asset path is not allowed' }, 403);
    }

    try {
      const info = await stat(resolvedPath);
      if (!info.isFile()) return c.json({ error: 'Asset not found' }, 404);
      const ext = path.extname(resolvedPath).toLowerCase();
      const contentType = MIME_TYPES[ext];
      if (!contentType) return c.json({ error: 'Asset type is not supported' }, 415);
      const body = await readFile(resolvedPath);
      return new Response(body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch {
      return c.json({ error: 'Asset not found' }, 404);
    }
  });

  app.get('/api/source/:key/unit/:node_id', async (c) => {
    const key = c.req.param('key');
    const nodeId = c.req.param('node_id');

    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) {
      return c.json({ error: `Unknown source '${key}'` }, 404);
    }

    const unit = await loadUnit(sql, datasetRow.dataset_id, nodeId, key);
    if (!unit) {
      return c.json({ error: `Unit not found for '${nodeId}'` }, 404);
    }

    return c.json(unit);
  });
}
