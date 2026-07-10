import assert from "node:assert/strict";
import test from "node:test";

import { assertAllowedMergeWriteStatement } from "./merge-staged-lessons.js";
import type { SqlStatement } from "../staging/staging-sql.js";

test("merge write allowlist accepts transaction controls and canonical business writes", () => {
  for (const statement of [
    sqlStatement("begin", "BEGIN"),
    sqlStatement("commit", "COMMIT"),
    sqlStatement("rollback", "ROLLBACK"),
    sqlStatement("business", "UPDATE world_lesson_runs SET status = 'merged'"),
  ]) {
    assert.doesNotThrow(() => assertAllowedMergeWriteStatement(statement));
  }
});

test("merge write allowlist still rejects statements outside its transaction and table boundary", () => {
  assert.throws(
    () => assertAllowedMergeWriteStatement(sqlStatement("unsafe", "UPDATE world_datasets SET status = 'active'")),
    /outside canonical merge tables/,
  );
  assert.throws(
    () => assertAllowedMergeWriteStatement(sqlStatement("unsafe-transaction", "BEGIN; DELETE FROM world_nodes")),
    /outside canonical merge tables/,
  );
  assert.throws(
    () => assertAllowedMergeWriteStatement(sqlStatement("unsupported-serializable", "BEGIN ISOLATION LEVEL SERIALIZABLE")),
    /outside canonical merge tables/,
  );
  assert.throws(
    () => assertAllowedMergeWriteStatement(sqlStatement("unsupported-isolation", "BEGIN ISOLATION LEVEL READ COMMITTED")),
    /outside canonical merge tables/,
  );
});

function sqlStatement(name: string, sql: string): SqlStatement {
  return { name, sql, params: [] };
}
