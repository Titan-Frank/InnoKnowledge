import type { Hono } from 'hono';

export function registerHealthRoutes(app: Hono, dbPath: string) {
  app.get('/api/health', (c) => {
    return c.json({ ok: true as const, db: dbPath });
  });
}
