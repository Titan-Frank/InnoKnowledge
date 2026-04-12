import type { Hono } from 'hono';

export function registerHealthRoutes(app: Hono, dbUrl: string) {
  app.get('/api/health', async (c) => {
    return c.json({ ok: true as const, db: dbUrl.replace(/:[^:@]+@/, ':****@') });
  });
}
