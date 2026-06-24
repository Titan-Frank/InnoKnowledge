import assert from "node:assert/strict";
import test from "node:test";

import { checkPostgresReady, parsePostgresEndpoint } from "./postgres-readiness.js";

test("parses PostgreSQL URL endpoint like the Python readiness check", () => {
  assert.deepEqual(parsePostgresEndpoint("postgresql://okm:okm@localhost:5432/knowledge"), { host: "localhost", port: 5432 });
  assert.deepEqual(parsePostgresEndpoint("postgresql://okm:okm@example.test/knowledge"), { host: "example.test", port: 5432 });
});

test("blocks when DATABASE_URL is missing", async () => {
  const result = await checkPostgresReady({});
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.issues, ["DATABASE_URL is not set."]);
});

test("checks socket readiness without running a SQL query by default", async () => {
  const calls: string[] = [];
  const result = await checkPostgresReady(
    { databaseUrl: "postgresql://okm:okm@db.local:15432/knowledge", timeoutMs: 1234 },
    {
      socketConnect: async (host, port, timeoutMs) => {
        calls.push(`${host}:${port}:${timeoutMs}`);
      },
      query: async () => {
        throw new Error("query should not run by default");
      },
    },
  );

  assert.equal(result.status, "success");
  assert.equal(result.postgres_query_ok, false);
  assert.deepEqual(calls, ["db.local:15432:1234"]);
});

test("runs optional query when requested", async () => {
  const calls: string[] = [];
  const result = await checkPostgresReady(
    { databaseUrl: "postgresql://okm:okm@localhost:5432/knowledge", requireQuery: true },
    {
      socketConnect: async () => {},
      query: async (databaseUrl) => {
        calls.push(databaseUrl);
      },
    },
  );

  assert.equal(result.status, "success");
  assert.equal(result.postgres_query_ok, true);
  assert.deepEqual(calls, ["postgresql://okm:okm@localhost:5432/knowledge"]);
});

test("reports socket failures as blocked issues", async () => {
  const result = await checkPostgresReady(
    { databaseUrl: "postgresql://okm:okm@localhost:5432/knowledge" },
    {
      socketConnect: async () => {
        throw new Error("ECONNREFUSED");
      },
    },
  );

  assert.equal(result.status, "blocked");
  assert.match(result.issues[0] ?? "", /ECONNREFUSED/);
});
