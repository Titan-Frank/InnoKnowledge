import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type Database from 'better-sqlite3';
import { registerHealthRoutes } from './routes/health.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerBundleRoutes } from './routes/bundle.js';
import { registerNodeCardRoutes } from './routes/node-card.js';
import { VIEWER_DIST_DIR } from './utils/paths.js';
import { existsSync } from 'node:fs';

export function createApp(db: Database.Database, dbPath: string): Hono {
  const app = new Hono();

  // Redirect root to viewer
  app.get('/', (c) => c.redirect('/viewer/'));

  // API routes
  registerHealthRoutes(app, dbPath);
  registerMetaRoutes(app, db);
  registerBundleRoutes(app, db);
  registerNodeCardRoutes(app, db);

  // Serve built viewer assets (production mode)
  if (existsSync(VIEWER_DIST_DIR)) {
    app.use('/viewer/*', serveStatic({ root: VIEWER_DIST_DIR, rewriteRequestPath: (p) => p.replace(/^\/viewer/, '') }));
  }

  return app;
}
