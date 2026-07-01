import assert from "node:assert/strict";
import test from "node:test";

import {
  composeUnitEmbeddingText,
  hashUnitEmbeddingText,
  runUnitEmbeddingBackfillFromDatabase,
} from "./unit-embeddings.js";

test("composes unit embedding text from node, card, body, and evidence", () => {
  const text = composeUnitEmbeddingText({
    node: {
      id: "node:rate",
      name: "Rate",
      kind: "concept",
      definition: "A comparison of two quantities.",
      aliases: ["ratio per unit"],
      domains: ["mathematics"],
      semanticCore: { core_claims: ["Rates relate two measurements."] },
    },
    card: {
      title: "Rate",
      summary: "How a quantity changes per unit.",
      sections: [{ title: "Example", content: "60 km per hour" }],
    },
    body: {
      content: "A rate can be represented with words, tables, graphs, and formulas.",
      generatedFrom: "model_generation",
    },
    evidence: [{ id: "e1", locator: "p. 12", excerpt: "Rates compare quantities with different units." }],
  });

  assert.match(text, /name: Rate/);
  assert.match(text, /card_summary: How a quantity changes per unit/);
  assert.match(text, /body:\nA rate can be represented/);
  assert.match(text, /evidence_id: e1/);
});

test("runs unit embedding backfill only for changed units", async () => {
  const unchangedText = composeUnitEmbeddingText({
    node: {
      id: "node:unchanged",
      name: "Unchanged",
      kind: "concept",
      definition: "Already indexed.",
      aliases: [],
      domains: [],
      semanticCore: undefined,
    },
    card: null,
    body: null,
    evidence: [],
  });
  const executed: string[] = [];

  const output = await runUnitEmbeddingBackfillFromDatabase({
    datasetId: "main",
    batchSize: 4,
    embeddingModel: "test-model",
    query: (statement) => {
      switch (statement.name) {
        case "select-unit-embedding-nodes":
          return [
            {
              id: "node:changed",
              name: "Changed",
              kind: "concept",
              definition: "Needs an embedding.",
              aliases_json: ["changed alias"],
              domains_json: ["math"],
              properties_json: {},
            },
            {
              id: "node:unchanged",
              name: "Unchanged",
              kind: "concept",
              definition: "Already indexed.",
              aliases_json: [],
              domains_json: [],
              properties_json: {},
            },
          ];
        case "select-unit-embedding-cards":
          return [
            {
              node_id: "node:changed",
              title: "Changed Card",
              summary: "Card summary.",
              sections_json: [{ title: "Use", content: "Use in retrieval." }],
            },
          ];
        case "select-unit-embedding-bodies":
          return [
            {
              node_id: "node:changed",
              content: "Generated body.",
              generated_from: "model_generation",
            },
          ];
        case "select-unit-embedding-evidence":
          return [
            {
              node_id: "node:changed",
              id: "e1",
              locator: "p. 1",
              excerpt: "Evidence excerpt.",
              modality: "text",
              properties_json: {},
            },
          ];
        case "select-existing-unit-embeddings":
          return [{
            node_id: "node:unchanged",
            content_hash: hashUnitEmbeddingText(unchangedText),
            embedding_model: "test-model",
          }];
        default:
          throw new Error(`Unexpected query ${statement.name}`);
      }
    },
    executeStatement: (statement) => {
      executed.push(statement.name);
      assert.equal(statement.params[0], "main");
      assert.equal(statement.params[1], "node:changed");
      assert.equal(statement.params[5], "test-model");
    },
    embedTexts: (texts) => {
      assert.equal(texts.length, 1);
      assert.match(texts[0] ?? "", /Changed Card/);
      return [[1, 2, 3]];
    },
  });

  assert.equal(output.selected, 2);
  assert.equal(output.pending, 1);
  assert.equal(output.updated, 1);
  assert.equal(output.skipped, 1);
  assert.deepEqual(executed, ["upsert-world-unit-embedding"]);
});

test("rebuilds unit embeddings when the embedding model changes", async () => {
  const unchangedText = composeUnitEmbeddingText({
    node: {
      id: "node:unchanged",
      name: "Unchanged",
      kind: "concept",
      definition: "Same text, new model.",
      aliases: [],
      domains: [],
      semanticCore: undefined,
    },
    card: null,
    body: null,
    evidence: [],
  });
  const executed: string[] = [];

  const output = await runUnitEmbeddingBackfillFromDatabase({
    datasetId: "main",
    batchSize: 4,
    embeddingModel: "new-model",
    query: (statement) => {
      switch (statement.name) {
        case "select-unit-embedding-nodes":
          return [{
            id: "node:unchanged",
            name: "Unchanged",
            kind: "concept",
            definition: "Same text, new model.",
            aliases_json: [],
            domains_json: [],
            properties_json: {},
          }];
        case "select-unit-embedding-cards":
        case "select-unit-embedding-bodies":
        case "select-unit-embedding-evidence":
          return [];
        case "select-existing-unit-embeddings":
          return [{
            node_id: "node:unchanged",
            content_hash: hashUnitEmbeddingText(unchangedText),
            embedding_model: "old-model",
          }];
        default:
          throw new Error(`Unexpected query ${statement.name}`);
      }
    },
    executeStatement: (statement) => {
      executed.push(statement.name);
      assert.equal(statement.params[1], "node:unchanged");
      assert.equal(statement.params[5], "new-model");
    },
    embedTexts: (texts) => {
      assert.equal(texts.length, 1);
      assert.match(texts[0] ?? "", /Same text, new model/);
      return [[1, 2, 3]];
    },
  });

  assert.equal(output.selected, 1);
  assert.equal(output.pending, 1);
  assert.equal(output.updated, 1);
  assert.equal(output.skipped, 0);
  assert.deepEqual(executed, ["upsert-world-unit-embedding"]);
});
