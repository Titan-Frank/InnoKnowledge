import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresJsStatementExecutor, createPostgresStatementExecutor, preparePostgresJsParams, preparePostgresParams } from "./postgres-executor.js";
import type { SqlStatement } from "../staging/staging-sql.js";

test("prepares JSON-compatible params for PostgreSQL jsonb placeholders", () => {
  const buffer = new ArrayBuffer(2);
  assert.deepEqual(preparePostgresParams(["a", 1, null, undefined, ["x"], { y: 2 }, buffer]), [
    "a",
    1,
    null,
    undefined,
    "[\"x\"]",
    "{\"y\":2}",
    buffer,
  ]);
});

test("prepares postgres.js params without stringifying jsonb values", () => {
  assert.deepEqual(preparePostgresJsParams(["a", ["x"], { y: 2 }, undefined]), ["a", ["x"], { y: 2 }, null]);
});

test("creates an executor that forwards SQL and prepared params", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const executor = createPostgresStatementExecutor((sql, params) => {
    calls.push({ sql, params });
  });
  const statement: SqlStatement = {
    name: "insert-test",
    sql: "INSERT INTO t (payload) VALUES ($1::jsonb)",
    params: [{ ok: true }],
  };

  await executor(statement);

  assert.deepEqual(calls, [
    {
      sql: "INSERT INTO t (payload) VALUES ($1::jsonb)",
      params: ["{\"ok\":true}"],
    },
  ]);
});

test("adapts a postgres.js unsafe client without creating a connection", async () => {
  const calls: Array<{ sql: string; params?: readonly unknown[] }> = [];
  const executor = createPostgresJsStatementExecutor({
    unsafe(sql, params) {
      calls.push({ sql, params });
    },
  });

  await executor({
    name: "insert-test",
    sql: "INSERT INTO t (payload) VALUES ($1::jsonb)",
    params: [{ ok: true }],
  });

  assert.deepEqual(calls, [{ sql: "INSERT INTO t (payload) VALUES ($1::jsonb)", params: [{ ok: true }] }]);
});
