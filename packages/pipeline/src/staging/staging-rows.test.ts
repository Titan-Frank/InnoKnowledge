import assert from "node:assert/strict";
import test from "node:test";

import { buildStagingTableRows } from "./staging-rows.js";
import { normalizeLessonArtifacts } from "./staging.js";

const context = {
  datasetId: "main",
  lessonRunId: "lesson-run:1",
  bookId: "chem-grade8",
  batchAnchor: "struct:chem-grade8:lesson:1-1-1",
  now: "2026-01-02T03:04:05+00:00",
};

test("builds staging table rows using PostgreSQL column names and Python-compatible defaults", () => {
  const artifacts = normalizeLessonArtifacts(
    {
      nodes: [
        {
          id: "n1",
          name: "Water",
          kind: "concept",
          definition: "A substance",
          aliases: ["H2O"],
          domains: ["chemistry"],
          learning_mode: ["factual"],
          scope: "invalid-scope",
          embedding_json: [0.1, 0.2],
          properties: { p: 1 },
          notes: "note",
        },
      ],
      edges: [{ id: "e1", type: "is_a", from: "n1", to: "n2", confidence: 0 }],
      domainProfiles: [{ id: "p1", node_id: "n1", domain: "chemistry", school_stages: ["primary"] }],
      mentions: [{ id: "m1", target_id: "n1" }],
      evidence: [{ id: "ev1", excerpt: "claim", normalized_claims: ["claim", "claim"] }],
      nodeCards: [{ id: "c1", node_id: "n1", sections: [{ id: "", title: "Evidence", content: ["claim"] }] }],
    },
    context.bookId,
    context.batchAnchor,
  );

  const rows = buildStagingTableRows(context, artifacts);

  assert.deepEqual(rows.lesson_run, {
    dataset_id: "main",
    lesson_run_id: "lesson-run:1",
    book_id: "chem-grade8",
    batch_anchor: "struct:chem-grade8:lesson:1-1-1",
    status: "staged",
    counts_json: {
      nodes: 1,
      edges: 1,
      domain_profiles: 1,
      mentions: 1,
      evidence: 1,
      node_cards: 1,
    },
    properties_json: {},
    created_at: context.now,
    updated_at: context.now,
  });

  assert.deepEqual(rows.nodes[0], {
    dataset_id: "main",
    lesson_run_id: "lesson-run:1",
    raw_node_id: "n1",
    book_id: "chem-grade8",
    batch_anchor: "struct:chem-grade8:lesson:1-1-1",
    name: "Water",
    kind: "concept",
    subkind: null,
    definition: "A substance",
    aliases_json: ["H2O"],
    domains_json: ["chemistry"],
    knowledge_form_json: [],
    learning_mode_json: ["factual"],
    scope: "domain-specific",
    properties_json: { p: 1 },
    external_ids_json: {},
    tags_json: [],
    semantic_key: "water",
    embedding: [0.1, 0.2],
    source_refs_json: [],
    status: "draft",
    created_at: context.now,
    updated_at: context.now,
    notes: "note",
  });

  assert.equal(rows.edges[0]?.confidence, 0.8);
  assert.equal(rows.mentions[0]?.source_id, "chem-grade8");
  assert.deepEqual(rows.evidence[0]?.normalized_claims_json, ["claim", "claim"]);
  assert.equal(rows.node_cards[0]?.sections_json[0]?.id, "section");
});
