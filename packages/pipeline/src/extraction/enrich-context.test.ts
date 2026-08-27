import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEnrichBookCandidatesQuery,
  buildEnrichBookTreesQuery,
  loadEnrichHintsForLesson,
  outlineTitlePathFromRecord,
} from "./enrich-context.js";

test("builds a read-only enrich book query with subject and stage filters", () => {
  const statement = buildEnrichBookCandidatesQuery({
    datasetId: "main",
    subject: "chemistry",
    schoolStage: "senior-secondary",
    limit: 12,
  });

  assert.equal(statement.name, "select-enrich-context-books");
  assert.match(statement.sql, /FROM world_enrich_books/);
  assert.match(statement.sql, /subject = \$2/);
  assert.match(statement.sql, /stage = \$5/);
  assert.deepEqual(statement.params, ["main", "化学", "%化学%", "%化学%", "高中", "%高中%", "%高中%", 12]);
});

test("builds an exact path query after choosing an enrich book", () => {
  const statement = buildEnrichBookTreesQuery("main", ["data/enrich/a.json", "data/enrich/b.json"]);

  assert.equal(statement.name, "select-enrich-context-book-trees");
  assert.match(statement.sql, /path = ANY\(\$2::text\[\]\)/);
  assert.deepEqual(statement.params, ["main", ["data/enrich/a.json", "data/enrich/b.json"]]);
});

test("loads only matching enrich hints for the current lesson", async () => {
  const statements: string[] = [];
  const hints = await loadEnrichHintsForLesson({
    datasetId: "main",
    subject: "chemistry",
    schoolStage: "senior-secondary",
    bookTitle: "高中化学选择性必修2 物质结构与性质",
    lessonTitle: "共价键",
    outlineTitlePath: ["第一章 原子结构与性质", "第二节 共价键"],
    markdownLines: ["# 共价键", "共价键具有方向性和饱和性。"],
    limit: 1,
    executor: (statement) => {
      statements.push(statement.name);
      const rows = [
        {
          path: "data/enrich/化学/高中_化学_沪科技版_选择性必修2物质结构与性质_enriched.json",
          filename: "高中_化学_沪科技版_选择性必修2物质结构与性质_enriched.json",
          title: "高中 化学 沪科技版 选择性必修2物质结构与性质",
          subject: "化学",
          stage: "高中",
          grade: "",
          course: "化学",
          publisher: "沪科技版",
          volume: "选择性必修2物质结构与性质",
          tree_json: [
            {
              title: "第一章 原子结构与性质",
              child_nodes: [
                {
                  title: "共价键",
                  enrichment: {
                    definition: "共价键是原子间通过共用电子对形成的化学键。",
                    content: "学习共价键的形成、方向性和饱和性。",
                    academic_requirements: "能解释共价键形成过程。",
                  },
                },
                {
                  title: "离子键",
                  enrichment: {
                    definition: "离子键是阴阳离子间的静电作用。",
                  },
                },
              ],
            },
          ],
        },
      ];
      if (statement.name === "select-enrich-context-books") {
        return rows.map(({ tree_json, ...row }) => row);
      }
      return rows;
    },
  });

  assert.deepEqual(statements, ["select-enrich-context-books", "select-enrich-context-book-trees"]);
  assert.equal(hints.length, 1);
  assert.equal(hints[0]?.title, "共价键");
  assert.deepEqual(hints[0]?.title_path, ["第一章 原子结构与性质", "共价键"]);
  assert.match(hints[0]?.definition ?? "", /共用电子对/);
  assert.match(hints[0]?.match_reason ?? "", /课时标题/);
});

test("locks the enrich book by subject, stage, grade, publisher, and volume before lesson matching", async () => {
  const selectedPaths: string[][] = [];
  const rows = [
    {
      path: "data/enrich/物理/初中_八年级_物理_教科版_下册_enriched.json",
      filename: "初中_八年级_物理_教科版_下册_enriched.json",
      title: "初中 八年级 物理 教科版 下册",
      subject: "物理",
      stage: "初中",
      grade: "八年级",
      course: "物理",
      publisher: "教科版",
      volume: "下册",
      tree_json: [{ title: "光的反射", enrichment: { definition: "错误版本。" } }],
    },
    {
      path: "data/enrich/物理/初中_八年级_物理_人教版_上册_enriched.json",
      filename: "初中_八年级_物理_人教版_上册_enriched.json",
      title: "初中 八年级 物理 人教版 上册",
      subject: "物理",
      stage: "初中",
      grade: "八年级",
      course: "物理",
      publisher: "人教版",
      volume: "上册",
      tree_json: [{ title: "光的反射", enrichment: { definition: "正确版本。" } }],
    },
  ];

  const hints = await loadEnrichHintsForLesson({
    datasetId: "main",
    subject: "physics",
    schoolStage: "junior-secondary",
    gradeBand: "grade8",
    bookTitle: "初中 八年级 物理 人教版 上册",
    lessonTitle: "光的反射",
    limit: 2,
    executor: (statement) => {
      if (statement.name === "select-enrich-context-books") {
        return rows.map(({ tree_json, ...row }) => row);
      }
      selectedPaths.push(statement.params[1] as string[]);
      const paths = new Set(statement.params[1] as string[]);
      return rows.filter((row) => paths.has(row.path));
    },
  });

  assert.deepEqual(selectedPaths, [["data/enrich/物理/初中_八年级_物理_人教版_上册_enriched.json"]]);
  assert.equal(hints.length, 1);
  assert.equal(hints[0]?.definition, "正确版本。");
});

test("uses the manually selected enrich book path without candidate fallback", async () => {
  const selectedPaths: string[][] = [];
  const rows = [
    {
      path: "data/enrich/物理/高中_物理_教科版_必修第三册_enriched.json",
      filename: "高中_物理_教科版_必修第三册_enriched.json",
      title: "高中 · 物理 · 教科版 · 必修第三册",
      subject: "物理",
      stage: "高中",
      grade: "物理",
      course: "教科版",
      publisher: "必修第三册",
      volume: "",
      tree_json: [{ title: "机械波", enrichment: { definition: "错误版本。" } }],
    },
    {
      path: "data/enrich/物理/高中_物理_沪科技版_必修第三册_enriched.json",
      filename: "高中_物理_沪科技版_必修第三册_enriched.json",
      title: "高中 · 物理 · 沪科技版 · 必修第三册",
      subject: "物理",
      stage: "高中",
      grade: "物理",
      course: "沪科技版",
      publisher: "必修第三册",
      volume: "",
      tree_json: [{ title: "机械波", enrichment: { definition: "人工确认版本。" } }],
    },
  ];
  const selectedPath = rows[1]!.path;

  const hints = await loadEnrichHintsForLesson({
    datasetId: "main",
    bookPath: selectedPath,
    lessonTitle: "机械波",
    executor: (statement) => {
      assert.equal(statement.name, "select-enrich-context-book-trees");
      selectedPaths.push(statement.params[1] as string[]);
      return rows.filter((row) => (statement.params[1] as string[]).includes(row.path));
    },
  });

  assert.deepEqual(selectedPaths, [[selectedPath]]);
  assert.equal(hints[0]?.book_path, selectedPath);
  assert.equal(hints[0]?.definition, "人工确认版本。");
});

test("resolves an outline title path for the current anchor", () => {
  const path = outlineTitlePathFromRecord(
    {
      items: [
        { id: "lesson:1", title: "第一节 化学键" },
        { id: "chunk:1-a", parent_id: "lesson:1", title: "共价键" },
      ],
    },
    "chunk:1-a",
  );

  assert.deepEqual(path, ["第一节 化学键", "共价键"]);
});
