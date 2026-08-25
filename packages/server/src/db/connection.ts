import postgres from 'postgres';

export type Sql = postgres.Sql<{}>;
export type TransactionSql = postgres.TransactionSql<{}>;

export function createPool(connectionString?: string): Sql {
  const url = connectionString || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL not set. Provide a PostgreSQL connection string via --db or DATABASE_URL env var.',
    );
  }
  return postgres(url, { max: 10 });
}

export function closePool(sql: Sql): Promise<void> {
  return sql.end();
}
