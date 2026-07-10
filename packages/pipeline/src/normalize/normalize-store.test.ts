import assert from "node:assert/strict";
import test from "node:test";

import { runNormalizeFromDatabase } from "./normalize-store.js";
import type { SqlStatement } from "../staging/staging-sql.js";

test("executes database-backed normalize after reading canonical rows", async () => {
  const queried: SqlStatement[] = [];
  const executed: SqlStatement[] = [];
  const result = await runNormalizeFromDatabase({
    datasetId: "main",
    now: "now",
    query: (statement) => {
      queried.push(statement);
      return normalizeRowsForStatement(statement.name);
    },
    executeStatement: (statement) => {
      executed.push(statement);
    },
  });

  assert.equal(result.cards_updated, 1);
  assert.equal(result.domain_profiles_deduplicated, 1);
  assert.equal(result.edges_deduplicated, 1);
  assert.deepEqual(transactionStatementNames(executed), ["begin-normalize-transaction", "commit-normalize-transaction"]);
  assert.deepEqual(result.executedStatements, businessStatementNames(executed));
  assert.ok(result.statements.includes("update-normalized-node-card"));
  assert.ok(result.statements.includes("upsert-normalized-domain-profile"));
  assert.ok(result.statements.includes("deprecate-duplicate-world-edge"));
  assert.ok(result.statements.includes("upsert-world-node-terms"));
  assert.deepEqual(queried[0], {
    name: "lock-dataset-transaction",
    sql: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    params: ["main"],
  });
  assert.deepEqual(queried.slice(0, 6).map((statement) => statement.name), [
    "lock-dataset-transaction",
    "select-normalize-node-cards",
    "select-normalize-domain-profiles",
    "select-normalize-edges",
    "select-normalize-nodes",
    "select-normalize-evidence-ids",
  ]);
  assert.equal(executed[0]?.sql, "BEGIN");
});

test("executes database-backed normalize in full plan order", async () => {
  const executed: string[] = [];
  const result = await runNormalizeFromDatabase({
    datasetId: "main",
    now: "now",
    query: (statement) => normalizeRowsForStatement(statement.name),
    executeStatement: (statement) => {
      executed.push(statement.name);
    },
  });

  assert.deepEqual(result.executedStatements, businessStatementNames(executed));
  assert.deepEqual(transactionStatementNames(executed), ["begin-normalize-transaction", "commit-normalize-transaction"]);
  assert.ok(result.executedStatements.includes("update-normalized-node-card"));
  assert.ok(result.executedStatements.includes("delete-world-node-terms"));
  assert.ok(result.executedStatements.includes("upsert-world-node-terms"));
});

test("rolls back normalize when a business statement fails", async () => {
  const executed: string[] = [];

  await assert.rejects(
    () =>
      runNormalizeFromDatabase({
        datasetId: "main",
        now: "now",
        query: (statement) => normalizeRowsForStatement(statement.name),
        executeStatement: (statement) => {
          executed.push(statement.name);
          if (statement.name === "deprecate-duplicate-world-edge") throw new Error("write failed");
        },
      }),
    /write failed/,
  );

  assert.equal(executed[0], "begin-normalize-transaction");
  assert.deepEqual(executed.slice(-2), ["deprecate-duplicate-world-edge", "rollback-normalize-transaction"]);
  assert.equal(executed.includes("commit-normalize-transaction"), false);
});

test("reports both normalize write and rollback failures", async () => {
  const executed: string[] = [];

  await assert.rejects(
    () =>
      runNormalizeFromDatabase({
        datasetId: "main",
        now: "now",
        query: (statement) => normalizeRowsForStatement(statement.name),
        executeStatement: (statement) => {
          executed.push(statement.name);
          if (statement.name === "deprecate-duplicate-world-edge") throw new Error("write failed");
          if (statement.name === "rollback-normalize-transaction") throw new Error("rollback failed");
        },
      }),
    /Normalize transaction failed: write failed; rollback also failed: rollback failed/,
  );

  assert.deepEqual(executed.slice(-2), ["deprecate-duplicate-world-edge", "rollback-normalize-transaction"]);
});

test("rolls back normalize when a read fails after acquiring the dataset lock", async () => {
  const queried: SqlStatement[] = [];
  const executed: SqlStatement[] = [];

  await assert.rejects(
    () =>
      runNormalizeFromDatabase({
        datasetId: "main",
        now: "now",
        query: (statement) => {
          queried.push(statement);
          if (statement.name === "select-normalize-edges") throw new Error("read failed");
          return normalizeRowsForStatement(statement.name);
        },
        executeStatement: (statement) => {
          executed.push(statement);
        },
      }),
    /read failed/,
  );

  assert.deepEqual(queried.map((statement) => statement.name), [
    "lock-dataset-transaction",
    "select-normalize-node-cards",
    "select-normalize-domain-profiles",
    "select-normalize-edges",
  ]);
  assert.equal(executed[0]?.sql, "BEGIN");
  assert.deepEqual(transactionStatementNames(executed), ["begin-normalize-transaction", "rollback-normalize-transaction"]);
  assert.deepEqual(businessStatementNames(executed), []);
});

function transactionStatementNames(statements: SqlStatement[] | string[]): string[] {
  return statements
    .map((statement) => typeof statement === "string" ? statement : statement.name)
    .filter((name) => name.endsWith("-normalize-transaction"));
}

function businessStatementNames(statements: SqlStatement[] | string[]): string[] {
  return statements
    .map((statement) => typeof statement === "string" ? statement : statement.name)
    .filter((name) => !name.endsWith("-normalize-transaction"));
}

function normalizeRowsForStatement(name: string): Array<Record<string, unknown>> {
  switch (name) {
    case "select-normalize-node-cards":
      return [{ node_id: "node:water", sections_json: [{ content: [" 定义 ", ""] }] }];
    case "select-normalize-domain-profiles":
      return [
        {
          id: "domain-profile:old-water",
          node_id: "node:water",
          domain: "chemistry",
          school_stages_json: ["higher"],
          curriculum_roles_json: ["core"],
          source_refs_json: ["ev1"],
          properties_json: { a: 1 },
          notes: "old",
          status: "active",
          created_at: "1",
        },
      ];
    case "select-normalize-edges":
      return [
        { id: "edge:1", from_id: "node:water", to_id: "node:oxygen", type: "related_to", status: "active", created_at: "1" },
        { id: "edge:2", from_id: "node:water", to_id: "node:oxygen", type: "related_to", status: "active", created_at: "2" },
      ];
    case "select-normalize-nodes":
      return [
        { id: "node:water", name: "Water", kind: "concept", aliases_json: ["H2O"], tags_json: ["matter"], status: "active" },
        { id: "node:oxygen", name: "Oxygen", kind: "concept", aliases_json: [], tags_json: [], status: "active" },
      ];
    case "select-normalize-evidence-ids":
      return [{ id: "ev1" }];
    default:
      return [];
  }
}
