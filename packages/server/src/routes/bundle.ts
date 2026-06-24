import type { Hono } from 'hono';
import type { Sql } from '../db/connection.js';
import { resolveDatasetRow, buildBundlePayload } from '../db/queries.js';
import { loadFramework } from '../data/framework.js';
import { loadPatterns } from '../data/patterns.js';
import { loadOutline } from '../data/outlines.js';

export function registerBundleRoutes(app: Hono, sql: Sql) {
  app.get('/api/source/:key/bundle', async (c) => {
    const key = c.req.param('key');
    const datasetRow = await resolveDatasetRow(sql, key);

    if (!datasetRow) {
      return c.json({ error: `Unknown source '${key}'` }, 404);
    }

    const framework = loadFramework();
    const patterns = loadPatterns();
    const payload = await buildBundlePayload(
      sql,
      datasetRow.dataset_id,
      framework,
      patterns,
      (bookId) => loadOutline(bookId),
    );

    return c.json(payload);
  });
}
