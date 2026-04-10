import type { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { buildSourcesPayload } from '../db/queries.js';

export function registerMetaRoutes(app: Hono, db: Database.Database) {
  app.get('/api/meta', (c) => {
    const payload = buildSourcesPayload(db);
    return c.json(payload);
  });
}
