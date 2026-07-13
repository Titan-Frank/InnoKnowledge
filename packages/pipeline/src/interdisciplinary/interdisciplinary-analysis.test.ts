import assert from "node:assert/strict";
import test from "node:test";

import {
  planInterdisciplinaryAnalysis,
  summarizeInterdisciplinaryGraph,
  type InterdisciplinaryNodeInput,
} from "./interdisciplinary-analysis.js";

function node(input: Partial<InterdisciplinaryNodeInput> & Pick<InterdisciplinaryNodeInput, "id" | "name" | "kind" | "domains">): InterdisciplinaryNodeInput {
  return {
    aliases: [],
    tags: [],
    bridgeTags: [],
    embedding: [],
    evidenceRefs: [],
    ...input,
  };
}

test("finds cross-domain identity candidates without treating them as active same-as edges", () => {
  const plan = planInterdisciplinaryAnalysis([
    node({ id: "physics-energy", name: "能量", kind: "concept", domains: ["physics"], evidenceRefs: ["ev-physics"] }),
    node({ id: "biology-energy", name: "能量", kind: "concept", domains: ["biology"], evidenceRefs: ["ev-biology"] }),
    node({ id: "chem-energy", name: "化学能", kind: "concept", domains: ["chemistry"], aliases: ["能量"] }),
  ], []);

  assert.equal(plan.alignment_candidates, 3);
  assert.equal(plan.relation_candidates, 0);
  assert.ok(plan.candidates.every((candidate) => candidate.candidate_kind === "node_alignment"));
  assert.ok(plan.candidates.every((candidate) => candidate.proposed_edge_type === null));
  assert.ok(plan.candidates.every((candidate) => candidate.rationale.requires_review === true));
});

test("keeps same-domain duplicates out of interdisciplinary review", () => {
  const plan = planInterdisciplinaryAnalysis([
    node({ id: "physics-energy-1", name: "能量", kind: "concept", domains: ["physics"] }),
    node({ id: "physics-energy-2", name: "能量", kind: "concept", domains: ["physics"] }),
  ], []);

  assert.equal(plan.candidates.length, 0);
});

test("creates review-only relation candidates from explicit bridge tags and excludes existing edges", () => {
  const nodes = [
    node({ id: "temperature", name: "温度", kind: "property", domains: ["physics"], bridgeTags: ["energy-transfer"], evidenceRefs: ["ev-1"] }),
    node({ id: "reaction-rate", name: "反应速率", kind: "property", domains: ["chemistry"], bridgeTags: ["energy-transfer"], evidenceRefs: ["ev-2"] }),
  ];
  const plan = planInterdisciplinaryAnalysis(nodes, []);

  assert.equal(plan.relation_candidates, 1);
  assert.equal(plan.candidates[0]?.proposed_edge_type, "related_to");
  assert.equal(plan.candidates[0]?.directionality, "undirected");
  assert.equal(plan.candidates[0]?.rationale.direct_relation_evidence_verified, false);

  const withEdge = planInterdisciplinaryAnalysis(nodes, [{ id: "edge-1", fromId: "temperature", toId: "reaction-rate", type: "affects" }]);
  assert.equal(withEdge.relation_candidates, 0);
});

test("preserves evidence identifier casing in candidates", () => {
  const plan = planInterdisciplinaryAnalysis([
    node({ id: "physics-energy", name: "能量", kind: "concept", domains: ["physics"], evidenceRefs: ["Evidence-Physics-01"] }),
    node({ id: "biology-energy", name: "能量", kind: "concept", domains: ["biology"], evidenceRefs: ["Evidence-Biology-02"] }),
  ], []);

  assert.deepEqual(plan.candidates[0]?.evidence_refs, ["Evidence-Biology-02", "Evidence-Physics-01"]);
});

test("does not replace an approved identity alignment with a relation candidate", () => {
  const nodes = [
    node({ id: "physics-system", name: "系统", kind: "concept", domains: ["physics"], bridgeTags: ["systems"], evidenceRefs: ["ev-1"] }),
    node({ id: "biology-system", name: "系统", kind: "concept", domains: ["biology"], bridgeTags: ["systems"], evidenceRefs: ["ev-2"] }),
  ];
  const initial = planInterdisciplinaryAnalysis(nodes, []);
  const alignment = initial.candidates.find((candidate) => candidate.candidate_kind === "node_alignment");
  assert.ok(alignment);

  const rescanned = planInterdisciplinaryAnalysis(nodes, [], {
    excludedCandidateIds: [alignment.candidate_id],
    blockedRelationNodePairs: [["physics-system", "biology-system"]],
  });
  assert.equal(rescanned.candidates.length, 0);
});

test("summarizes shared bridge nodes and strict cross-domain edges", () => {
  const nodes = [
    node({ id: "energy", name: "能量", kind: "concept", domains: ["physics", "chemistry"], evidenceRefs: ["ev-1", "ev-2"] }),
    node({ id: "force", name: "力", kind: "concept", domains: ["physics"] }),
    node({ id: "reaction", name: "反应", kind: "process", domains: ["chemistry"] }),
  ];
  const summary = summarizeInterdisciplinaryGraph(nodes, [
    { id: "edge-a", fromId: "force", toId: "reaction", type: "affects" },
    { id: "edge-b", fromId: "energy", toId: "force", type: "related_to" },
  ]);

  assert.equal(summary.domain_count, 2);
  assert.equal(summary.bridge_node_count, 1);
  assert.equal(summary.cross_domain_edge_count, 1);
  assert.deepEqual(summary.bridge_nodes[0], {
    node_id: "energy",
    name: "能量",
    kind: "concept",
    domains: ["chemistry", "physics"],
    degree: 1,
    evidence_count: 2,
  });
  assert.deepEqual(summary.domain_pairs, [{
    source_domain: "chemistry",
    target_domain: "physics",
    shared_node_count: 1,
    cross_domain_edge_count: 1,
  }]);
});

test("honors domain filters, exclusions, and candidate limits", () => {
  const nodes = [
    node({ id: "a", name: "系统", kind: "concept", domains: ["physics"] }),
    node({ id: "b", name: "系统", kind: "concept", domains: ["biology"] }),
    node({ id: "c", name: "系统", kind: "concept", domains: ["chemistry"] }),
  ];
  const first = planInterdisciplinaryAnalysis(nodes, [], { domains: ["physics", "biology"], maximumCandidates: 1 });
  assert.equal(first.candidates.length, 1);

  const excluded = planInterdisciplinaryAnalysis(nodes, [], { excludedCandidateIds: [first.candidates[0]!.candidate_id] });
  assert.equal(excluded.candidates.length, 2);
  assert.ok(excluded.candidates.every((candidate) => candidate.candidate_id !== first.candidates[0]!.candidate_id));
});
