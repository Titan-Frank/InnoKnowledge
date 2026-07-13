import assert from "node:assert/strict";
import test from "node:test";

import { runStrictQa } from "./strict-qa.js";

const completeRows = {
  nodes: [{ id: "n1", kind: "concept", name: "Water", definition: "A substance", domains_json: ["chemistry"], learning_mode_json: ["conceptual"] }],
  edges: [{ id: "e1", type: "related_to", directionality: "directed", from_id: "n1", to_id: "n1", source_refs_json: ["ev1"] }],
  domain_schemas: [{ schema_id: "domain:chemistry:v1", domain: "chemistry", schema_version: "1.0", roles_json: ["substance"] }],
  domain_profiles: [{ id: "p1", node_id: "n1", domain: "chemistry", schema_id: "domain:chemistry:v1", schema_version: "1.0", domain_role: "substance", source_refs_json: ["ev1"] }],
  curriculum_projections: [{ id: "cp1", node_id: "n1", domain: "chemistry", curriculum_id: "cn-basic-education", school_stage: "primary", grade_band: "grade-5", curriculum_roles_json: ["core"], source_refs_json: ["ev1"] }],
  mentions: [{ id: "m1", target_id: "n1", source_refs_json: ["ev1"] }],
  evidence: [{ id: "ev1" }],
  node_bodies: [
    {
      node_id: "n1",
      format: "markdown",
      content: "Body content.",
      media_refs_json: [],
      source_refs_json: ["ev1"],
      generated_from: "card_expansion",
      status: "active",
    },
  ],
  node_cards: [
    {
      node_id: "n1",
      summary: "Summary",
      source_refs_json: ["ev1"],
      sections_json: ["definition", "essence", "key_points", "example", "application", "misconception"].map((section_type) => ({
        id: section_type,
        section_type,
        source_refs: ["ev1"],
      })),
    },
  ],
};

test("passes complete strict QA rows", () => {
  assert.deepEqual(runStrictQa(completeRows), {
    status: "success",
    errors: [],
    warnings: [],
  });
});

test("validates persisted node bodies when present", () => {
  const result = runStrictQa({
    ...completeRows,
    node_bodies: [
      {
        node_id: "n1",
        format: "html",
        content: "",
        media_refs_json: [],
        source_refs_json: [],
        generated_from: "bad-source",
        status: "active",
      },
      {
        node_id: "missing",
        format: "markdown",
        content: "![diagram](images/water.png)",
        media_refs_json: [],
        source_refs_json: ["missing-evidence"],
        generated_from: "manual",
        status: "active",
      },
    ],
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.errors, [
    { category: "node_body", id: "n1", message: "Invalid body format: html" },
    { category: "node_body", id: "n1", message: "Missing body content" },
    { category: "node_body", id: "n1", message: "Invalid generated_from: bad-source" },
    { category: "node_body", id: "n1", message: "Missing evidence source references" },
    { category: "node_body", id: "missing", message: "Missing node" },
    { category: "node_body", id: "missing", message: "Missing evidence missing-evidence" },
    { category: "node_body", id: "missing", message: "Missing media ref for image images/water.png" },
  ]);
});

test("validates generated pedagogical profiles by school stage", () => {
  const valid = runStrictQa({
    ...completeRows,
    curriculum_projections: [{
      ...completeRows.curriculum_projections[0],
      properties_json: {
        pedagogical_profile: {
          school_stage: "primary",
          learning_objectives: ["能够说明水的基本特征。"],
          difficulty_level: "basic",
          diagnostic_questions: ["水有哪些可观察特征？"],
          common_errors: ["把所有透明液体都判断为水。"],
          assessment_tasks: ["根据证据判断样品是否为水。"],
          remediation_suggestions: ["回到定义逐项核对。"],
          extension_suggestions: ["比较水在不同过程中的作用。"],
          generation: {
            generated_from: "model_generation",
            model: "test-model",
            prompt_version: "pedagogical-profile-v1",
            generated_at: "now",
            input_fingerprint: "hash",
            review_status: "pending",
            confidence: 0.8,
            source_refs: ["ev1"],
          },
        },
      },
    }],
  });
  assert.equal(valid.status, "success");

  const invalid = runStrictQa({
    ...completeRows,
    curriculum_projections: [{
      ...completeRows.curriculum_projections[0],
      properties_json: {
        pedagogical_profile: {
          school_stage: "senior-secondary",
          learning_objectives: [],
          difficulty_level: "impossible",
          diagnostic_questions: [],
          common_errors: [],
          assessment_tasks: [],
          remediation_suggestions: [],
          extension_suggestions: [],
          generation: {
            generated_from: "model_generation",
            review_status: "unknown",
            confidence: 2,
            source_refs: ["missing-evidence"],
          },
        },
      },
    }],
  });
  assert.equal(invalid.status, "blocked");
  assert.ok(invalid.errors.some((item) => item.message === "school_stage must match its curriculum projection"));
  assert.ok(invalid.errors.some((item) => item.message === "Invalid difficulty level: impossible"));
  assert.ok(invalid.errors.some((item) => item.message === "assessment_tasks must contain non-empty strings"));
  assert.ok(invalid.errors.some((item) => item.message === "Invalid review_status: unknown"));
  assert.ok(invalid.errors.some((item) => item.message === "Generation confidence must be between 0 and 1"));
  assert.ok(invalid.errors.some((item) => item.message === "Missing evidence missing-evidence"));
});

test("reports Python-compatible strict QA errors", () => {
  const result = runStrictQa({
    nodes: [{ id: "n1", kind: "bad-kind", name: "", definition: "", domains_json: ["bad-domain"], learning_mode_json: ["bad-mode"] }],
    edges: [{ id: "e1", type: "bad-edge", directionality: "sideways", from_id: "missing-source", to_id: "missing-target", source_refs_json: ["missing-evidence", ""] }],
    domain_schemas: [{ schema_id: "domain:general:v1", domain: "general", schema_version: "1.0", roles_json: ["knowledge_object"] }],
    domain_profiles: [{ id: "p1", node_id: "n1", domain: "bad-domain", schema_id: "missing-schema", schema_version: "9.9", domain_role: "bad-role", source_refs_json: [] }],
    curriculum_projections: [{ id: "cp1", node_id: "missing-node", domain: "bad-domain", curriculum_id: "", school_stage: "bad-stage", curriculum_roles_json: ["bad-role"], source_refs_json: [] }],
    mentions: [{ id: "m1", target_id: "n1", source_refs_json: ["missing-evidence"] }],
    evidence: [{ id: "ev1" }],
    node_cards: [{ node_id: "n1", summary: "", source_refs_json: [], sections_json: [{ id: "definition", section_type: "definition", source_refs: [] }] }],
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.errors, [
    { category: "node", id: "n1", message: "Invalid kind: bad-kind" },
    { category: "node", id: "n1", message: "Missing name or definition" },
    { category: "node", id: "n1", message: "Invalid domains: ['bad-domain']" },
    { category: "node", id: "n1", message: "Invalid learning modes: ['bad-mode']" },
    { category: "edge", id: "e1", message: "Invalid edge type: bad-edge" },
    { category: "edge", id: "e1", message: "Invalid directionality: sideways" },
    { category: "edge", id: "e1", message: "Missing evidence missing-evidence" },
    { category: "edge", id: "e1", message: "Invalid empty evidence reference" },
    { category: "edge", id: "e1", message: "Missing source node" },
    { category: "edge", id: "e1", message: "Missing target node" },
    { category: "domain_profile", id: "p1", message: "Invalid domain: bad-domain" },
    { category: "domain_profile", id: "p1", message: "Missing domain schema: missing-schema" },
    { category: "domain_profile", id: "p1", message: "Missing evidence source references" },
    { category: "curriculum_projection", id: "cp1", message: "Missing node" },
    { category: "curriculum_projection", id: "cp1", message: "Invalid domain: bad-domain" },
    { category: "curriculum_projection", id: "cp1", message: "Missing curriculum id" },
    { category: "curriculum_projection", id: "cp1", message: "Invalid school stage: bad-stage" },
    { category: "curriculum_projection", id: "cp1", message: "Invalid curriculum roles: ['bad-role']" },
    { category: "curriculum_projection", id: "cp1", message: "Missing evidence source references" },
    { category: "mention", id: "m1", message: "Missing evidence missing-evidence" },
    { category: "node_card", id: "n1", message: "Missing summary" },
    { category: "node_card", id: "n1", message: "Missing evidence source references" },
    { category: "node_card", id: "n1", message: "Missing required sections: ['application', 'essence', 'example', 'key_points', 'misconception']" },
    { category: "node_card_section", id: "n1:definition", message: "Missing evidence source references" },
  ]);
  assert.deepEqual(result.warnings, []);
});

test("reports missing node support rows", () => {
  const result = runStrictQa({
    nodes: [{ id: "n1", kind: "concept", name: "Water", definition: "A substance", domains_json: ["chemistry"], learning_mode_json: ["conceptual"] }],
    edges: [],
    domain_schemas: [],
    domain_profiles: [],
    curriculum_projections: [],
    mentions: [],
    evidence: [],
    node_cards: [],
  });

  assert.deepEqual(result.errors, [
    { category: "node_card", id: "n1", message: "Missing node card" },
    { category: "mention", id: "n1", message: "Missing mention" },
    { category: "domain_profile", id: "n1", message: "Missing domain profile" },
  ]);
});
