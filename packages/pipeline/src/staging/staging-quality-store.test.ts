import assert from "node:assert/strict";
import test from "node:test";

import { buildStagingTableRows } from "./staging-rows.js";
import {
  buildMarkBlockedStatements,
  buildPersistQualityStatements,
  buildSelectStagedLessonRunsQuery,
  buildSelectStagingRowsQuery,
  runStagingQualityFromDatabase,
} from "./staging-quality.js";
import { normalizeLessonArtifacts } from "./staging.js";

const context = {
  datasetId: "main",
  lessonRunId: "lesson-run:1",
  bookId: "chem-grade8",
  batchAnchor: "struct:chem-grade8:lesson:1-1-1",
  now: "2026-01-02T03:04:05+00:00",
};

const completeRows = buildStagingTableRows(
  context,
  normalizeLessonArtifacts(
    {
      nodes: [{ id: "n1", name: "Water", kind: "concept", definition: "A substance", source_refs: ["ev1"] }],
      edges: [{ id: "e1", type: "related_to", from: "n1", to: "n1", source_refs: ["ev1"] }],
      domainProfiles: [{ id: "p1", node_id: "n1", domain: "chemistry", source_refs: ["ev1"] }],
      mentions: [{ id: "m1", target_id: "n1", source_refs: ["ev1"] }],
      evidence: [{ id: "ev1", excerpt: "claim" }],
      nodeCards: [
        {
          id: "c1",
          node_id: "n1",
          summary: "Water summary",
          sections: ["definition", "essence", "key_points", "example", "application", "misconception"].map((section_type) => ({
            id: section_type,
            section_type,
            content: ["content"],
            source_refs: ["ev1"],
          })),
        },
      ],
    },
    context.bookId,
    context.batchAnchor,
  ),
);

test("builds staged lesson run query with optional filters", () => {
  const statement = buildSelectStagedLessonRunsQuery("main", {
    bookId: "book-a",
    lessonRunIds: ["run-a", "run-b"],
    batchAnchors: ["anchor-a"],
  });

  assert.equal(statement.name, "select-staging-quality-lesson-runs");
  assert.deepEqual(statement.params, ["main", "book-a", ["run-a", "run-b"], ["anchor-a"]]);
  assert.match(statement.sql, /dataset_id = \$1/);
  assert.match(statement.sql, /book_id = \$2/);
  assert.match(statement.sql, /lesson_run_id = ANY\(\$3\)/);
  assert.match(statement.sql, /batch_anchor = ANY\(\$4\)/);
});

test("builds staged table row query for one lesson", () => {
  assert.deepEqual(buildSelectStagingRowsQuery({ table: "world_staging_nodes", datasetId: "main", lessonRunId: "run-a" }), {
    name: "select-staging-quality-world_staging_nodes",
    sql: "SELECT * FROM world_staging_nodes WHERE dataset_id = $1 AND lesson_run_id = $2 ORDER BY created_at",
    params: ["main", "run-a"],
  });
});

test("returns success for complete staged lesson rows from database", async () => {
  const queried: string[] = [];
  const executed: string[] = [];
  const result = await runStagingQualityFromDatabase({
    datasetId: "main",
    query: (statement) => {
      queried.push(statement.name);
      return rowsForCompleteLesson(statement.name);
    },
    executeStatement: (statement) => {
      executed.push(statement.name);
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.checked, 1);
  assert.equal(result.blocked, 0);
  assert.deepEqual(result.statements, ["persist-staging-quality-lesson-run:1"]);
  assert.deepEqual(result.executedStatements, executed);
  assert.deepEqual(result.results[0]?.counts, {
    nodes: 1,
    edges: 1,
    domain_profiles: 1,
    curriculum_projections: 0,
    mentions: 1,
    evidence: 1,
    node_cards: 1,
  });
  assert.deepEqual(queried, [
    "select-staging-quality-lesson-runs",
    "select-staging-quality-world_staging_nodes",
    "select-staging-quality-world_staging_edges",
    "select-staging-quality-world_staging_domain_profiles",
    "select-staging-quality-world_staging_curriculum_projections",
    "select-staging-quality-world_staging_mentions",
    "select-staging-quality-world_staging_evidence",
    "select-staging-quality-world_staging_node_cards",
  ]);
});

test("returns blocked output and executes quality status updates", async () => {
  const executed: string[] = [];
  const result = await runStagingQualityFromDatabase({
    datasetId: "main",
    now: context.now,
    query: (statement) => rowsForEmptyLesson(statement.name),
    executeStatement: (statement) => {
      executed.push(statement.name);
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.checked, 1);
  assert.equal(result.blocked, 1);
  assert.deepEqual(result.results[0]?.errors, ["Lesson produced no staged nodes.", "Lesson produced no staged evidence."]);
  assert.deepEqual(result.statements, ["mark-staging-quality-blocked-lesson-run:1"]);
  assert.deepEqual(result.executedStatements, executed);
});

test("warn-only reports success while preserving blocked result details", async () => {
  const result = await runStagingQualityFromDatabase({
    datasetId: "main",
    warnOnly: true,
    query: (statement) => rowsForEmptyLesson(statement.name),
  });

  assert.equal(result.status, "success");
  assert.equal(result.blocked, 1);
  assert.equal(result.results[0]?.status, "blocked");
  assert.deepEqual(result.statements, []);
});

test("requires a write executor when blocked lessons need status updates", async () => {
  await assert.rejects(
    () =>
      runStagingQualityFromDatabase({
        datasetId: "main",
        query: (statement) => rowsForEmptyLesson(statement.name),
      }),
    /requires an executeStatement executor/,
  );
});

test("executes blocked lesson status updates in plan order", async () => {
  const executed: string[] = [];
  const result = await runStagingQualityFromDatabase({
    datasetId: "main",
    now: context.now,
    query: (statement) => rowsForEmptyLesson(statement.name),
    executeStatement: (statement) => {
      executed.push(statement.name);
    },
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(executed, ["mark-staging-quality-blocked-lesson-run:1"]);
  assert.deepEqual(result.executedStatements, executed);
});

test("builds quality metadata update statements", () => {
  const result = {
    lesson_run_id: "lesson-run:1",
    status: "blocked" as const,
    errors: ["bad"],
    warnings: ["review"],
    quality_review_required: true,
    review_node_ids: ["n1"],
    counts: completeRows.lesson_run.counts_json,
  };
  const statements = buildMarkBlockedStatements(
    "main",
    [result],
    context.now,
  );

  assert.deepEqual(statements.map((statement) => statement.name), ["mark-staging-quality-blocked-lesson-run:1"]);
  assert.match(statements[0]!.sql, /UPDATE world_lesson_runs/);
  assert.match(statements[0]!.sql, /quality_issues/);
  assert.match(statements[0]!.sql, /quality_warnings/);
  assert.match(statements[0]!.sql, /quality_review_required/);
  assert.match(statements[0]!.sql, /review_node_ids/);
  assert.match(statements[0]!.sql, /jsonb_typeof/);
  assert.match(statements[0]!.sql, /ELSE '\{\}'::jsonb/);
  assert.deepEqual(statements[0]!.params, ["[\"bad\"]", "[\"review\"]", true, "[\"n1\"]", context.now, "main", "lesson-run:1"]);

  const successStatements = buildPersistQualityStatements("main", [{ ...result, status: "success" }], context.now);
  assert.deepEqual(successStatements.map((statement) => statement.name), ["persist-staging-quality-lesson-run:1"]);
  assert.doesNotMatch(successStatements[0]!.sql, /status = 'blocked'/);
});

function rowsForCompleteLesson(name: string): Array<Record<string, unknown>> {
  switch (name) {
    case "select-staging-quality-lesson-runs":
      return [
        {
          ...completeRows.lesson_run,
          counts_json: { nodes: 99, edges: 99, domain_profiles: 99, mentions: 99, evidence: 99, node_cards: 99 },
        },
      ];
    case "select-staging-quality-world_staging_nodes":
      return completeRows.nodes.map(copyRecord);
    case "select-staging-quality-world_staging_edges":
      return completeRows.edges.map(copyRecord);
    case "select-staging-quality-world_staging_domain_profiles":
      return completeRows.domain_profiles.map(copyRecord);
    case "select-staging-quality-world_staging_mentions":
      return completeRows.mentions.map(copyRecord);
    case "select-staging-quality-world_staging_evidence":
      return completeRows.evidence.map(copyRecord);
    case "select-staging-quality-world_staging_node_cards":
      return completeRows.node_cards.map(copyRecord);
    default:
      return [];
  }
}

function rowsForEmptyLesson(name: string): Array<Record<string, unknown>> {
  if (name === "select-staging-quality-lesson-runs") return [copyRecord(completeRows.lesson_run)];
  return [];
}

function copyRecord(row: object): Record<string, unknown> {
  return { ...row };
}
