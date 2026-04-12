import type { Hono } from 'hono';
import type { Sql } from '../db/connection.js';
import { resolveDatasetRow, loadNodeCard } from '../db/queries.js';

export function registerNodeCardRoutes(app: Hono, sql: Sql) {
  app.get('/api/source/:key/node-card/:node_id', async (c) => {
    const key = c.req.param('key');
    const nodeId = c.req.param('node_id');

    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) {
      return c.json({ error: `Unknown source '${key}'` }, 404);
    }

    const card = await loadNodeCard(sql, datasetRow.dataset_id, nodeId);
    if (!card) {
      return c.json({ error: `Node card not found for '${nodeId}'` }, 404);
    }

    return c.json(card);
  });
}
