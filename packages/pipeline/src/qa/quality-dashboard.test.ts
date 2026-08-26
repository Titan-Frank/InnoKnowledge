import assert from "node:assert/strict";
import test from "node:test";

import { buildSelectQualityReviewItemsQuery, runQualityDashboardFromDatabase, stringArray } from "./quality-dashboard.js";

test("loads merge review node ids for per-node deduplication", () => {
  const statement = buildSelectQualityReviewItemsQuery("main");
  assert.match(statement.sql, /SELECT lesson_run_id, raw_node_id/);
});

test("reads native and legacy stringified dashboard arrays", () => {
  assert.deepEqual(stringArray(["node-a", " node-b "]), ["node-a", "node-b"]);
  assert.deepEqual(stringArray('["node-a","node-b"]'), ["node-a", "node-b"]);
  assert.deepEqual(stringArray("not-json"), []);
  assert.deepEqual(stringArray('{"node":"a"}'), []);
});

test("preserves legacy stringified issues, warnings, and review node ids", async () => {
  const result = await runQualityDashboardFromDatabase({
    datasetId: "main",
    now: "2026-06-29T00:00:00.000Z",
    query: (statement) => rowsForLegacyStringArrays(statement.name),
  });

  assert.deepEqual(result.lessons[0]?.quality_warnings, [
    "Node n3 requires review.",
    "Node n3 has a second warning.",
  ]);
  assert.deepEqual(result.lessons[0]?.review_node_ids, ["n3", "n4"]);
  assert.deepEqual(result.lessons[1]?.quality_issues, ["Lesson produced no staged edges."]);
});

test("builds lesson and global quality dashboard metrics", async () => {
  const result = await runQualityDashboardFromDatabase({
    datasetId: "main",
    now: "2026-06-29T00:00:00.000Z",
    query: (statement) => rowsFor(statement.name),
  });

  assert.deepEqual(result.read_statements, [
    "select-quality-lesson-runs",
    "select-quality-staging-nodes",
    "select-quality-staging-edges",
    "select-quality-staging-evidence",
    "select-quality-review-items",
    "select-quality-canonical-nodes",
    "select-quality-canonical-edges",
    "select-quality-canonical-evidence",
  ]);
  assert.equal(result.generated_at, "2026-06-29T00:00:00.000Z");
  assert.deepEqual(result.summary, {
    lesson_count: 2,
    node_count: 4,
    relation_count: 1,
    evidence_count: 2,
    evidence_coverage: 0.4,
    isolated_node_count: 2,
    isolated_node_ratio: 0.5,
    disconnected_components: 3,
    image_review_count: 1,
    merge_review_count: 1,
    quality_review_count: 2,
    blocked_lesson_count: 1,
    manual_pending_items: 3,
  });

  const first = result.lessons[0]!;
  assert.equal(first.node_count, 3);
  assert.equal(first.relation_count, 1);
  assert.equal(first.evidence_count, 1);
  assert.equal(first.evidence_coverage, 0.5);
  assert.equal(first.isolated_node_count, 1);
  assert.equal(first.disconnected_components, 2);
  assert.equal(first.image_review_count, 1);
  assert.equal(first.merge_review_count, 1);
  assert.equal(first.quality_review_count, 1);
  assert.equal(first.manual_pending_items, 2);
  assert.deepEqual(first.quality_warnings, ["Node n3 requires review.", "Node n3 has a second warning."]);
  assert.deepEqual(first.review_node_ids, ["n3"]);

  const second = result.lessons[1]!;
  assert.equal(second.status, "blocked");
  assert.equal(second.quality_review_count, 1);
  assert.equal(second.manual_pending_items, 1);
  assert.deepEqual(second.quality_issues, ["Lesson produced no staged edges."]);
});

test("uses canonical image review state after a lesson has been merged", async () => {
  const result = await runQualityDashboardFromDatabase({
    datasetId: "main",
    now: "2026-06-29T00:00:00.000Z",
    query: (statement) => rowsForCanonicalApproved(statement.name),
  });

  assert.equal(result.lessons[0]?.status, "qa_passed");
  assert.equal(result.lessons[0]?.image_review_count, 0);
  assert.equal(result.lessons[0]?.manual_pending_items, 1);
  assert.equal(result.summary.image_review_count, 0);
  assert.equal(result.summary.manual_pending_items, 2);
});

test("excludes synthetic pending evidence from coverage and evidence counts", async () => {
  const result = await runQualityDashboardFromDatabase({
    datasetId: "main",
    now: "2026-06-29T00:00:00.000Z",
    query: (statement) => rowsForSyntheticEvidence(statement.name),
  });

  assert.equal(result.lessons[0]?.evidence_count, 0);
  assert.equal(result.lessons[0]?.evidence_coverage, 0);
  assert.equal(result.summary.evidence_count, 1);
});

function rowsFor(name: string): Array<Record<string, unknown>> {
  switch (name) {
    case "select-quality-lesson-runs":
      return [
        {
          lesson_run_id: "lesson-1",
          book_id: "book-a",
          batch_anchor: "struct:book-a:1",
          status: "qa_passed",
          counts_json: { nodes: 99, edges: 99, evidence: 99 },
          properties_json: {
            quality_warnings: ["Node n3 requires review.", "Node n3 has a second warning."],
            quality_review_required: true,
            review_node_ids: ["n3"],
          },
          updated_at: "2026-06-28T01:00:00Z",
        },
        {
          lesson_run_id: "lesson-2",
          book_id: "book-a",
          batch_anchor: "struct:book-a:2",
          status: "blocked",
          counts_json: { nodes: 1, edges: 0, evidence: 1 },
          properties_json: {
            quality_issues: ["Lesson produced no staged edges."],
            quality_warnings: ["Node m1 requires review."],
            quality_review_required: true,
            review_node_ids: ["m1"],
          },
          updated_at: "2026-06-28T02:00:00Z",
        },
      ];
    case "select-quality-staging-nodes":
      return [
        { lesson_run_id: "lesson-1", raw_node_id: "n1", source_refs_json: ["ev1"], status: "draft" },
        { lesson_run_id: "lesson-1", raw_node_id: "n2", source_refs_json: [], status: "draft" },
        { lesson_run_id: "lesson-1", raw_node_id: "n3", source_refs_json: ["missing"], status: "draft" },
        { lesson_run_id: "lesson-2", raw_node_id: "m1", source_refs_json: [], status: "draft" },
      ];
    case "select-quality-staging-edges":
      return [
        { lesson_run_id: "lesson-1", from_raw_node_id: "n1", to_raw_node_id: "n2", source_refs_json: ["ev1"], status: "draft" },
      ];
    case "select-quality-staging-evidence":
      return [
        {
          lesson_run_id: "lesson-1",
          raw_evidence_id: "ev1",
          modality: "image",
          properties_json: { image_relevance: { relevance: "uncertain" } },
        },
        { lesson_run_id: "lesson-2", raw_evidence_id: "ev2", modality: "text", properties_json: {} },
      ];
    case "select-quality-review-items":
      return [
        { lesson_run_id: "lesson-1", raw_node_id: "n3" },
        { lesson_run_id: "lesson-1", raw_node_id: "n3" },
      ];
    case "select-quality-canonical-nodes":
      return [
        { id: "n1", status: "active" },
        { id: "n2", status: "active" },
        { id: "n3", status: "active" },
        { id: "m1", status: "active" },
      ];
    case "select-quality-canonical-edges":
      return [{ from_id: "n1", to_id: "n2", status: "active" }];
    case "select-quality-canonical-evidence":
      return [
        { source_id: "book-a", anchor_ref: "struct:book-a:1", modality: "image", properties_json: { image_relevance: { review_status: "pending" } } },
        { source_id: "book-a", anchor_ref: "struct:book-a:2", modality: "text", properties_json: {} },
      ];
    default:
      return [];
  }
}

function rowsForSyntheticEvidence(name: string): Array<Record<string, unknown>> {
  if (name === "select-quality-staging-evidence") {
    return rowsFor(name).map((row) => row.raw_evidence_id === "ev1"
      ? { ...row, properties_json: { synthetic: true, quality_excluded: true, review_status: "pending" } }
      : row);
  }
  if (name.startsWith("select-quality-canonical-")) return [];
  return rowsFor(name);
}

function rowsForLegacyStringArrays(name: string): Array<Record<string, unknown>> {
  if (name !== "select-quality-lesson-runs") return rowsFor(name);
  return rowsFor(name).map((row, index) => {
    const properties = row.properties_json as Record<string, unknown>;
    return {
      ...row,
      properties_json: {
        ...properties,
        quality_issues: JSON.stringify(properties.quality_issues ?? []),
        quality_warnings: JSON.stringify(properties.quality_warnings ?? []),
        review_node_ids: index === 0 ? '["n3","n4"]' : JSON.stringify(properties.review_node_ids ?? []),
      },
    };
  });
}

function rowsForCanonicalApproved(name: string): Array<Record<string, unknown>> {
  if (name !== "select-quality-canonical-evidence") return rowsFor(name);
  return [
    {
      source_id: "book-a",
      anchor_ref: "struct:book-a:1",
      modality: "image",
      properties_json: {
        image_relevance: {
          relevance: "core_content",
          review_status: "approved",
        },
      },
    },
    { source_id: "book-a", anchor_ref: "struct:book-a:2", modality: "text", properties_json: {} },
  ];
}
