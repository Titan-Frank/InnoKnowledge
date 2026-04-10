import type { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { resolveDatasetRow, buildBundlePayload } from '../db/queries.js';
import { loadFramework } from '../data/framework.js';
import { loadPatterns } from '../data/patterns.js';
import { loadOutline } from '../data/outlines.js';

export function registerBundleRoutes(app: Hono, db: Database.Database) {
  app.get('/api/source/:key/bundle', (c) => {
    const key = c.req.param('key');
    const datasetRow = resolveDatasetRow(db, key);

    if (!datasetRow) {
      return c.json({ error: `Unknown source '${key}'` }, 404);
    }

    const framework = loadFramework();
    const patterns = loadPatterns();
    const payload = buildBundlePayload(
      db,
      datasetRow.dataset_id,
      framework,
      patterns,
      (bookId) => loadOutline(bookId),
    );

    return c.json(payload);
  });
}
