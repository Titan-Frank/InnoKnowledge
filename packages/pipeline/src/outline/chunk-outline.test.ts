import assert from "node:assert/strict";
import test from "node:test";

import {
  appendChunkItems,
  isExcludedItem,
  makeChunk,
  makeMergedChunk,
  makeSingleChunk,
  mdSpan,
  mergeUndersized,
  pageSpan,
  parseHeadings,
  planChunkOutline,
  splitOversized,
  topicIdFor,
} from "./chunk-outline.js";

test("computes markdown and page spans like Python chunk_outline", () => {
  assert.equal(mdSpan({ md_start: 3, md_end: 7 }), 5);
  assert.equal(mdSpan({ md_start: "3", md_end: "7" }), 5);
  assert.equal(mdSpan({ md_start: null, md_end: 7 }), 0);
  assert.equal(pageSpan({ page_start: "10", page_end: "12" }), 3);
  assert.equal(pageSpan({ page_start: "bad", page_end: "12" }), 0);
});

test("finds topic parent id like Python topic_id_for", () => {
  const items = [
    { id: "topic-1", kind: "topic" },
    { id: "lesson-1", kind: "lesson", parent_id: "topic-1" },
    { id: "activity-1", kind: "activity", parent_id: "lesson-1" },
    { id: "orphan", kind: "lesson", parent_id: "missing-topic" },
  ];

  assert.equal(topicIdFor(items[0]!, items), "topic-1");
  assert.equal(topicIdFor(items[1]!, items), "topic-1");
  assert.equal(topicIdFor(items[2]!, items), "topic-1");
  assert.equal(topicIdFor(items[3]!, items), "missing-topic");
  assert.equal(topicIdFor({ id: "chapter", kind: "chapter" }, items), null);
});

test("parses markdown headings like Python parse_headings", () => {
  assert.deepEqual(parseHeadings(["# 第一节\n", "text", "###  子标题  ", "####No space"]), [
    { line: 1, text: "第一节" },
    { line: 3, text: "子标题" },
  ]);
});

test("only excludes non-content outline items", () => {
  assert.equal(isExcludedItem({ title: "本章小结" }), false);
  assert.equal(isExcludedItem({ title: "Wireshark 实验" }), false);
  assert.equal(isExcludedItem({ title: "参考文献" }), true);
  assert.equal(isExcludedItem({ title: "物质的变化" }), false);
});

test("merges undersized items like Python merge_undersized", () => {
  const items = [
    { id: "lesson-short", kind: "lesson", md_start: 1, md_end: 80 },
    { id: "activity-a", kind: "activity", md_start: 81, md_end: 120 },
    { id: "lesson-tiny", kind: "lesson", md_start: 121, md_end: 200 },
    { id: "lesson-normal", kind: "lesson", md_start: 201, md_end: 380 },
    { id: "activity-b", kind: "activity", md_start: 381, md_end: 430 },
  ];

  assert.deepEqual(
    mergeUndersized(items, 150, 300).map((group) => group.map((item) => item.id)),
    [["lesson-short", "activity-a", "lesson-tiny"], ["lesson-normal", "activity-b"]],
  );
});

test("keeps activity standalone when previous group cannot accept it", () => {
  const items = [
    { id: "lesson-large", kind: "lesson", md_start: 1, md_end: 290 },
    { id: "activity", kind: "activity", md_start: 291, md_end: 340 },
  ];

  assert.deepEqual(
    mergeUndersized(items, 150, 300).map((group) => group.map((item) => item.id)),
    [["lesson-large"], ["activity"]],
  );
});

test("makes single chunk like Python _make_single_chunk", () => {
  assert.deepEqual(
    makeSingleChunk({
      id: "struct:chem-grade8:lesson:1-1",
      label: "第1节",
      title: "水",
      page_start: 10,
      page_end: 12,
      md_start: 100,
      md_end: 160,
      order_path: "1.1",
    }),
    {
      id: "struct:chem-grade8:chunk:1-1-a",
      kind: "chunk",
      label: "第1节 (上)",
      title: "水",
      page_start: 10,
      page_end: 12,
      md_start: 100,
      md_end: 160,
      level: 4,
      order_path: "1.1-a",
      parent_id: "struct:chem-grade8:lesson:1-1",
      source_ids: ["struct:chem-grade8:lesson:1-1"],
      raw_line: "",
      content_role: "knowledge",
    },
  );
});

test("returns a single chunk for non-oversized or unsplittable items", () => {
  const item = {
    id: "struct:chem-grade8:lesson:1-1",
    label: "第1节",
    title: "水",
    md_start: 1,
    md_end: 100,
    order_path: "1.1",
  };

  assert.equal(splitOversized(item, [], 250, 300).length, 1);
  assert.equal(splitOversized({ ...item, md_end: 400 }, [], 250, 300).length, 1);
});

test("splits oversized item at logical heading sections", () => {
  const chunks = splitOversized(
    {
      id: "struct:chem-grade8:lesson:1-1",
      label: "第1节",
      title: "水",
      page_start: 10,
      page_end: 20,
      md_start: 1,
      md_end: 500,
      order_path: "1.1",
    },
    [
      { line: 1, text: "引入" },
      { line: 120, text: "性质" },
      { line: 260, text: "实验" },
      { line: 420, text: "总结" },
    ],
    200,
    300,
  );

  assert.deepEqual(
    chunks.map((chunk) => ({ id: chunk.id, title: chunk.title, md_start: chunk.md_start, md_end: chunk.md_end })),
    [
      { id: "struct:chem-grade8:chunk:1-1-a", title: "水 — 引入", md_start: 1, md_end: 259 },
      { id: "struct:chem-grade8:chunk:1-1-b", title: "水 — 实验", md_start: 260, md_end: 500 },
    ],
  );
});

test("makes split chunk with title parts and interpolated pages", () => {
  assert.deepEqual(
    makeChunk(
      {
        id: "struct:chem-grade8:lesson:1-1",
        label: "第1节",
        title: "水",
        page_start: 10,
        page_end: 20,
        md_start: 100,
        md_end: 200,
        order_path: "1.1",
      },
      125,
      175,
      "b",
      ["性质", "实验"],
    ),
    {
      id: "struct:chem-grade8:chunk:1-1-b",
      kind: "chunk",
      label: "第1节 (中)",
      title: "水 — 性质 — 实验",
      page_start: 13,
      page_end: 18,
      md_start: 125,
      md_end: 175,
      level: 4,
      order_path: "1.1-b",
      parent_id: "struct:chem-grade8:lesson:1-1",
      source_ids: ["struct:chem-grade8:lesson:1-1"],
      raw_line: "",
      content_role: "knowledge",
    },
  );
});

test("classifies an exercise subsection as assessment even when its parent lesson is knowledge", () => {
  const chunks = splitOversized(
    {
      id: "struct:math-grade7:lesson:1-1",
      kind: "lesson",
      label: "第1节",
      title: "有理数",
      md_start: 1,
      md_end: 240,
      order_path: "1.1",
    },
    [
      { line: 1, text: "有理数" },
      { line: 181, text: "练习" },
    ],
    250,
    300,
  );

  assert.deepEqual(
    chunks.map((chunk) => [chunk.title, chunk.md_start, chunk.md_end, chunk.content_role]),
    [
      ["有理数", 1, 180, "knowledge"],
      ["有理数 — 练习", 181, 240, "assessment"],
    ],
  );
});

test("makes merged chunk like Python _make_merged_chunk", () => {
  assert.deepEqual(
    makeMergedChunk(
      [
        { id: "struct:chem-grade8:lesson:1-1", label: "第1节", title: "水", page_start: 10, md_start: 100, order_path: "1.1" },
        { id: "struct:chem-grade8:activity:1-2", label: "活动", title: "实验", page_end: 15, md_end: 180 },
      ],
      "d",
    ),
    {
      id: "struct:chem-grade8:chunk:1-1-d",
      kind: "chunk",
      label: "第1节 + 活动",
      title: "水 & 实验",
      page_start: 10,
      page_end: 15,
      md_start: 100,
      md_end: 180,
      level: 4,
      order_path: "1.1-d",
      parent_id: "struct:chem-grade8:lesson:1-1",
      source_ids: ["struct:chem-grade8:lesson:1-1", "struct:chem-grade8:activity:1-2"],
      raw_line: "",
      content_role: "knowledge",
    },
  );
});

test("appends generated chunks to outline without mutating the input outline", () => {
  const outline = {
    book_id: "chem-grade8",
    source_path: "data/markdown/chem.md",
    items: [
      {
        id: "struct:chem-grade8:lesson:1-1",
        kind: "lesson",
        label: "第1节",
        title: "水",
        md_start: 1,
        md_end: 80,
        order_path: "1.1",
      },
    ],
  };
  const chunk = makeSingleChunk(outline.items[0]!);

  const updated = appendChunkItems(outline, [chunk]);

  assert.equal(outline.items.length, 1);
  assert.notEqual(updated, outline);
  assert.deepEqual(updated.items.map((item) => item.id), ["struct:chem-grade8:lesson:1-1", "struct:chem-grade8:chunk:1-1-a"]);
  assert.equal(updated.book_id, "chem-grade8");
  assert.equal(updated.source_path, "data/markdown/chem.md");
});

test("plans chunk outline generation like Python main flow", () => {
  const items = [
    { id: "theme-1", kind: "theme" },
    { id: "topic-1", kind: "topic", parent_id: "theme-1" },
    {
      id: "struct:chem-grade8:lesson:short",
      kind: "lesson",
      parent_id: "topic-1",
      label: "短课",
      title: "短课",
      md_start: 1,
      md_end: 80,
      page_start: 1,
      page_end: 2,
      order_path: "1.1",
    },
    {
      id: "struct:chem-grade8:activity:act",
      kind: "activity",
      parent_id: "topic-1",
      label: "活动",
      title: "活动",
      md_start: 81,
      md_end: 120,
      page_start: 3,
      page_end: 3,
      order_path: "1.2",
    },
    {
      id: "struct:chem-grade8:lesson:long",
      kind: "lesson",
      parent_id: "topic-1",
      label: "长课",
      title: "长课",
      md_start: 121,
      md_end: 520,
      page_start: 4,
      page_end: 12,
      order_path: "1.3",
    },
    {
      id: "struct:chem-grade8:lesson:review",
      kind: "lesson",
      parent_id: "topic-1",
      label: "复习",
      title: "本章小结",
      md_start: 521,
      md_end: 560,
      order_path: "1.4",
    },
  ];

  const plan = planChunkOutline(
    items,
    [
      { line: 121, text: "第一段" },
      { line: 280, text: "第二段" },
      { line: 430, text: "第三段" },
    ],
    { minLines: 150, maxLines: 300, targetLines: 200 },
  );

  assert.deepEqual(plan.stats, { split: 1, merged: 1, normal: 1, excluded: 0 });
  assert.deepEqual(
    plan.chunks.map((chunk) => ({ id: chunk.id, source_ids: chunk.source_ids, md_start: chunk.md_start, md_end: chunk.md_end })),
    [
      {
        id: "struct:chem-grade8:chunk:short-a",
        source_ids: ["struct:chem-grade8:lesson:short", "struct:chem-grade8:activity:act"],
        md_start: 1,
        md_end: 120,
      },
      {
        id: "struct:chem-grade8:chunk:long-a",
        source_ids: ["struct:chem-grade8:lesson:long"],
        md_start: 121,
        md_end: 279,
      },
      {
        id: "struct:chem-grade8:chunk:long-b",
        source_ids: ["struct:chem-grade8:lesson:long"],
        md_start: 280,
        md_end: 520,
      },
      {
        id: "struct:chem-grade8:chunk:review-a",
        source_ids: ["struct:chem-grade8:lesson:review"],
        md_start: 521,
        md_end: 560,
      },
    ],
  );
  assert.deepEqual(plan.size_summary, { min: 40, max: 241, avg: 140 });
  assert.deepEqual(plan.chunks.map((chunk) => chunk.content_role), ["knowledge", "knowledge", "knowledge", "summary"]);
});

test("keeps assessment chunks separate from adjacent knowledge and summary content", () => {
  const plan = planChunkOutline([
    { id: "topic", kind: "topic" },
    { id: "struct:book:lesson:1", kind: "lesson", parent_id: "topic", title: "核心知识", md_start: 1, md_end: 80, order_path: "1" },
    { id: "struct:book:lesson:2", kind: "lesson", parent_id: "topic", title: "课后练习", md_start: 81, md_end: 140, order_path: "2" },
    { id: "struct:book:lesson:3", kind: "lesson", parent_id: "topic", title: "本章小结", md_start: 141, md_end: 200, order_path: "3" },
  ], [], { minLines: 150, maxLines: 300 });

  assert.deepEqual(
    plan.chunks.map((chunk) => [chunk.source_ids, chunk.content_role]),
    [
      [["struct:book:lesson:1"], "knowledge"],
      [["struct:book:lesson:2"], "assessment"],
      [["struct:book:lesson:3"], "summary"],
    ],
  );
});
