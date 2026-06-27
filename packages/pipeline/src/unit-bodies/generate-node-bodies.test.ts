import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelNodeBodyPrompt,
  buildUpsertNodeBodyStatement,
  parseModelNodeBodyResultText,
  planModelNodeBodies,
  planNodeBodiesFromCards,
  renderNodeCardBodyMarkdown,
  runGenerateNodeBodiesFromDatabase,
} from "./generate-node-bodies.js";

const card = {
  node_id: "concept:water",
  title: "Water",
  summary: "Water is a common substance.",
  source_refs_json: ["ev1"],
  properties_json: {},
  sections_json: [
    { id: "definition", section_type: "definition", title: "Definition", content: ["A substance."], source_refs: ["ev1"] },
    { id: "example", section_type: "example", title: "Example", content: "Ice and steam are related forms.", source_refs: ["ev2"] },
  ],
};

const backfilledCard = {
  node_id: "rule:water-formula",
  title: "Water formula",
  summary: "H2O is the formula for water.",
  source_refs_json: ["ev1"],
  properties_json: { backfilled: true },
  sections_json: [
    {
      id: "definition",
      section_type: "definition",
      title: "Definition",
      content: ["H2O is the formula for water."],
      source_refs: ["ev1"],
      properties: { backfilled: true },
    },
    {
      id: "essence",
      section_type: "essence",
      title: "Essence",
      content: ["H2O is the formula for water."],
      source_refs: ["ev1"],
      properties: { backfilled: true },
    },
  ],
};

const node = {
  id: "concept:water",
  name: "Water",
  kind: "concept",
  subkind: null,
  definition: "Water is a substance.",
  aliases_json: ["H2O"],
  domains_json: ["chemistry"],
  knowledge_form_json: ["propositional"],
  learning_mode_json: ["conceptual"],
  scope: "universal",
  properties_json: {},
  tags_json: ["matter"],
};

const evidence = {
  id: "ev1",
  source_type: "textbook",
  source_id: "book",
  anchor_ref: "lesson:1",
  source_path: "book.md",
  page_start: 1,
  page_end: 1,
  excerpt: "Water is a common substance. Ice and steam are related forms.",
  locator: "p.1",
  modality: "text",
  normalized_claims_json: ["Water is common."],
  properties_json: {},
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

test("does not render backfilled placeholder sections as formal body content", () => {
  assert.equal(renderNodeCardBodyMarkdown(backfilledCard), "");
  assert.equal(
    renderNodeCardBodyMarkdown({
      ...card,
      sections_json: [
        ...card.sections_json,
        {
          id: "duplicate",
          section_type: "essence",
          title: "Essence",
          content: ["A substance."],
          source_refs: ["ev1"],
          properties: { backfilled: true },
        },
      ],
    }),
    renderNodeCardBodyMarkdown(card),
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
      backfilledCard,
    ],
    existingBodies: [{ node_id: "concept:manual", generated_from: "manual" }],
    now: "now",
  });

  assert.deepEqual(plan.skippedExisting, ["concept:manual"]);
  assert.deepEqual(plan.skippedMissingSourceRefs, ["concept:no-sources"]);
  assert.deepEqual(plan.skippedEmptyContent, ["concept:empty"]);
  assert.deepEqual(plan.skippedBackfilledOnly, ["rule:water-formula"]);
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(plan.rows[0], {
    dataset_id: "main",
    node_id: "concept:water",
    format: "markdown",
    content: renderNodeCardBodyMarkdown(card),
    media_refs_json: [],
    source_refs_json: ["ev1", "ev2"],
    generated_from: "card_expansion",
    properties_json: { source: "world_node_cards", card_title: "Water", filtered_backfilled_sections: 0 },
    status: "active",
    created_at: "now",
    updated_at: "now",
  });
});

test("builds a model node body prompt with node card and evidence context", () => {
  const prompt = buildModelNodeBodyPrompt({
    datasetId: "main",
    node,
    card,
    card_markdown: renderNodeCardBodyMarkdown(card),
    evidence: [evidence],
  });
  assert.match(prompt.instructions, /知识正文写作者/);
  assert.match(prompt.user_payload, /concept:water/);
  assert.match(prompt.user_payload, /ev1/);
  assert.deepEqual((prompt.response_schema.schema as { required: string[] }).required, ["content", "source_refs"]);
});

test("parses model node body JSON from plain or fenced output", () => {
  assert.deepEqual(
    parseModelNodeBodyResultText('```json\n{"content":"正文","source_refs":["ev1"]}\n```'),
    { content: "正文", source_refs: ["ev1"], media_refs: [], properties: {} },
  );
  assert.deepEqual(
    parseModelNodeBodyResultText('{"markdown":"正文","evidence_refs":["ev1"]}'),
    { content: "正文", source_refs: ["ev1"], media_refs: [], properties: {} },
  );
});

test("plans model-written bodies from node cards and evidence", async () => {
  const plan = await planModelNodeBodies({
    datasetId: "main",
    nodes: [node, { ...node, id: "rule:water-formula" }],
    cards: [card, backfilledCard],
    mentions: [
      { target_id: "concept:water", source_id: "book", anchor_ref: "lesson:1", source_refs_json: ["ev1"] },
    ],
    evidence: [evidence],
    existingBodies: [],
    modelName: "test-model",
    now: "now",
    generateBody: (input) => ({
      content: `## 定义\n\n${input.node.name} 的正式正文。`,
      source_refs: [input.evidence[0]!.id],
    }),
  });

  assert.deepEqual(plan.skippedBackfilledOnly, ["rule:water-formula"]);
  assert.deepEqual(plan.modelFailures, []);
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(plan.rows[0], {
    dataset_id: "main",
    node_id: "concept:water",
    format: "markdown",
    content: "## 定义\n\nWater 的正式正文。",
    media_refs_json: [],
    source_refs_json: ["ev1"],
    generated_from: "model_generation",
    properties_json: {
      source: "model_node_body",
      model: "test-model",
      prompt_version: "node-body-writer-v1",
      card_title: "Water",
      evidence_count: 1,
    },
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
    mode: "card",
    dataset_id: "main",
    selected: 1,
    generated: 1,
    skipped_existing: 0,
    skipped_missing_source_refs: 0,
    skipped_empty_content: 0,
    skipped_backfilled_only: 0,
    failed_model_generation: 0,
    model_failures: [],
    read_statements: ["select-node-cards-for-bodies", "select-existing-node-bodies"],
    statements: ["upsert-world-node-body"],
    executedStatements: executed,
  });
});
