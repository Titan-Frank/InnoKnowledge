import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresJsStatementExecutor, createPostgresStatementExecutor, preparePostgresParams } from "./postgres-executor.js";
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
    name: "delete-test",
    sql: "DELETE FROM t WHERE id = $1",
    params: ["n1"],
  });

  assert.deepEqual(calls, [{ sql: "DELETE FROM t WHERE id = $1", params: ["n1"] }]);
});
