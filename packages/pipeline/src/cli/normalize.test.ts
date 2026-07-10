import assert from "node:assert/strict";
import test from "node:test";

import { assertAllowedNormalizeWriteStatement } from "./normalize.js";
import type { SqlStatement } from "../staging/staging-sql.js";

test("normalize write allowlist accepts transaction controls and normalize business writes", () => {
  for (const statement of [
    sqlStatement("begin", "BEGIN"),
    sqlStatement("commit", "COMMIT"),
    sqlStatement("rollback", "ROLLBACK"),
    sqlStatement("business", "UPDATE world_node_cards SET status = 'active'"),
  ]) {
    assert.doesNotThrow(() => assertAllowedNormalizeWriteStatement(statement));
  }
});

test("normalize write allowlist still rejects statements outside its transaction and table boundary", () => {
  assert.throws(
    () => assertAllowedNormalizeWriteStatement(sqlStatement("unsafe", "UPDATE world_nodes SET status = 'active'")),
    /outside normalize tables/,
  );
  assert.throws(
    () => assertAllowedNormalizeWriteStatement(sqlStatement("unsafe-transaction", "ROLLBACK; DELETE FROM world_edges")),
    /outside normalize tables/,
  );
  assert.throws(
    () => assertAllowedNormalizeWriteStatement(sqlStatement("unsupported-serializable", "BEGIN ISOLATION LEVEL SERIALIZABLE")),
    /outside normalize tables/,
  );
  assert.throws(
    () => assertAllowedNormalizeWriteStatement(sqlStatement("unsupported-isolation", "BEGIN ISOLATION LEVEL READ COMMITTED")),
    /outside normalize tables/,
  );
});

function sqlStatement(name: string, sql: string): SqlStatement {
  return { name, sql, params: [] };
}
