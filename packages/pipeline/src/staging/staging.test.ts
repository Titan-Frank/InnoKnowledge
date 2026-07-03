import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmbeddingText,
  normalizeDomainProfiles,
  normalizeEdges,
  normalizeEvidence,
  normalizeLessonArtifacts,
  normalizeMentions,
  normalizeNodeCards,
  normalizeNodes,
} from "./staging.js";

const bookId = "chem-grade8";
const anchor = "struct:chem-grade8:lesson:1-1-1";

test("staging normalizers match Python store_lesson_staging business output", () => {
  const nodes = normalizeNodes([
    {
      id: " n1 ",
      name: " Water ",
      kind: "concept",
      definition: " A substance ",
      aliases: [" H2O ", "Water", "H2O"],
      domains: ["chemistry", "bad"],
      knowledge_form: ["propositional", "bad"],
      learning_mode: ["bad", "factual"],
      scope: "invalid-scope",
      properties: { p: 1 },
      external_ids: ["bad"],
      tags: [" tag ", "tag"],
      source_refs: [" e1 ", "e1"],
      status: "",
      notes: " note ",
    },
  ]);

  assert.deepEqual(nodes, [
    {
      raw_node_id: "n1",
      name: "Water",
      kind: "concept",
      subkind: null,
      definition: "A substance",
      aliases_json: ["H2O", "Water"],
      domains_json: ["chemistry"],
      knowledge_form_json: ["propositional"],
      learning_mode_json: ["factual"],
      scope: "invalid-scope",
      properties_json: { p: 1 },
      external_ids_json: {},
      tags_json: ["tag"],
      semantic_key: "water",
      embedding_json: null,
      source_refs_json: ["e1"],
      status: "draft",
      notes: "note",
    },
  ]);
  assert.equal(buildEmbeddingText(nodes[0]!), "Water\nA substance\nH2O, Water\nchemistry");

  assert.deepEqual(
    normalizeEdges([
      {
        id: " e1 ",
        type: "is_a",
        from: " n1 ",
        to: " n2 ",
        confidence: 0,
        source_refs: [" ref ", "ref"],
        properties: { w: 2 },
      },
    ]),
    [
      {
        raw_edge_id: "e1",
        type: "is_a",
        from_raw_node_id: "n1",
        to_raw_node_id: "n2",
        directionality: "directed",
        confidence: 0.8,
        source_refs_json: ["ref"],
        properties_json: { w: 2 },
        status: "draft",
        notes: "",
      },
    ],
  );

  assert.deepEqual(
    normalizeDomainProfiles([
      {
        id: " p1 ",
        node_id: " n1 ",
        domain: "chemistry",
        school_stages: ["primary", "bad"],
        curriculum_roles: ["core", "bad"],
        source_refs: " ref ",
        properties: { grade: 8 },
        status: null,
        notes: " ok ",
      },
    ]),
    [
      {
        raw_profile_id: "p1",
        raw_node_id: "n1",
        domain: "chemistry",
        school_stages_json: ["primary"],
        curriculum_roles_json: ["core"],
        source_refs_json: ["ref"],
        properties_json: { grade: 8 },
        status: "draft",
        notes: "ok",
      },
    ],
  );

  assert.deepEqual(
    normalizeMentions([{ id: " m1 ", target_id: " n1 ", confidence: 0, source_refs: [" e1 ", "e1"], properties: ["bad"] }], bookId, anchor),
    [
      {
        raw_mention_id: "m1",
        source_type: "textbook",
        source_id: "chem-grade8",
        anchor_ref: "struct:chem-grade8:lesson:1-1-1",
        target_type: "node",
        target_raw_id: "n1",
        role: "mentions",
        source_refs_json: ["e1"],
        confidence: 0.8,
        properties_json: {},
      },
    ],
  );

  assert.deepEqual(
    normalizeEvidence([{ id: " ev1 ", excerpt: " text ", normalized_claims: [" claim ", "", "claim"], page_start: 1, properties: { k: "v" } }], bookId, anchor),
    [
      {
        raw_evidence_id: "ev1",
        source_type: "textbook",
        source_id: "chem-grade8",
        anchor_ref: "struct:chem-grade8:lesson:1-1-1",
        source_path: "",
        page_start: 1,
        page_end: null,
        excerpt: "text",
        locator: "",
        modality: "text",
        extraction_method: "ocr",
        normalized_claims_json: ["claim", "claim"],
        properties_json: { k: "v" },
      },
    ],
  );

  assert.deepEqual(
    normalizeNodeCards([
      {
        id: " c1 ",
        node_id: " n1 ",
        title: " Title ",
        summary: " Summary ",
        source_refs: [" e1 ", "e1"],
        sections: [
          { id: "", title: " Sec ", content: [" a ", "", "a"], source_refs: [" e1 ", "e1"], properties: { x: 1 } },
          "bad",
        ],
        properties: { card: true },
      },
    ]),
    [
      {
        raw_card_id: "c1",
        raw_node_id: "n1",
        title: "Title",
        summary: "Summary",
        source_refs_json: ["e1"],
        sections_json: [
          {
            id: "section",
            title: "Sec",
            section_type: "other",
            content: ["a", "a"],
            source_refs: ["e1"],
            properties: { x: 1 },
          },
        ],
        properties_json: { card: true },
        status: "draft",
      },
    ],
  );
});

test("normalizes a full lesson artifact bundle with Python-compatible count keys", () => {
  const result = normalizeLessonArtifacts(
    {
      nodes: [{ id: "n1", name: "Water", kind: "concept", definition: "A substance" }],
      edges: [{ id: "e1", type: "related_to", from: "n1", to: "n1" }],
      domainProfiles: [{ id: "p1", node_id: "n1", domain: "chemistry" }],
      mentions: [{ id: "m1", target_id: "n1" }],
      evidence: [{ id: "ev1", excerpt: "text" }],
      nodeCards: [{ id: "c1", node_id: "n1" }],
    },
    bookId,
    anchor,
  );

  assert.deepEqual(result.counts, {
    nodes: 1,
    edges: 1,
    domain_profiles: 1,
    mentions: 1,
    evidence: 1,
    node_cards: 1,
  });
  assert.equal(result.nodes[0]?.domains_json[0], "general");
  assert.equal(result.mentions[0]?.source_id, bookId);
  assert.equal(result.evidence[0]?.anchor_ref, anchor);
});

test("normalizes node subkind labels before staging", () => {
  const nodes = normalizeNodes([
    {
      id: "n-law",
      name: "闭合电路欧姆定律",
      kind: "rule",
      subkind: "物理定律",
      definition: "描述闭合电路中的电流规律。",
      properties: { semantic_core: { formal_expressions: ["I = E / (R + r)"] } },
    },
  ]);

  assert.equal(nodes[0]?.subkind, "physical_law");
  assert.deepEqual(nodes[0]?.properties_json, {
    semantic_core: { formal_expressions: ["I = E / (R + r)"] },
    classifications: {
      subkinds: ["physical_law"],
      raw_subkinds: ["物理定律"],
    },
  });
});

test("deduplicates mentions by raw id before staging counts and inserts", () => {
  const result = normalizeLessonArtifacts(
    {
      nodes: [{ id: "n1", name: "Water", kind: "concept", definition: "A substance" }],
      edges: [],
      domainProfiles: [],
      mentions: [
        { id: "m1", target_id: "n1", source_refs: ["ev1"] },
        { id: "m1", target_id: "n1", source_refs: ["ev2"] },
      ],
      evidence: [{ id: "ev1", excerpt: "text" }],
      nodeCards: [],
    },
    bookId,
    anchor,
  );

  assert.equal(result.counts.mentions, 1);
  assert.deepEqual(result.mentions.map((mention) => mention.raw_mention_id), ["m1"]);
  assert.deepEqual(result.mentions[0]?.source_refs_json, ["ev1"]);
});

test("deduplicates edges by raw id before staging counts and inserts", () => {
  const result = normalizeLessonArtifacts(
    {
      nodes: [
        { id: "n1", name: "Water", kind: "concept", definition: "A substance" },
        { id: "n2", name: "Liquid", kind: "concept", definition: "A state of matter" },
      ],
      edges: [
        { id: "e1", type: "related_to", from: "n1", to: "n2", source_refs: ["ev1"] },
        { id: "e1", type: "is_a", from: "n2", to: "n1", source_refs: ["ev2"] },
      ],
      domainProfiles: [],
      mentions: [],
      evidence: [{ id: "ev1", excerpt: "text" }],
      nodeCards: [],
    },
    bookId,
    anchor,
  );

  assert.equal(result.counts.edges, 1);
  assert.deepEqual(result.edges.map((edge) => edge.raw_edge_id), ["e1"]);
  assert.equal(result.edges[0]?.type, "related_to");
  assert.deepEqual(result.edges[0]?.source_refs_json, ["ev1"]);
});

test("normalizes model edge direction aliases to schema values", () => {
  assert.deepEqual(
    normalizeEdges([
      { id: "e1", type: "related_to", from: "n1", to: "n2", directionality: "forward" },
      { id: "e2", type: "related_to", from: "n1", to: "n2", directionality: "unidirectional" },
      { id: "e3", type: "related_to", from: "n1", to: "n2", directionality: "bidirectional" },
    ]).map((edge) => edge.directionality),
    ["directed", "directed", "undirected"],
  );
});

test("backfills missing mentions from evidence-backed node refs", () => {
  const result = normalizeLessonArtifacts(
    {
      nodes: [{ id: "n1", name: "Water", kind: "concept", definition: "A substance", source_refs: ["ev1"] }],
      edges: [],
      domainProfiles: [{ id: "p1", node_id: "n1", domain: "chemistry", source_refs: ["ev1"] }],
      mentions: [],
      evidence: [{ id: "ev1", excerpt: "text" }],
      nodeCards: [{ id: "c1", node_id: "n1", source_refs: ["ev1"], sections: [{ id: "definition", source_refs: ["ev1"] }] }],
    },
    bookId,
    anchor,
  );

  assert.equal(result.counts.mentions, 1);
  assert.equal(result.mentions[0]?.target_raw_id, "n1");
  assert.deepEqual(result.mentions[0]?.source_refs_json, ["ev1"]);
  assert.deepEqual(result.mentions[0]?.properties_json, { backfilled: true });
});

test("backfills node refs and mentions from profile and card refs", () => {
  const result = normalizeLessonArtifacts(
    {
      nodes: [{ id: "n1", name: "Water", kind: "concept", definition: "A substance" }],
      edges: [],
      domainProfiles: [{ id: "p1", node_id: "n1", domain: "chemistry", source_refs: ["ev1"] }],
      mentions: [{ id: "mention:auto:n1", target_id: "other", source_refs: ["ev1"] }],
      evidence: [{ id: "ev1", excerpt: "text" }],
      nodeCards: [{ id: "c1", node_id: "n1", source_refs: ["ev1"], sections: [{ id: "definition", source_refs: ["ev1"] }] }],
    },
    bookId,
    anchor,
  );

  assert.deepEqual(result.nodes[0]?.source_refs_json, ["ev1"]);
  assert.equal(result.counts.mentions, 2);
  const repaired = result.mentions.find((mention) => mention.target_raw_id === "n1");
  assert.equal(repaired?.raw_mention_id, "mention:auto:n1:2");
  assert.deepEqual(repaired?.source_refs_json, ["ev1"]);
});
