import assert from "node:assert/strict";
import test from "node:test";

import { checkLessonStagingQuality } from "./staging-quality.js";
import { buildStagingTableRows } from "./staging-rows.js";
import { normalizeLessonArtifacts } from "./staging.js";

const context = {
  datasetId: "main",
  lessonRunId: "lesson-run:1",
  bookId: "chem-grade8",
  batchAnchor: "struct:chem-grade8:lesson:1-1-1",
  now: "2026-01-02T03:04:05+00:00",
};

test("passes a complete staged lesson quality check", () => {
  const rows = buildStagingTableRows(
    context,
    normalizeLessonArtifacts(
      {
        nodes: [
          {
            id: "n1",
            name: "Water",
            kind: "concept",
            definition: "A substance",
            source_refs: ["ev1"],
          },
        ],
        edges: [{ id: "e1", type: "related_to", from: "n1", to: "n1", source_refs: ["ev1"] }],
        domainProfiles: [{ id: "p1", node_id: "n1", domain: "chemistry", source_refs: ["ev1"] }],
        mentions: [{ id: "m1", target_id: "n1", source_refs: ["ev1"] }],
        evidence: [{ id: "ev1", excerpt: "claim" }],
        nodeCards: [
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
        ],
      },
      context.bookId,
      context.batchAnchor,
    ),
  );

  assert.deepEqual(checkLessonStagingQuality(rows), {
    lesson_run_id: "lesson-run:1",
    status: "success",
    errors: [],
    warnings: [],
    counts: {
      nodes: 1,
      edges: 1,
      domain_profiles: 1,
      mentions: 1,
      evidence: 1,
      node_cards: 1,
    },
  });
});

test("reports Python-compatible staged lesson quality errors and warnings", () => {
  const rows = buildStagingTableRows(
    context,
    normalizeLessonArtifacts(
      {
        nodes: [{ id: "n1", name: "Water", kind: "concept", definition: "A substance" }],
        edges: [{ id: "e1", type: "related_to", from: "n1", to: "missing" }],
        domainProfiles: [{ id: "p1", node_id: "missing-profile-node", domain: "chemistry" }],
        mentions: [{ id: "m1", target_id: "missing-mention-node", source_refs: ["missing-evidence"] }],
        evidence: [{ id: "ev1", excerpt: "claim" }],
        nodeCards: [{ id: "c1", node_id: "missing-card-node", sections: [{ id: "s1", section_type: "definition", content: ["definition"] }] }],
      },
      context.bookId,
      context.batchAnchor,
    ),
  );

  assert.deepEqual(checkLessonStagingQuality(rows), {
    lesson_run_id: "lesson-run:1",
    status: "blocked",
    errors: [
      "Node n1 is missing a domain profile.",
      "Node n1 is missing a node card.",
      "Node n1 is missing a mention.",
      "Node n1 has no evidence-backed source reference.",
      "Edge e1 references missing node endpoint.",
      "Edge e1 has no evidence source_refs.",
      "Domain profile p1 references missing node.",
      "Mention m1 references missing node.",
      "Mention m1 references missing evidence missing-evidence.",
      "Node card c1 references missing node.",
      "Node card c1 is missing summary.",
      "Node card c1 missing sections: ['application', 'essence', 'example', 'key_points', 'misconception'].",
      "Node card c1 section s1 has no evidence source_refs.",
    ],
    warnings: ["Domain profile p1 has no source_refs."],
    counts: {
      nodes: 1,
      edges: 1,
      domain_profiles: 1,
      mentions: 1,
      evidence: 1,
      node_cards: 1,
    },
  });
});

test("reports empty lesson quality errors", () => {
  const rows = buildStagingTableRows(
    context,
    normalizeLessonArtifacts(
      {
        nodes: [],
        edges: [],
        domainProfiles: [],
        mentions: [],
        evidence: [],
        nodeCards: [],
      },
      context.bookId,
      context.batchAnchor,
    ),
  );

  assert.deepEqual(checkLessonStagingQuality(rows).errors, ["Lesson produced no staged nodes.", "Lesson produced no staged evidence."]);
});
