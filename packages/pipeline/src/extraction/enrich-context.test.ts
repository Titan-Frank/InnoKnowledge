import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEnrichBookCandidatesQuery,
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
      return [
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
    },
  });

  assert.deepEqual(statements, ["select-enrich-context-books"]);
  assert.equal(hints.length, 1);
  assert.equal(hints[0]?.title, "共价键");
  assert.deepEqual(hints[0]?.title_path, ["第一章 原子结构与性质", "共价键"]);
  assert.match(hints[0]?.definition ?? "", /共用电子对/);
  assert.match(hints[0]?.match_reason ?? "", /课时标题/);
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
