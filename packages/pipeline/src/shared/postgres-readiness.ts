import { createConnection } from "node:net";

export type PostgresReadinessResult =
  | {
      status: "success";
      database_url_present: true;
      socket_ready: true;
      postgres_query_ok: boolean;
      host: string;
      port: number;
    }
  | {
      status: "blocked";
      issues: string[];
    };

export type PostgresReadinessDependencies = {
  socketConnect?: (host: string, port: number, timeoutMs: number) => Promise<void>;
  query?: (databaseUrl: string) => Promise<void>;
};

export async function checkPostgresReady(
  input: {
    databaseUrl?: string;
    timeoutMs?: number;
    requireQuery?: boolean;
  },
  dependencies: PostgresReadinessDependencies = {},
): Promise<PostgresReadinessResult> {
  const databaseUrl = input.databaseUrl?.trim() ?? "";
  if (!databaseUrl) return { status: "blocked", issues: ["DATABASE_URL is not set."] };

  try {
    const endpoint = parsePostgresEndpoint(databaseUrl);
    const timeoutMs = input.timeoutMs ?? 2000;
    await (dependencies.socketConnect ?? socketConnect)(endpoint.host, endpoint.port, timeoutMs);
    let postgresQueryOk = false;
    if (input.requireQuery) {
      const query = dependencies.query ?? defaultQuery;
      await query(databaseUrl);
      postgresQueryOk = true;
    }
    return {
      status: "success",
      database_url_present: true,
      socket_ready: true,
      postgres_query_ok: postgresQueryOk,
      host: endpoint.host,
      port: endpoint.port,
    };
  } catch (error) {
    return {
      status: "blocked",
      issues: [`PostgreSQL is not reachable via DATABASE_URL: ${(error as Error).message}`],
    };
  }
}

export function parsePostgresEndpoint(databaseUrl: string): { host: string; port: number } {
  const parsed = new URL(databaseUrl);
  return {
    host: parsed.hostname || "localhost",
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 5432,
  };
}

function socketConnect(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port, timeout: timeoutMs });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.on("connect", () => finish());
    socket.on("timeout", () => finish(new Error(`connect ETIMEDOUT ${host}:${port}`)));
    socket.on("error", finish);
  });
}

async function defaultQuery(databaseUrl: string): Promise<void> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`select 1`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
