import assert from "node:assert/strict";
import test from "node:test";

import { runGraphIntegrityFromDatabase, runStrictQaFromDatabase } from "./qa-store.js";

test("runs strict QA from canonical database rows", async () => {
  const queried: string[] = [];
  const result = await runStrictQaFromDatabase({
    datasetId: "main",
    query: (statement) => {
      queried.push(statement.name);
      return qaRowsForStatement(statement.name);
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.errors.length, 0);
  assert.deepEqual(queried, [
    "select-strict-qa-nodes",
    "select-strict-qa-edges",
    "select-strict-qa-domain-profiles",
    "select-strict-qa-mentions",
    "select-strict-qa-evidence",
    "select-strict-qa-node-cards",
    "select-strict-qa-node-bodies",
  ]);
});

test("scopes strict QA failures to nodes sourced from the requested book", async () => {
  const result = await runStrictQaFromDatabase({
    datasetId: "main",
    bookId: "book-a",
    query: (statement) => {
      if (statement.name === "select-strict-qa-book-node-ids") return [{ id: "node:water" }];
      if (statement.name === "select-strict-qa-nodes") {
        return [
          ...qaRowsForStatement(statement.name),
          {
            id: "node:legacy",
            name: "Legacy",
            kind: "concept",
            definition: "Legacy fixture.",
            domains_json: ["invalid-domain"],
            learning_mode_json: ["conceptual"],
          },
        ];
      }
      return qaRowsForStatement(statement.name);
    },
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.errors, []);
  assert.ok(result.read_statements.includes("select-strict-qa-book-node-ids"));
});

test("runs graph integrity and marks selected lesson runs QA passed when requested", async () => {
  const executed: string[] = [];
  const result = await runGraphIntegrityFromDatabase({
    datasetId: "main",
    now: "now",
    markQaPassed: true,
    lessonRunFilter: { bookId: "book-a" },
    query: (statement) => qaRowsForStatement(statement.name),
    executeStatement: (statement) => {
      executed.push(statement.name);
    },
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.statements, ["mark-selected-world-lesson-runs-qa-passed"]);
  assert.deepEqual(result.executedStatements, executed);
  assert.deepEqual(executed, ["mark-selected-world-lesson-runs-qa-passed"]);
});

test("requires a write executor before marking QA passed", async () => {
  await assert.rejects(
    () =>
      runGraphIntegrityFromDatabase({
        datasetId: "main",
        markQaPassed: true,
        query: () => [],
      }),
    /requires an executeStatement executor/,
  );
});

function qaRowsForStatement(name: string): Array<Record<string, unknown>> {
  switch (name) {
    case "select-strict-qa-nodes":
    case "select-graph-integrity-nodes":
      return [
        {
          id: "node:water",
          name: "Water",
          kind: "concept",
          definition: "A substance.",
          domains_json: ["chemistry"],
          learning_mode_json: ["conceptual"],
          status: "active",
        },
      ];
    case "select-strict-qa-edges":
    case "select-graph-integrity-edges":
      return [];
    case "select-strict-qa-domain-profiles":
      return [
        {
          id: "domain-profile:water",
          node_id: "node:water",
          domain: "chemistry",
          school_stages_json: ["higher"],
          curriculum_roles_json: ["core"],
          source_refs_json: ["ev1"],
        },
      ];
    case "select-strict-qa-mentions":
      return [{ id: "mention:water", target_id: "node:water", source_refs_json: ["ev1"] }];
    case "select-strict-qa-evidence":
      return [{ id: "ev1" }];
    case "select-strict-qa-node-cards":
      return [
        {
          node_id: "node:water",
          summary: "Water summary.",
          source_refs_json: ["ev1"],
          sections_json: ["definition", "essence", "key_points", "example", "application", "misconception"].map((sectionType) => ({
            id: sectionType,
            section_type: sectionType,
            source_refs: ["ev1"],
          })),
        },
      ];
    case "select-strict-qa-node-bodies":
      return [
        {
          node_id: "node:water",
          format: "markdown",
          content: "Water body.",
          media_refs_json: [],
          source_refs_json: ["ev1"],
          generated_from: "card_expansion",
          status: "active",
        },
      ];
    default:
      return [];
  }
}
