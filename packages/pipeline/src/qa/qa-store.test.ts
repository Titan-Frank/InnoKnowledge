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
    "select-strict-qa-domain-schemas",
    "select-strict-qa-domain-profiles",
    "select-strict-qa-curriculum-projections",
    "select-strict-qa-mentions",
    "select-strict-qa-evidence",
    "select-strict-qa-node-cards",
    "select-strict-qa-node-bodies",
  ]);
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
          schema_id: "domain:chemistry:v1",
          schema_version: "1.0",
          domain_role: "substance",
          source_refs_json: ["ev1"],
        },
      ];
    case "select-strict-qa-domain-schemas":
      return [
        {
          schema_id: "domain:chemistry:v1",
          domain: "chemistry",
          schema_version: "1.0",
          roles_json: ["substance"],
        },
      ];
    case "select-strict-qa-curriculum-projections":
      return [
        {
          id: "curriculum-projection:water",
          node_id: "node:water",
          domain: "chemistry",
          curriculum_id: "cn-basic-education",
          school_stage: "higher",
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
