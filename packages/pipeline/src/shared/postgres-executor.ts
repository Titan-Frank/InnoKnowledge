import type { SqlStatement } from "../staging/staging-sql.js";

export type QueryExecutor = (sql: string, params: unknown[]) => Promise<unknown> | unknown;

export type PostgresJsUnsafeClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => Promise<unknown> | unknown;
};

export function preparePostgresParams(params: readonly unknown[]): unknown[] {
  return params.map((param) => {
    if (param === null || param === undefined) return param;
    if (ArrayBuffer.isView(param) || param instanceof ArrayBuffer) return param;
    if (Array.isArray(param) || isPlainObject(param)) return JSON.stringify(param);
    return param;
  });
}

export function createPostgresStatementExecutor(query: QueryExecutor) {
  return async (statement: SqlStatement): Promise<void> => {
    await query(statement.sql, preparePostgresParams(statement.params));
  };
}

export function createPostgresJsStatementExecutor(client: PostgresJsUnsafeClient) {
  return createPostgresStatementExecutor((sql, params) => client.unsafe(sql, params));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
