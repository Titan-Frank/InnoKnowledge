import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmbeddingTextBatches,
  composeEmbeddingText,
  embedTextsOpenAICompatible,
  EMBEDDING_VECTOR_DIMENSION,
  formatEmbeddingVector,
  planEmbeddingUpdatesForBatch,
  type EmbeddingFetch,
} from "./embeddings.js";

test("composes embedding text like Python backfill_embeddings", () => {
  assert.equal(
    composeEmbeddingText({
      name: "Water",
      definition: "A substance",
      aliases_json: ["H2O", "", null, "dihydrogen monoxide"],
      domains_json: ["chemistry", "biology"],
    }),
    "Water A substance H2O、dihydrogen monoxide chemistry、biology",
  );
});

test("skips empty embedding text parts", () => {
  assert.equal(
    composeEmbeddingText({
      name: "",
      definition: "  ",
      aliases_json: [],
      domains_json: ["general"],
    }),
    "general",
  );
  assert.equal(composeEmbeddingText({ aliases_json: "not-array", domains_json: null }), "");
});

test("builds embedding text batches like Python backfill rows", () => {
  const rows = [
    { id: "n1", name: "Water", definition: "A substance" },
    { id: "n2", name: "Atom", aliases_json: ["粒子"] },
    { id: "n3", name: "Cycle", domains_json: ["science"] },
  ];

  assert.deepEqual(buildEmbeddingTextBatches(rows, 2), [
    {
      rows: rows.slice(0, 2),
      texts: ["Water A substance", "Atom 粒子"],
    },
    {
      rows: rows.slice(2),
      texts: ["Cycle science"],
    },
  ]);
  assert.throws(() => buildEmbeddingTextBatches(rows, 0), /batchSize must be a positive integer/);
});

test("plans embedding updates from batch vectors like Python zip behavior", () => {
  assert.deepEqual(
    planEmbeddingUpdatesForBatch(
      [
        { id: "n1", raw_node_id: "raw-1" },
        { id: "n2", raw_node_id: "raw-2" },
        { id: "n3", raw_node_id: "raw-3" },
      ],
      [[0.1], [], [0.3], [0.4]],
      "id",
    ),
    [
      { id: "n1", vector: [0.1] },
      { id: "n3", vector: [0.3] },
    ],
  );
  assert.deepEqual(planEmbeddingUpdatesForBatch([{ raw_node_id: "raw-1" }], [[0.2]], "raw_node_id"), [{ id: "raw-1", vector: [0.2] }]);
});

test("formats embedding vectors as pgvector text", () => {
  assert.equal(formatEmbeddingVector([0.1, 2, -3]), "[0.1,2,-3]");
  assert.equal(formatEmbeddingVector([]), null);
  assert.equal(formatEmbeddingVector([0.1, Number.NaN]), null);
});

test("embeds texts with OpenAI-compatible response behavior", async () => {
  const longVector = Array.from({ length: EMBEDDING_VECTOR_DIMENSION + 1 }, (_, index) => index);
  const fetchEmbedding: EmbeddingFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        { index: 0, embedding: [1, 2] },
        { index: 1, embedding: longVector },
      ],
    }),
  });

  const vectors = await embedTextsOpenAICompatible(["too-short", "long"], {
    fetch: fetchEmbedding,
    sleep: async () => undefined,
  });

  assert.deepEqual(vectors[0], []);
  assert.equal(vectors[1]?.length, EMBEDDING_VECTOR_DIMENSION);
  assert.equal(vectors[1]?.at(-1), EMBEDDING_VECTOR_DIMENSION - 1);
});

test("does not make a network request without an explicit embedding URL", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("unexpected network request");
  }) as typeof fetch;

  try {
    const vectors = await embedTextsOpenAICompatible(["private lesson text"], { maxRetries: 1 });
    assert.deepEqual(vectors, [[]]);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
