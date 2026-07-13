import assert from "node:assert/strict";
import test from "node:test";

import { makeCanonicalNodeId, makeMergeRunId } from "../shared/knowledge.js";
import { addMergeLessonStats, canonicalCandidatesFromRows, emptyMergeLessonStats, planStagedLessonMerge, planStagedLessonsMerge } from "./merge-staged-lesson.js";

test("returns Python-compatible empty merge lesson stats", () => {
  assert.deepEqual(emptyMergeLessonStats(), {
    nodes_created: 0,
    nodes_matched: 0,
    nodes_review: 0,
    edges_upserted: 0,
    domain_profiles_upserted: 0,
    curriculum_projections_upserted: 0,
    mentions_upserted: 0,
    evidence_upserted: 0,
    evidence_links_upserted: 0,
    node_cards_upserted: 0,
  });
});

test("adds merge lesson stats field by field", () => {
  assert.deepEqual(
    addMergeLessonStats(
      {
        nodes_created: 1,
        nodes_matched: 2,
        nodes_review: 3,
        edges_upserted: 4,
        domain_profiles_upserted: 5,
        curriculum_projections_upserted: 0,
        mentions_upserted: 6,
        evidence_upserted: 7,
        evidence_links_upserted: 8,
        node_cards_upserted: 9,
      },
      {
        nodes_created: 10,
        nodes_matched: 20,
        nodes_review: 30,
        edges_upserted: 40,
        domain_profiles_upserted: 50,
        curriculum_projections_upserted: 0,
        mentions_upserted: 60,
        evidence_upserted: 70,
        evidence_links_upserted: 80,
        node_cards_upserted: 90,
      },
    ),
    {
      nodes_created: 11,
      nodes_matched: 22,
      nodes_review: 33,
      edges_upserted: 44,
      domain_profiles_upserted: 55,
      curriculum_projections_upserted: 0,
      mentions_upserted: 66,
      evidence_upserted: 77,
      evidence_links_upserted: 88,
      node_cards_upserted: 99,
    },
  );
});

test("plans empty staged lessons merge like Python no-op output", () => {
  assert.deepEqual(
    planStagedLessonsMerge({
      datasetId: "main",
      lessons: [],
      canonicalNodes: [],
      now: "now",
    }),
    {
      status: "success",
      merge_run_id: null,
      selection_json: [],
      merged: 0,
      lessons: [],
      stats: emptyMergeLessonStats(),
      issues: [],
    },
  );
});

test("plans one staged lesson merge in Python order without database execution", () => {
  const waterId = makeCanonicalNodeId("concept", "Water", null);
  const plan = planStagedLessonMerge({
    datasetId: "main",
    mergeRunId: "merge:1",
    lessonRunId: "lesson-run:1",
    canonicalNodes: canonicalCandidatesFromRows([]),
    staged: {
      nodes: [
        {
          raw_node_id: "raw-water",
          name: "Water",
          kind: "concept",
          subkind: null,
          definition: "Water is a substance.",
          aliases_json: [],
          domains_json: ["chemistry"],
          knowledge_form_json: ["propositional"],
          learning_mode_json: ["conceptual"],
          scope: "domain-specific",
          properties_json: {},
          external_ids_json: {},
          tags_json: [],
          semantic_key: null,
          embedding: [],
          created_at: "created-1",
        },
        {
          raw_node_id: "raw-water-repeat",
          name: "Water",
          kind: "concept",
          subkind: null,
          definition: "Repeated extraction.",
          aliases_json: [],
          domains_json: ["chemistry"],
          knowledge_form_json: ["propositional"],
          learning_mode_json: ["conceptual"],
          scope: "domain-specific",
          properties_json: {},
          external_ids_json: {},
          tags_json: [],
          semantic_key: null,
          embedding: [],
          created_at: "created-2",
        },
      ],
      evidence: [
        {
          raw_evidence_id: "raw-evidence:1",
          source_type: "textbook",
          source_id: "chem",
          anchor_ref: "struct:chem:chunk:1",
          source_path: "data/full.md",
          page_start: 1,
          page_end: 1,
          excerpt: "Water is a substance.",
          locator: "p1",
          modality: "text",
          extraction_method: "llm",
          normalized_claims_json: [],
          properties_json: {},
          created_at: "evidence-created",
        },
      ],
      edges: [
        {
          from_raw_node_id: "raw-water",
          to_raw_node_id: "raw-water-repeat",
          type: "related_to",
          directionality: "undirected",
          confidence: 0.7,
          source_refs_json: ["raw-evidence:1"],
          properties_json: {},
          created_at: "edge-created",
          notes: "",
        },
        {
          from_raw_node_id: "raw-water",
          to_raw_node_id: "raw-missing",
          type: "related_to",
          source_refs_json: ["raw-evidence:1"],
        },
      ],
      domain_profiles: [
        {
          raw_node_id: "raw-water",
          domain: "chemistry",
          schema_id: "domain:chemistry:v1",
          schema_version: "1.0",
          domain_role: "substance",
          source_refs_json: ["raw-evidence:1", "raw-missing"],
          properties_json: {},
          created_at: "profile-created",
          notes: "",
        },
      ],
      mentions: [
        {
          raw_mention_id: "raw-mention:1",
          source_type: "textbook",
          source_id: "chem",
          anchor_ref: "struct:chem:chunk:1",
          target_type: "node",
          target_raw_id: "raw-water-repeat",
          role: "defines",
          source_refs_json: ["raw-evidence:1"],
          confidence: 0.8,
          properties_json: {},
          created_at: "mention-created",
        },
      ],
      node_cards: [
        {
          raw_node_id: "raw-water",
          raw_card_id: "card:water",
          title: "Water",
          summary: "Water summary",
          source_refs_json: ["raw-evidence:1"],
          sections_json: [{ id: "definition", text: "Water is a substance.", source_refs: ["raw-evidence:1"] }],
          properties_json: {},
          created_at: "card-created",
        },
        {
          raw_node_id: "raw-missing",
          raw_card_id: "card:missing",
        },
      ],
    },
    now: "now",
  });

  assert.equal(plan.lesson_run_id, "lesson-run:1");
  assert.deepEqual(plan.node_map, {
    "raw-water": waterId,
    "raw-water-repeat": waterId,
  });
  assert.deepEqual(Object.keys(plan.evidence_id_by_raw), ["raw-evidence:1"]);
  assert.deepEqual(
    plan.nodes.map((node) => node.resolution),
    ["created", "matched"],
  );
  assert.equal(plan.edges.length, 1);
  assert.equal(plan.domain_profiles.length, 1);
  assert.equal(plan.mentions.length, 1);
  assert.equal(plan.node_cards.length, 1);
  assert.deepEqual(plan.domain_profiles[0]?.payload.source_refs_json, [plan.evidence_id_by_raw["raw-evidence:1"]]);
  assert.deepEqual(plan.edges[0]?.payload.source_refs_json, [plan.evidence_id_by_raw["raw-evidence:1"]]);
  assert.deepEqual(plan.node_cards[0]?.section_evidence_links[0]?.evidence_links.inserted, 1);
  assert.deepEqual(plan.stats, {
    nodes_created: 1,
    nodes_matched: 1,
    nodes_review: 0,
    edges_upserted: 1,
    domain_profiles_upserted: 1,
    curriculum_projections_upserted: 0,
    mentions_upserted: 1,
    evidence_upserted: 1,
    evidence_links_upserted: 5,
    node_cards_upserted: 1,
  });
});

test("plans multiple staged lessons with cross-lesson canonical candidates and profile state", () => {
  const waterId = makeCanonicalNodeId("concept", "Water", null);
  const plan = planStagedLessonsMerge({
    datasetId: "main",
    lessons: [
      {
        lesson_run_id: "lesson-run:1",
        staged: {
          nodes: [
            {
              raw_node_id: "raw-water-1",
              name: "Water",
              kind: "concept",
              subkind: null,
              definition: "Water is a substance.",
              aliases_json: [],
              domains_json: ["chemistry"],
              knowledge_form_json: ["propositional"],
              learning_mode_json: ["conceptual"],
              scope: "domain-specific",
              properties_json: {},
              external_ids_json: {},
              tags_json: [],
              semantic_key: null,
              embedding: [],
              created_at: "node-created-1",
            },
          ],
          evidence: [
            {
              raw_evidence_id: "raw-evidence:1",
              anchor_ref: "struct:chem:chunk:1",
              excerpt: "Water is a substance.",
              normalized_claims_json: [],
              properties_json: {},
              created_at: "evidence-created-1",
            },
          ],
          domain_profiles: [
            {
              raw_node_id: "raw-water-1",
              domain: "chemistry",
              schema_id: "domain:chemistry:v1",
              schema_version: "1.0",
              domain_role: "substance",
              source_refs_json: ["raw-evidence:1"],
              properties_json: { first: true },
              created_at: "profile-created-1",
              notes: "first profile",
            },
          ],
        },
      },
      {
        lesson_run_id: "lesson-run:2",
        staged: {
          nodes: [
            {
              raw_node_id: "raw-water-2",
              name: "Water",
              kind: "concept",
              subkind: null,
              definition: "Water appears again.",
              aliases_json: [],
              domains_json: ["chemistry"],
              knowledge_form_json: ["propositional"],
              learning_mode_json: ["conceptual"],
              scope: "domain-specific",
              properties_json: {},
              external_ids_json: {},
              tags_json: [],
              semantic_key: null,
              embedding: [],
              created_at: "node-created-2",
            },
          ],
          evidence: [
            {
              raw_evidence_id: "raw-evidence:2",
              anchor_ref: "struct:chem:chunk:2",
              excerpt: "Water appears again.",
              normalized_claims_json: [],
              properties_json: {},
              created_at: "evidence-created-2",
            },
          ],
          domain_profiles: [
            {
              raw_node_id: "raw-water-2",
              domain: "chemistry",
              schema_id: "domain:chemistry:v1",
              schema_version: "1.0",
              domain_role: "substance",
              source_refs_json: ["raw-evidence:2"],
              properties_json: { second: true },
              created_at: "profile-created-2",
              notes: "second profile",
            },
          ],
        },
      },
    ],
    canonicalNodes: canonicalCandidatesFromRows([]),
    now: "now",
  });

  assert.equal(plan.status, "success");
  assert.equal(plan.merge_run_id, makeMergeRunId("main", ["lesson-run:1", "lesson-run:2"]));
  assert.deepEqual(plan.selection_json, ["lesson-run:1", "lesson-run:2"]);
  assert.equal(plan.merged, 2);
  assert.deepEqual(
    plan.lessons.map((lesson) => lesson.nodes.map((node) => node.resolution)),
    [["created"], ["matched"]],
  );
  assert.deepEqual(plan.lessons[0]?.node_map, { "raw-water-1": waterId });
  assert.deepEqual(plan.lessons[1]?.node_map, { "raw-water-2": waterId });

  const firstEvidenceId = plan.lessons[0]?.evidence_id_by_raw["raw-evidence:1"];
  const secondEvidenceId = plan.lessons[1]?.evidence_id_by_raw["raw-evidence:2"];
  const profileId = plan.lessons[0]?.domain_profiles[0]?.payload.id;
  assert.ok(firstEvidenceId);
  assert.ok(secondEvidenceId);
  assert.ok(profileId);
  assert.deepEqual(plan.lessons[1]?.domain_profiles[0]?.payload, {
    dataset_id: "main",
    id: profileId,
    node_id: waterId,
    domain: "chemistry",
    schema_id: "domain:chemistry:v1",
    schema_version: "1.0",
    domain_role: "substance",
    source_refs_json: [firstEvidenceId, secondEvidenceId],
    properties_json: { first: true, second: true },
    status: "active",
    created_at: "profile-created-1",
    updated_at: "now",
    notes: "first profile\n\nsecond profile",
  });
  assert.deepEqual(plan.stats, {
    nodes_created: 1,
    nodes_matched: 1,
    nodes_review: 0,
    edges_upserted: 0,
    domain_profiles_upserted: 2,
    curriculum_projections_upserted: 0,
    mentions_upserted: 0,
    evidence_upserted: 2,
    evidence_links_upserted: 3,
    node_cards_upserted: 0,
  });
});
