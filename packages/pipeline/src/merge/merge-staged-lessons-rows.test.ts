import assert from "node:assert/strict";
import test from "node:test";

import { buildMergeRowsPlanInput, buildStagedLessonInputs, evidenceIdsFromRows, indexRowsByStringKey } from "./merge-staged-lessons-rows.js";

test("builds staged lesson inputs from fetched rows while preserving lesson run order", () => {
  const lessons = buildStagedLessonInputs(
    [{ lesson_run_id: "lesson-run:2" }, { lesson_run_id: "lesson-run:1" }],
    {
      nodes: [
        { lesson_run_id: "lesson-run:1", raw_node_id: "n1" },
        { lesson_run_id: "lesson-run:2", raw_node_id: "n2" },
        { lesson_run_id: "lesson-run:missing", raw_node_id: "ignored" },
      ],
      evidence: [{ lesson_run_id: "lesson-run:2", raw_evidence_id: "ev2" }],
      edges: [{ lesson_run_id: "lesson-run:1", raw_edge_id: "edge1" }],
      domain_profiles: [{ lesson_run_id: "lesson-run:1", raw_profile_id: "profile1" }],
      curriculum_projections: [{ lesson_run_id: "lesson-run:2", raw_projection_id: "projection2" }],
      mentions: [{ lesson_run_id: "lesson-run:2", raw_mention_id: "mention2" }],
      node_cards: [{ lesson_run_id: "lesson-run:1", raw_card_id: "card1" }],
    },
  );

  assert.deepEqual(lessons, [
    {
      lesson_run_id: "lesson-run:2",
      staged: {
        nodes: [{ lesson_run_id: "lesson-run:2", raw_node_id: "n2" }],
        evidence: [{ lesson_run_id: "lesson-run:2", raw_evidence_id: "ev2" }],
        edges: [],
        domain_profiles: [],
        curriculum_projections: [{ lesson_run_id: "lesson-run:2", raw_projection_id: "projection2" }],
        mentions: [{ lesson_run_id: "lesson-run:2", raw_mention_id: "mention2" }],
        node_cards: [],
      },
    },
    {
      lesson_run_id: "lesson-run:1",
      staged: {
        nodes: [{ lesson_run_id: "lesson-run:1", raw_node_id: "n1" }],
        evidence: [],
        edges: [{ lesson_run_id: "lesson-run:1", raw_edge_id: "edge1" }],
        domain_profiles: [{ lesson_run_id: "lesson-run:1", raw_profile_id: "profile1" }],
        curriculum_projections: [],
        mentions: [],
        node_cards: [{ lesson_run_id: "lesson-run:1", raw_card_id: "card1" }],
      },
    },
  ]);
});

test("builds merge row plan input with canonical candidates", () => {
  const input = buildMergeRowsPlanInput({
    lessonRuns: [{ lesson_run_id: "lesson-run:1" }],
    canonicalNodeRows: [
      {
        id: "concept:auto-water",
        name: "Water",
        kind: "concept",
        aliases_json: ["H2O"],
        properties_json: { semantic_key: "chem:water" },
        embedding: [1, 0],
      },
    ],
    staged: {
      nodes: [{ lesson_run_id: "lesson-run:1", raw_node_id: "raw-water" }],
    },
  });

  assert.equal(input.lessons.length, 1);
  assert.deepEqual(input.lessons[0]?.staged.nodes, [{ lesson_run_id: "lesson-run:1", raw_node_id: "raw-water" }]);
  assert.equal(input.canonicalNodes.length, 1);
  assert.deepEqual([...input.canonicalNodes[0]!.terms], ["water", "h2o"]);
  assert.equal(input.canonicalNodes[0]?.semantic_key, "chem:water");
  assert.deepEqual(input.canonicalNodes[0]?.embedding, [1, 0]);
});

test("requires string lesson_run_id when building staged lesson inputs", () => {
  assert.throws(() => buildStagedLessonInputs([{ lesson_run_id: "" }], {}), /Missing required field 'lesson_run_id'/);
  assert.throws(() => buildStagedLessonInputs([{}], {}), /Missing required field 'lesson_run_id'/);
});

test("indexes existing rows and extracts evidence ids with string keys only", () => {
  assert.deepEqual(indexRowsByStringKey([{ id: "a", value: 1 }, { id: "" }, { id: 3 }, { id: "b", value: 2 }]), {
    a: { id: "a", value: 1 },
    b: { id: "b", value: 2 },
  });
  assert.deepEqual(indexRowsByStringKey([{ node_id: "node:1", card: true }], "node_id"), {
    "node:1": { node_id: "node:1", card: true },
  });
  assert.deepEqual(evidenceIdsFromRows([{ id: "ev1" }, { id: "" }, { id: 4 }, { id: "ev2" }]), ["ev1", "ev2"]);
});
