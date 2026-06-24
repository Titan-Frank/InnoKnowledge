import assert from "node:assert/strict";
import test from "node:test";

import { runStrictQa } from "./strict-qa.js";

const completeRows = {
  nodes: [{ id: "n1", kind: "concept", name: "Water", definition: "A substance", domains_json: ["chemistry"], learning_mode_json: ["conceptual"] }],
  edges: [{ id: "e1", type: "related_to", directionality: "directed", from_id: "n1", to_id: "n1", source_refs_json: ["ev1"] }],
  domain_profiles: [{ id: "p1", node_id: "n1", domain: "chemistry", school_stages_json: ["primary"], curriculum_roles_json: ["core"], source_refs_json: ["ev1"] }],
  mentions: [{ id: "m1", target_id: "n1", source_refs_json: ["ev1"] }],
  evidence: [{ id: "ev1" }],
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

test("reports Python-compatible strict QA errors", () => {
  const result = runStrictQa({
    nodes: [{ id: "n1", kind: "bad-kind", name: "", definition: "", domains_json: ["bad-domain"], learning_mode_json: ["bad-mode"] }],
    edges: [{ id: "e1", type: "bad-edge", directionality: "sideways", from_id: "missing-source", to_id: "missing-target", source_refs_json: ["missing-evidence", ""] }],
    domain_profiles: [{ id: "p1", node_id: "n1", domain: "bad-domain", school_stages_json: ["bad-stage"], curriculum_roles_json: ["bad-role"], source_refs_json: [] }],
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
    { category: "domain_profile", id: "p1", message: "Invalid school stages: ['bad-stage']" },
    { category: "domain_profile", id: "p1", message: "Invalid curriculum roles: ['bad-role']" },
    { category: "domain_profile", id: "p1", message: "Missing evidence source references" },
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
    domain_profiles: [],
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
