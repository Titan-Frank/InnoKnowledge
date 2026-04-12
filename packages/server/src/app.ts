import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Sql } from './db/connection.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerBundleRoutes } from './routes/bundle.js';
import { registerNodeCardRoutes } from './routes/node-card.js';
import { VIEWER_DIST_DIR } from './utils/paths.js';
import { existsSync } from 'node:fs';

export function createApp(sql: Sql, dbUrl: string): Hono {
  const app = new Hono();

  // Redirect root to viewer
  app.get('/', (c) => c.redirect('/viewer/'));

  // API routes
  registerHealthRoutes(app, dbUrl);
  registerMetaRoutes(app, sql);
  registerBundleRoutes(app, sql);
  registerNodeCardRoutes(app, sql);

  // Serve built viewer assets (production mode)
  if (existsSync(VIEWER_DIST_DIR)) {
    app.use('/viewer/*', serveStatic({ root: VIEWER_DIST_DIR, rewriteRequestPath: (p) => p.replace(/^\/viewer/, '') }));
  }

  return app;
}
