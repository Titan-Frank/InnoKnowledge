import type { Hono } from 'hono';
import type { SemanticNeighborsResponse } from '@okm/types';
import type { Sql } from '../db/connection.js';
import { loadSemanticNeighbors, resolveDatasetRow } from '../db/queries.js';

export function registerSemanticNeighborRoutes(app: Hono, sql: Sql) {
  app.get('/api/source/:key/semantic-neighbors/:nodeId', async (c) => {
    const key = c.req.param('key');
    const nodeId = c.req.param('nodeId');
    const dataset = await resolveDatasetRow(sql, key);
    if (!dataset) return c.json({ error: `Unknown source '${key}'` }, 404);

    const requestedLimit = Number(c.req.query('limit') ?? 10);
    const payload: SemanticNeighborsResponse = {
      dataset_id: dataset.dataset_id,
      node_id: nodeId,
      neighbors: await loadSemanticNeighbors(sql, dataset.dataset_id, nodeId, requestedLimit),
    };
    return c.json(payload);
  });
}
