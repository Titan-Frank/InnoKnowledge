import type { Hono } from 'hono';
import type { Sql } from '../db/connection.js';
import { resolveDatasetRow, loadUnit } from '../db/queries.js';
import { readFile, stat } from 'node:fs/promises';
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

function resolveAssetPath(encodedPath: string): string | null {
  const decoded = decodeURIComponent(encodedPath);
  const normalized = decoded.replace(/\\/g, '/');
  const resolved = path.isAbsolute(decoded)
    ? path.resolve(decoded)
    : normalized.startsWith('data/')
      ? path.resolve(DATA_DIR, normalized.slice('data/'.length))
      : path.resolve(REPO_ROOT, decoded);
  const allowedRoots = [
    path.resolve(DATA_DIR),
    path.resolve(REPO_ROOT, 'ocr'),
  ];
  if (!allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    return null;
  }
  return resolved;
}

export function registerUnitRoutes(app: Hono, sql: Sql) {
  app.get('/api/source/:key/assets/:asset_path{.+}', async (c) => {
    const key = c.req.param('key');
    const assetPath = c.req.param('asset_path');
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) {
      return c.json({ error: `Unknown source '${key}'` }, 404);
    }

    const requestedPath = resolveAssetPath(assetPath);
    if (!requestedPath) {
      return c.json({ error: 'Asset path is not allowed' }, 403);
    }
    const resolvedPath = resolveExistingMineruAssetPath(requestedPath);

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
