#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { createPool, closePool } from './db/connection.js';
import { createApp } from './app.js';
import { DEFAULT_DATABASE_URL } from './utils/paths.js';
import type { Sql } from './db/connection.js';

function parseArgs(): { host: string; port: number; db: string } {
  const args = process.argv.slice(2);
  let host = '127.0.0.1';
  let port = 8765;
  let db = DEFAULT_DATABASE_URL;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--host':
        host = args[++i];
        break;
      case '--port':
        port = parseInt(args[++i], 10);
        break;
      case '--db':
        db = args[++i];
        break;
      case '--help':
        console.log('Usage: okm-viewer [--host HOST] [--port PORT] [--db URL]');
        process.exit(0);
    }
  }

  return { host, port, db };
}

async function main() {
  const { host, port, db: dbUrl } = parseArgs();

  const sql: Sql = createPool(dbUrl);

  const app = createApp(sql, dbUrl);

  serve({ fetch: app.fetch, port, hostname: host }, () => {
    console.log(`Viewer API listening on http://${host}:${port}/viewer/`);
    console.log(`PostgreSQL: ${dbUrl.replace(/:[^:@]+@/, ':****@')}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await closePool(sql);
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    await closePool(sql);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
