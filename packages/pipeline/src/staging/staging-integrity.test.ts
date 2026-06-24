import assert from "node:assert/strict";
import test from "node:test";

import { checkStagingIntegrity } from "./staging-integrity.js";
import { buildStagingTableRows } from "./staging-rows.js";
import { normalizeLessonArtifacts } from "./staging.js";

const context = {
  datasetId: "main",
  lessonRunId: "lesson-run:1",
  bookId: "chem-grade8",
  batchAnchor: "struct:chem-grade8:lesson:1-1-1",
  now: "2026-01-02T03:04:05+00:00",
};

test("passes when staging rows reference existing nodes", () => {
  const rows = buildStagingTableRows(
    context,
    normalizeLessonArtifacts(
      {
        nodes: [
          { id: "n1", name: "Water", kind: "concept", definition: "A substance" },
          { id: "n2", name: "Matter", kind: "concept", definition: "Something with mass" },
        ],
        edges: [{ id: "e1", type: "related_to", from: "n1", to: "n2" }],
        domainProfiles: [{ id: "p1", node_id: "n1", domain: "chemistry" }],
        mentions: [],
        evidence: [],
        nodeCards: [{ id: "c1", node_id: "n2" }],
      },
      context.bookId,
      context.batchAnchor,
    ),
  );

  assert.deepEqual(checkStagingIntegrity(rows), {
    valid: true,
    checks: [{ name: "references", ok: true }],
    issues: [],
  });
});

test("reports Python-compatible reference integrity issues", () => {
  const rows = buildStagingTableRows(
    context,
    normalizeLessonArtifacts(
      {
        nodes: [{ id: "n1", name: "Water", kind: "concept", definition: "A substance" }],
        edges: [{ id: "e1", type: "related_to", from: "n1", to: "missing-edge-target" }],
        domainProfiles: [{ id: "p1", node_id: "missing-profile-node", domain: "chemistry" }],
        mentions: [{ id: "m1", target_id: "missing-mention-target" }],
        evidence: [{ id: "ev1", excerpt: "claim" }],
        nodeCards: [{ id: "c1", node_id: "missing-card-node" }],
      },
      context.bookId,
      context.batchAnchor,
    ),
  );

  assert.deepEqual(checkStagingIntegrity(rows), {
    valid: false,
    checks: [{ name: "references", ok: false }],
    issues: [
      "Domain profile p1 references missing node missing-profile-node.",
      "Edge e1 references missing node endpoint.",
      "Node card c1 references missing node missing-card-node.",
    ],
  });
});
