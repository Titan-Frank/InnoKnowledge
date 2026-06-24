import assert from "node:assert/strict";
import test from "node:test";

import { runStoreStaging } from "./staging-store.js";
import type { SqlStatement } from "./staging-sql.js";

const baseInput = {
  root: "/tmp/main",
  bookId: "chem-grade8",
  batchAnchor: "struct:chem-grade8:lesson:1-1-1",
  datasetId: "main",
  resolveOutline: false,
  nodesJson: JSON.stringify([{ id: "n1", name: "Water", kind: "concept", definition: "A substance", source_refs: ["ev1"] }]),
  edgesJson: JSON.stringify([{ id: "e1", type: "related_to", from: "n1", to: "n1", source_refs: ["ev1"] }]),
  domainProfilesJson: JSON.stringify([{ id: "p1", node_id: "n1", domain: "chemistry", source_refs: ["ev1"] }]),
  mentionsJson: JSON.stringify([{ id: "m1", target_id: "n1", source_refs: ["ev1"] }]),
  evidenceJson: JSON.stringify([{ id: "ev1", excerpt: "claim" }]),
  nodeCardsJson: JSON.stringify([
    {
      id: "c1",
      node_id: "n1",
      summary: "Water summary",
      sections: ["definition", "essence", "key_points", "example", "application", "misconception"].map((section_type) => ({
        id: section_type,
        section_type,
        content: ["content"],
        source_refs: ["ev1"],
      })),
    },
  ]),
  now: "2026-01-02T03:04:05+00:00",
};

test("writes store staging with Python-compatible output shape", async () => {
  const executed: SqlStatement[] = [];
  const output = await runStoreStaging({
    ...baseInput,
    executeStatement: (statement) => {
      executed.push(statement);
    },
  });

  assert.equal(output.status, "success");
  assert.equal(output.dataset_id, "main");
  assert.equal(output.lesson_run_id, "lesson-run:515c00b1d466");
  assert.deepEqual(output.counts, {
    nodes: 1,
    edges: 1,
    domain_profiles: 1,
    mentions: 1,
    evidence: 1,
    node_cards: 1,
  });
  assert.deepEqual(output.issues, []);
  assert.equal(output.quality.status, "success");
  assert.deepEqual(output.quality.errors, []);
  assert.deepEqual(output.quality.warnings, []);
  assert.equal(output.statements[0], "upsert-world-lesson-run");
  assert.ok(output.statements.includes("insert-world-staging-nodes"));
  assert.deepEqual(output.statements, executed.map((statement) => statement.name));
});

test("returns blocked output before writing when integrity fails", async () => {
  const executed: SqlStatement[] = [];
  const output = await runStoreStaging({
    ...baseInput,
    edgesJson: JSON.stringify([{ id: "e1", type: "related_to", from: "n1", to: "missing" }]),
    domainProfilesJson: JSON.stringify([{ id: "p1", node_id: "missing-profile", domain: "chemistry" }]),
    nodeCardsJson: JSON.stringify([{ id: "c1", node_id: "missing-card" }]),
    executeStatement: (statement) => {
      executed.push(statement);
    },
  });

  assert.equal(output.status, "blocked");
  assert.deepEqual(output.statements, []);
  assert.deepEqual(executed, []);
  assert.deepEqual(output.issues, [
    "Domain profile p1 references missing node missing-profile.",
    "Edge e1 references missing node endpoint.",
    "Node card c1 references missing node missing-card.",
  ]);
  assert.equal(output.quality.status, "blocked");
  assert.ok(output.quality.errors.includes("Edge e1 references missing node endpoint."));
});

test("executes store staging statements in plan order", async () => {
  const executed: SqlStatement[] = [];
  const output = await runStoreStaging({
    ...baseInput,
    executeStatement: (statement) => {
      executed.push(statement);
    },
  });

  assert.equal(output.status, "success");
  assert.deepEqual(output.statements, executed.map((statement) => statement.name));
  assert.deepEqual(output.statements.slice(0, 7), [
    "upsert-world-lesson-run",
    "delete-world_staging_nodes",
    "delete-world_staging_edges",
    "delete-world_staging_domain_profiles",
    "delete-world_staging_mentions",
    "delete-world_staging_evidence",
    "delete-world_staging_node_cards",
  ]);
  assert.ok(output.statements.includes("insert-world-staging-nodes"));
});

test("writes staging rows while surfacing quality failures for the later quality gate", async () => {
  const executed: SqlStatement[] = [];
  const output = await runStoreStaging({
    ...baseInput,
    nodesJson: JSON.stringify([{ id: "n1", name: "Water", kind: "concept", definition: "A substance" }]),
    edgesJson: JSON.stringify([{ id: "e1", type: "related_to", from: "n1", to: "n1" }]),
    domainProfilesJson: JSON.stringify([{ id: "p1", node_id: "n1", domain: "chemistry" }]),
    mentionsJson: JSON.stringify([{ id: "m1", target_id: "n1" }]),
    nodeCardsJson: JSON.stringify([{ id: "c1", node_id: "n1" }]),
    executeStatement: (statement) => {
      executed.push(statement);
    },
  });

  assert.equal(output.status, "success");
  assert.ok(executed.length > 0);
  assert.deepEqual(output.issues, []);
  assert.equal(output.quality.status, "blocked");
  assert.ok(output.quality.errors.includes("Node n1 has no evidence-backed source reference."));
  assert.ok(output.quality.errors.includes("Edge e1 has no evidence source_refs."));
  assert.ok(output.quality.errors.includes("Node card c1 is missing summary."));
  assert.deepEqual(output.quality.warnings, ["Domain profile p1 has no source_refs."]);
});
