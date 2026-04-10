#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { openDb, ensureSchema } from './db/connection.js';
import { createApp } from './app.js';
import { DEFAULT_DB_PATH } from './utils/paths.js';

function parseArgs(): { host: string; port: number; db: string } {
  const args = process.argv.slice(2);
  let host = '127.0.0.1';
  let port = 8765;
  let db = DEFAULT_DB_PATH;

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
        console.log('Usage: okm-viewer [--host HOST] [--port PORT] [--db PATH]');
        process.exit(0);
    }
  }

  return { host, port, db };
}

function main() {
  const { host, port, db: dbPath } = parseArgs();

  const db = openDb(dbPath);
  ensureSchema(db);

  const app = createApp(db, dbPath);

  serve({ fetch: app.fetch, port, hostname: host }, () => {
    console.log(`Viewer API listening on http://${host}:${port}/viewer/`);
    console.log(`SQLite DB: ${dbPath}`);
  });
}

main();
