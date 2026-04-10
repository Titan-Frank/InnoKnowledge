import type { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { resolveDatasetRow, loadNodeCard } from '../db/queries.js';

export function registerNodeCardRoutes(app: Hono, db: Database.Database) {
  app.get('/api/source/:key/node-card/:node_id', (c) => {
    const key = c.req.param('key');
    const nodeId = c.req.param('node_id');

    const datasetRow = resolveDatasetRow(db, key);
    if (!datasetRow) {
      return c.json({ error: `Unknown source '${key}'` }, 404);
    }

    const card = loadNodeCard(db, datasetRow.dataset_id, nodeId);
    if (!card) {
      return c.json({ error: `Node card not found for '${nodeId}'` }, 404);
    }

    return c.json(card);
  });
}
