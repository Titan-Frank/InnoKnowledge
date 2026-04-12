import type { Hono } from 'hono';
import type { Sql } from '../db/connection.js';
import { buildSourcesPayload } from '../db/queries.js';

export function registerMetaRoutes(app: Hono, sql: Sql) {
  app.get('/api/meta', async (c) => {
    const payload = await buildSourcesPayload(sql);
    return c.json(payload);
  });
}
