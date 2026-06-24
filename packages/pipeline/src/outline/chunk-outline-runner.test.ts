import assert from "node:assert/strict";
import test from "node:test";

import { runChunkOutline } from "./chunk-outline-runner.js";

test("plans chunk outline with Python-compatible output shape", () => {
  const output = runChunkOutline({
    itemsJson: JSON.stringify([
      { id: "topic-1", kind: "topic" },
      {
        id: "struct:chem-grade8:lesson:1-1",
        kind: "lesson",
        parent_id: "topic-1",
        label: "第1节",
        title: "水",
        md_start: 1,
        md_end: 80,
        order_path: "1.1",
      },
    ]),
    maxLines: 300,
  });

  assert.equal(output.status, "success");
  assert.deepEqual(output.stats, { split: 0, merged: 0, normal: 1, review_skipped: 0 });
  assert.deepEqual(output.size_summary, { min: 80, max: 80, avg: 80 });
  assert.equal(output.chunks[0]?.id, "struct:chem-grade8:chunk:1-1-a");
});

test("validates chunk outline JSON input", () => {
  assert.throws(() => runChunkOutline({ itemsJson: "{}" }), /Invalid items-json: expected a JSON array of objects/);
  assert.throws(
    () =>
      runChunkOutline({
        itemsJson: "[]",
        headingsJson: JSON.stringify([{ line: "1", text: "标题" }]),
      }),
    /Invalid headings-json: row is missing numeric field 'line'/,
  );
});

test("plans from outline JSON and can include the appended outline", () => {
  const output = runChunkOutline({
    outlineJson: JSON.stringify({
      book_id: "chem-grade8",
      source_path: "data/markdown/chem.md",
      items: [
        { id: "topic-1", kind: "topic" },
        {
          id: "struct:chem-grade8:lesson:1-1",
          kind: "lesson",
          parent_id: "topic-1",
          label: "第1节",
          title: "水",
          md_start: 1,
          md_end: 80,
          order_path: "1.1",
        },
      ],
    }),
    includeOutline: true,
  });

  assert.equal(output.chunks.length, 1);
  assert.equal(output.outline?.book_id, "chem-grade8");
  assert.deepEqual(output.outline?.items.map((item) => item.id), ["topic-1", "struct:chem-grade8:lesson:1-1", "struct:chem-grade8:chunk:1-1-a"]);
});

test("validates outline JSON input", () => {
  assert.throws(() => runChunkOutline({ outlineJson: "[]" }), /Invalid outline-json: expected a JSON object/);
  assert.throws(() => runChunkOutline({ outlineJson: "{}" }), /Invalid outline-json: expected field 'items'/);
});
