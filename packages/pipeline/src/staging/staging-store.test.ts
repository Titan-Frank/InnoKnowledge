import assert from "node:assert/strict";
import test from "node:test";

import { buildStagingTableRows } from "./staging-rows.js";
import type { SqlStatement } from "./staging-sql.js";
import { storeStagingRows } from "./staging-store.js";
import { normalizeLessonArtifacts } from "./staging.js";

const context = {
  datasetId: "main",
  lessonRunId: "lesson-run:1",
  bookId: "chem-grade8",
  batchAnchor: "struct:chem-grade8:lesson:1-1-1",
  now: "2026-01-02T03:04:05+00:00",
};

test("executes staging SQL statements in plan order when integrity passes", async () => {
  const rows = buildStagingTableRows(
    context,
    normalizeLessonArtifacts(
      {
        nodes: [{ id: "n1", name: "Water", kind: "concept", definition: "A substance" }],
        edges: [{ id: "e1", type: "related_to", from: "n1", to: "n1" }],
        domainProfiles: [{ id: "p1", node_id: "n1", domain: "chemistry" }],
        mentions: [{ id: "m1", target_id: "n1" }],
        evidence: [{ id: "ev1", excerpt: "claim" }],
        nodeCards: [{ id: "c1", node_id: "n1" }],
      },
      context.bookId,
      context.batchAnchor,
    ),
  );
  const executed: SqlStatement[] = [];

  const result = await storeStagingRows(rows, (statement) => {
    executed.push(statement);
  });

  assert.equal(result.status, "success");
  assert.equal(result.lesson_run_id, "lesson-run:1");
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.counts, {
    nodes: 1,
    edges: 1,
    domain_profiles: 1,
    curriculum_projections: 0,
    mentions: 1,
    evidence: 1,
    node_cards: 1,
  });
  assert.equal(executed[0]?.name, "begin-staging-transaction");
  assert.equal(executed.at(-1)?.name, "commit-staging-transaction");
  assert.deepEqual(result.executedStatements, executed
    .filter((statement) => !statement.name.includes("staging-transaction"))
    .map((statement) => statement.name));
  assert.deepEqual(result.executedStatements.slice(0, 7), [
    "upsert-world-lesson-run",
    "delete-world_staging_nodes",
    "delete-world_staging_edges",
    "delete-world_staging_domain_profiles",
    "delete-world_staging_curriculum_projections",
    "delete-world_staging_mentions",
    "delete-world_staging_evidence",
  ]);
  assert.ok(result.executedStatements.includes("insert-world-staging-nodes"));
});

test("rolls back staging writes when any planned statement fails", async () => {
  const rows = buildStagingTableRows(
    context,
    normalizeLessonArtifacts(
      {
        nodes: [{ id: "n1", name: "Water", kind: "concept", definition: "A substance" }],
        edges: [{ id: "e1", type: "related_to", from: "n1", to: "n1" }],
        domainProfiles: [{ id: "p1", node_id: "n1", domain: "chemistry" }],
        mentions: [{ id: "m1", target_id: "n1" }],
        evidence: [{ id: "ev1", excerpt: "claim" }],
        nodeCards: [{ id: "c1", node_id: "n1" }],
      },
      context.bookId,
      context.batchAnchor,
    ),
  );
  const executed: string[] = [];

  await assert.rejects(
    storeStagingRows(rows, (statement) => {
      executed.push(statement.name);
      if (statement.name === "insert-world-staging-mentions") {
        throw new Error("duplicate mention primary key");
      }
    }),
    /duplicate mention primary key/,
  );

  assert.equal(executed[0], "begin-staging-transaction");
  assert.equal(executed.at(-1), "rollback-staging-transaction");
  assert.equal(executed.includes("commit-staging-transaction"), false);
  assert.ok(executed.includes("insert-world-staging-nodes"));
  assert.ok(executed.includes("insert-world-staging-mentions"));
  assert.equal(executed.includes("insert-world-staging-evidence"), false);
});

test("blocks before executing SQL when staging integrity fails", async () => {
  const rows = buildStagingTableRows(
    context,
    normalizeLessonArtifacts(
      {
        nodes: [{ id: "n1", name: "Water", kind: "concept", definition: "A substance" }],
        edges: [{ id: "e1", type: "related_to", from: "n1", to: "missing" }],
        domainProfiles: [{ id: "p1", node_id: "missing-profile", domain: "chemistry" }],
        mentions: [],
        evidence: [],
        nodeCards: [{ id: "c1", node_id: "missing-card" }],
      },
      context.bookId,
      context.batchAnchor,
    ),
  );
  const executed: SqlStatement[] = [];

  const result = await storeStagingRows(rows, (statement) => {
    executed.push(statement);
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.lesson_run_id, "lesson-run:1");
  assert.deepEqual(result.executedStatements, []);
  assert.deepEqual(executed, []);
  assert.deepEqual(result.issues, [
    "Domain profile p1 references missing node missing-profile.",
    "Edge e1 references missing node endpoint.",
    "Node card c1 references missing node missing-card.",
  ]);
});
