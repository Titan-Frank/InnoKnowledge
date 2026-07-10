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
    quality_review_required: false,
    review_node_ids: [],
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
    quality_review_required: true,
    review_node_ids: ["missing-profile-node"],
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

test("allows only an explicit empty no_knowledge lesson", () => {
  const artifacts = normalizeLessonArtifacts(
    { nodes: [], edges: [], domainProfiles: [], mentions: [], evidence: [], nodeCards: [] },
    context.bookId,
    context.batchAnchor,
  );
  const valid = checkLessonStagingQuality(buildStagingTableRows({
    ...context,
    lessonDisposition: "no_knowledge",
    noKnowledgeReason: "当前课时只有目录导航，没有可抽取的知识对象。",
  }, artifacts));
  assert.equal(valid.status, "success");
  assert.deepEqual(valid.errors, []);

  const missingReason = checkLessonStagingQuality(buildStagingTableRows({
    ...context,
    lessonDisposition: "no_knowledge",
  }, artifacts));
  assert.deepEqual(missingReason.errors, ["Lesson marked no_knowledge is missing no_knowledge_reason."]);

  const inconsistentArtifacts = normalizeLessonArtifacts(
    { nodes: [], edges: [], domainProfiles: [], mentions: [], evidence: [{ id: "ev1", excerpt: "unexpected" }], nodeCards: [] },
    context.bookId,
    context.batchAnchor,
  );
  const inconsistent = checkLessonStagingQuality(buildStagingTableRows({
    ...context,
    lessonDisposition: "no_knowledge",
    noKnowledgeReason: "当前课时没有知识对象。",
  }, inconsistentArtifacts));
  assert.deepEqual(inconsistent.errors, ["Lesson marked no_knowledge must have no staged knowledge artifacts."]);
});

test("excludes synthetic pending evidence from quality support", () => {
  const rows = buildStagingTableRows(
    context,
    normalizeLessonArtifacts(
      {
        nodes: [{ id: "n1", name: "Water", kind: "concept", definition: "A substance", source_refs: ["ev1"] }],
        edges: [{ id: "e1", type: "related_to", from: "n1", to: "n1", source_refs: ["ev1"] }],
        domainProfiles: [{ id: "p1", node_id: "n1", domain: "chemistry", source_refs: ["ev1"] }],
        mentions: [{ id: "m1", target_id: "n1", source_refs: ["ev1"] }],
        evidence: [{ id: "ev1", excerpt: "synthetic", properties: { synthetic: true, quality_excluded: true, review_status: "pending" } }],
        nodeCards: [{
          id: "c1",
          node_id: "n1",
          summary: "Water summary",
          sections: ["definition", "essence", "key_points", "example", "application", "misconception"].map((section_type) => ({
            id: section_type,
            section_type,
            content: ["content"],
            source_refs: ["ev1"],
          })),
        }],
      },
      context.bookId,
      context.batchAnchor,
    ),
  );

  const result = checkLessonStagingQuality(rows);
  assert.equal(result.status, "blocked");
  assert.ok(result.errors.includes("Node n1 has no evidence-backed source reference."));
  assert.ok(result.errors.includes("Mention m1 references quality-excluded evidence ev1."));
  assert.ok(result.warnings.includes("Evidence ev1 is synthetic or quality-excluded and requires review."));
  assert.equal(result.quality_review_required, true);
  assert.deepEqual(result.review_node_ids, ["n1"]);
});

test("reports node admission policy warnings without blocking", () => {
  const rows = buildStagingTableRows(
    context,
    normalizeLessonArtifacts(
      {
        nodes: [
          {
            id: "n1",
            name: "第1章",
            kind: "concept",
            definition: "A structural textbook heading",
            source_refs: ["ev1"],
          },
          {
            id: "n2",
            name: "考点一",
            kind: "concept",
            definition: "An assessment label",
            source_refs: ["ev1"],
          },
          {
            id: "n3",
            name: "质量守恒定律",
            kind: "rule",
            definition: "A chemistry rule",
            source_refs: ["ev1"],
          },
        ],
        edges: [{ id: "e1", type: "related_to", from: "n1", to: "n2", source_refs: ["ev1"] }],
        domainProfiles: [
          { id: "p1", node_id: "n1", domain: "chemistry", source_refs: ["ev1"] },
          { id: "p2", node_id: "n2", domain: "chemistry", source_refs: ["ev1"] },
          { id: "p3", node_id: "n3", domain: "chemistry", source_refs: ["ev1"] },
        ],
        mentions: [
          { id: "m1", target_id: "n1", source_refs: ["ev1"] },
          { id: "m2", target_id: "n2", source_refs: ["ev1"] },
          { id: "m3", target_id: "n3", source_refs: ["ev1"] },
        ],
        evidence: [{ id: "ev1", excerpt: "claim" }],
        nodeCards: ["n1", "n2", "n3"].map((node_id) => ({
          id: `c:${node_id}`,
          node_id,
          summary: `${node_id} summary`,
          sections: ["definition", "essence", "key_points", "example", "application", "misconception"].map((section_type) => ({
            id: `${node_id}:${section_type}`,
            section_type,
            content: ["content"],
            source_refs: ["ev1"],
          })),
        })),
      },
      context.bookId,
      context.batchAnchor,
    ),
  );

  const result = checkLessonStagingQuality(rows);

  assert.equal(result.status, "success");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, [
    "Node n1 looks like a directory heading or textbook column; review node admission policy.",
    "Node n2 looks like an assessment label rather than a knowledge object; review node admission policy.",
    "Node n3 has no staged relations; review relation potential before activation.",
  ]);
  assert.equal(result.quality_review_required, true);
  assert.deepEqual(result.review_node_ids, ["n1", "n2", "n3"]);
});
