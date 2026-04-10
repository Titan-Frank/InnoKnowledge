import Database from 'better-sqlite3';

export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath, { readonly: true });
  db.pragma('foreign_keys = ON');
  return db;
}

export function ensureSchema(_db: Database.Database): void {
  // Schema is managed by pipeline scripts; viewer only reads.
}
