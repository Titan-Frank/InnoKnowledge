import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelNodeBodyPrompt,
  buildSelectNodesForModelBodiesQuery,
  buildUpsertNodeBodyStatement,
  parseModelNodeBodyResultText,
  planModelNodeBodies,
  resolveBodyMediaRefs,
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
  assert.deepEqual(
    parseModelNodeBodyResultText('{"content":"正文内容 [ev1]"}'),
    { content: "正文内容 [ev1]", source_refs: ["ev1"], media_refs: [], properties: {} },
  );
  assert.deepEqual(
    parseModelNodeBodyResultText('{{"content":"正文","source_refs":["ev1"]}'),
    { content: "正文", source_refs: ["ev1"], media_refs: [], properties: {} },
  );
  assert.deepEqual(
    parseModelNodeBodyResultText('{{"content":"正文","source_refs":["ev1"]}}'),
    { content: "正文", source_refs: ["ev1"], media_refs: [], properties: {} },
  );
});

test("resolves local body images from cited image evidence", () => {
  const imageEvidence = {
    ...evidence,
    id: "ev-image",
    modality: "image",
    excerpt: "![](images/triangle.jpg)",
    properties_json: { path: "images/triangle.jpg" },
  };
  assert.deepEqual(
    resolveBodyMediaRefs(
      "## Example\n\n![triangle](images/triangle.jpg) [ev-image]",
      ["ev-image"],
      [imageEvidence],
    ),
    {
      mediaRefs: [{ evidence_id: "ev-image", path: "images/triangle.jpg" }],
      unresolvedRefs: [],
    },
  );
});

test("rejects local body images without matching cited image evidence", async () => {
  const plan = await planModelNodeBodies({
    datasetId: "main",
    nodes: [node],
    cards: [card],
    mentions: [{ target_id: node.id, source_id: "book", anchor_ref: "lesson:1", source_refs_json: ["ev1"] }],
    evidence: [evidence],
    existingBodies: [],
    modelName: "test-model",
    now: "now",
    generateBody: () => ({
      content: "## Example\n\n![invented](images/invented.jpg)",
      source_refs: ["ev1"],
    }),
  });

  assert.equal(plan.rows.length, 0);
  assert.deepEqual(plan.modelFailures, [{
    node_id: node.id,
    message: "Model output contains local image reference(s) without matching cited image evidence: images/invented.jpg",
  }]);
});

test("writes deterministic media refs for model body image evidence", async () => {
  const imageEvidence = {
    ...evidence,
    id: "ev-image",
    modality: "image",
    excerpt: "![](images/triangle.jpg)",
    properties_json: { path: "images/triangle.jpg" },
  };
  const plan = await planModelNodeBodies({
    datasetId: "main",
    nodes: [node],
    cards: [{ ...card, source_refs_json: ["ev-image"] }],
    mentions: [{ target_id: node.id, source_id: "book", anchor_ref: "lesson:1", source_refs_json: ["ev-image"] }],
    evidence: [imageEvidence],
    existingBodies: [],
    modelName: "test-model",
    now: "now",
    generateBody: () => ({
      content: "## Example\n\n![triangle](images/triangle.jpg) [ev-image]",
      source_refs: ["ev-image"],
    }),
  });

  assert.deepEqual(plan.modelFailures, []);
  assert.deepEqual(plan.rows[0]?.media_refs_json, [{ evidence_id: "ev-image", path: "images/triangle.jpg" }]);
});

test("builds model body node query scoped to a source book", () => {
  const statement = buildSelectNodesForModelBodiesQuery({
    datasetId: "main",
    bookId: "chem-book",
    limit: 25,
  });
  assert.deepEqual(statement.params, ["main", "", 25, "chem-book", false]);
  assert.match(statement.sql, /world_mentions AS mention/);
  assert.match(statement.sql, /world_evidence AS evidence/);
  assert.match(statement.sql, /evidence\.source_id = \$4/);
  assert.match(statement.sql, /world_node_bodies AS body/);
});

test("plans model-written bodies from node cards, including backfilled card context", async () => {
  const plan = await planModelNodeBodies({
    datasetId: "main",
    nodes: [node, { ...node, id: "rule:water-formula" }],
    cards: [card, backfilledCard],
    mentions: [
      { target_id: "concept:water", source_id: "book", anchor_ref: "lesson:1", source_refs_json: ["ev1"] },
      { target_id: "rule:water-formula", source_id: "book", anchor_ref: "lesson:1", source_refs_json: ["ev1"] },
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

  assert.deepEqual(plan.skippedBackfilledOnly, []);
  assert.deepEqual(plan.modelFailures, []);
  assert.equal(plan.rows.length, 2);
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
  assert.equal(plan.rows[1]?.node_id, "rule:water-formula");
  assert.equal(plan.rows[1]?.generated_from, "model_generation");
  assert.deepEqual(plan.rows[1]?.source_refs_json, ["ev1"]);
});

test("plans model-written bodies with bounded concurrency and stable row order", async () => {
  let active = 0;
  let maxActive = 0;
  const nodes = Array.from({ length: 4 }, (_, index) => ({
    ...node,
    id: `concept:water-${index}`,
    name: `Water ${index}`,
  }));
  const plan = await planModelNodeBodies({
    datasetId: "main",
    nodes,
    cards: nodes.map((item) => ({ ...card, node_id: item.id, title: item.name })),
    mentions: nodes.map((item) => ({ target_id: item.id, source_id: "book", anchor_ref: "lesson:1", source_refs_json: ["ev1"] })),
    evidence: [evidence],
    existingBodies: [],
    modelName: "test-model",
    now: "now",
    concurrency: 2,
    generateBody: async (input) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return {
        content: `## 定义\n\n${input.node.name} 的正式正文。`,
        source_refs: [input.evidence[0]!.id],
      };
    },
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(plan.rows.map((row) => row.node_id), nodes.map((item) => item.id));
  assert.deepEqual(plan.modelFailures, []);
});

test("builds a constrained upsert statement for node bodies", () => {
  const statement = buildUpsertNodeBodyStatement({
    dataset_id: "main",
    node_id: "concept:water",
    format: "markdown",
    content: "## 定义\n\nWater 的正式正文。",
    media_refs_json: [],
    source_refs_json: ["ev1"],
    generated_from: "model_generation",
    properties_json: { source: "model_node_body" },
    status: "active",
    created_at: "now",
    updated_at: "now",
  });
  assert.equal(statement.name, "upsert-world-node-body");
  assert.match(statement.sql, /INSERT INTO world_node_bodies/);
  assert.match(statement.sql, /ON CONFLICT \(dataset_id, node_id\) DO UPDATE SET/);
  assert.deepEqual(statement.params.slice(0, 4), ["main", "concept:water", "markdown", "## 定义\n\nWater 的正式正文。"]);
});

test("runs model node body generation from database rows by default", async () => {
  const executed: string[] = [];
  const modelNode = { ...node, id: "concept:model-water" };
  const modelCard = { ...card, node_id: modelNode.id };
  const result = await runGenerateNodeBodiesFromDatabase({
    datasetId: "main",
    bookId: "book",
    now: "now",
    concurrency: 2,
    modelName: "test-model",
    query: (statement) => {
      if (statement.name === "select-node-cards-for-bodies") return [modelCard];
      if (statement.name === "select-existing-node-bodies") return [];
      if (statement.name === "select-nodes-for-model-bodies") {
        assert.deepEqual(statement.params, ["main", "", 0, "book", false]);
        return [modelNode];
      }
      if (statement.name === "select-mentions-for-model-bodies") {
        return [{ target_id: modelNode.id, source_id: "book", anchor_ref: "lesson:1", source_refs_json: ["ev1"] }];
      }
      if (statement.name === "select-evidence-for-model-bodies") return [evidence];
      return [];
    },
    generateBody: (input) => ({
      content: `## 定义\n\n${input.node.name} 的正式正文。`,
      source_refs: [input.evidence[0]!.id],
    }),
    executeStatement: (statement) => {
      executed.push(statement.name);
    },
  });

  assert.equal(result.mode, "model");
  assert.equal(result.selected, 1);
  assert.equal(result.generated, 1);
  assert.equal(result.failed_model_generation, 0);
  assert.deepEqual(result.read_statements, [
    "select-node-cards-for-bodies",
    "select-existing-node-bodies",
    "select-nodes-for-model-bodies",
    "select-mentions-for-model-bodies",
    "select-evidence-for-model-bodies",
  ]);
  assert.deepEqual(result.statements, ["upsert-world-node-body"]);
  assert.deepEqual(result.executedStatements, executed);
});
