import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUpsertNodeBodyStatement,
  planNodeBodiesFromCards,
  renderNodeCardBodyMarkdown,
  runGenerateNodeBodiesFromDatabase,
} from "./generate-node-bodies.js";

const card = {
  node_id: "concept:water",
  title: "Water",
  summary: "Water is a common substance.",
  source_refs_json: ["ev1"],
  sections_json: [
    { id: "definition", section_type: "definition", title: "Definition", content: ["A substance."], source_refs: ["ev1"] },
    { id: "example", section_type: "example", title: "Example", content: "Ice and steam are related forms.", source_refs: ["ev2"] },
  ],
};

test("renders card sections into markdown body content", () => {
  assert.equal(
    renderNodeCardBodyMarkdown(card),
    [
      "Water is a common substance.",
      "",
      "## Definition",
      "",
      "A substance.",
      "",
      "## Example",
      "",
      "Ice and steam are related forms.",
    ].join("\n"),
  );
});

test("plans card expansion bodies with source refs and existing-body protection", () => {
  const plan = planNodeBodiesFromCards({
    datasetId: "main",
    cards: [
      card,
      { ...card, node_id: "concept:manual" },
      { ...card, node_id: "concept:no-sources", source_refs_json: [], sections_json: [] },
      { ...card, node_id: "concept:empty", summary: "", sections_json: [] },
    ],
    existingBodies: [{ node_id: "concept:manual", generated_from: "manual" }],
    now: "now",
  });

  assert.deepEqual(plan.skippedExisting, ["concept:manual"]);
  assert.deepEqual(plan.skippedMissingSourceRefs, ["concept:no-sources"]);
  assert.deepEqual(plan.skippedEmptyContent, ["concept:empty"]);
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(plan.rows[0], {
    dataset_id: "main",
    node_id: "concept:water",
    format: "markdown",
    content: renderNodeCardBodyMarkdown(card),
    media_refs_json: [],
    source_refs_json: ["ev1", "ev2"],
    generated_from: "card_expansion",
    properties_json: { source: "world_node_cards", card_title: "Water" },
    status: "active",
    created_at: "now",
    updated_at: "now",
  });
});

test("builds a constrained upsert statement for node bodies", () => {
  const plan = planNodeBodiesFromCards({ datasetId: "main", cards: [card], now: "now" });
  const statement = buildUpsertNodeBodyStatement(plan.rows[0]!);
  assert.equal(statement.name, "upsert-world-node-body");
  assert.match(statement.sql, /INSERT INTO world_node_bodies/);
  assert.match(statement.sql, /ON CONFLICT \(dataset_id, node_id\) DO UPDATE SET/);
  assert.deepEqual(statement.params.slice(0, 4), ["main", "concept:water", "markdown", renderNodeCardBodyMarkdown(card)]);
});

test("runs node body generation from database rows", async () => {
  const executed: string[] = [];
  const result = await runGenerateNodeBodiesFromDatabase({
    datasetId: "main",
    now: "now",
    query: (statement) => {
      if (statement.name === "select-node-cards-for-bodies") return [card];
      if (statement.name === "select-existing-node-bodies") return [];
      return [];
    },
    executeStatement: (statement) => {
      executed.push(statement.name);
    },
  });

  assert.deepEqual(result, {
    status: "success",
    dataset_id: "main",
    selected: 1,
    generated: 1,
    skipped_existing: 0,
    skipped_missing_source_refs: 0,
    skipped_empty_content: 0,
    read_statements: ["select-node-cards-for-bodies", "select-existing-node-bodies"],
    statements: ["upsert-world-node-body"],
    executedStatements: executed,
  });
});
