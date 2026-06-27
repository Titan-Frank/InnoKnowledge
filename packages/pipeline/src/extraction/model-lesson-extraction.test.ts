import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildExtractionPayloadFromModelBundle,
  buildModelExtractionRequest,
  buildModelLessonPayload,
  buildRetrievalQueries,
  buildResponseSchema,
  extractMarkdownEvidenceHints,
  parseModelBundleFromResponse,
} from "./model-lesson-extraction.js";

const bookId = "model-book";
const canonicalAnchor = "struct:model-book:chunk:1-1-a";

test("builds a model lesson payload from one chunk, not a local extractor payload", () => {
  const repo = makeFixtureRepo();
  try {
    const payload = buildModelLessonPayload({
      bookId,
      batchAnchor: "1-1-a",
      repoRoot: repo.root,
      subject: "chemistry",
      schoolStage: "senior-secondary",
      gradeBand: "grade-11",
      retrievalCandidates: [{ node_id: "node:known", name: "Known", kind: "concept", score: 0.9 }],
    });

    assert.equal(payload.lesson_context.batch_anchor, canonicalAnchor);
    assert.equal(payload.lesson_context.lesson_run_id, "lesson-run:144e3bd60d9c");
    assert.equal(payload.lesson_context.lesson_title, "结构化抽取");
    assert.equal(payload.lesson_context.source_path, "data/mineru/model-book/full.md");
    assert.equal(payload.lesson_context.page_start, 3);
    assert.equal(payload.lesson_context.page_end, 4);
    assert.deepEqual(payload.markdown_lines, [
      "# 结构化抽取",
      "知识图谱是一种表示方法",
      "![流程图](images/flow.png)",
      "| 对象 | 关系 |",
      "| --- | --- |",
      "$a+b=c$",
      "结尾",
    ]);
    assert.deepEqual(
      payload.lesson_context.markdown_evidence_hints.map((hint) => [hint.modality, hint.locator]),
      [
        ["image", "line:3"],
        ["table", "markdown-table-2"],
        ["equation", "line:6"],
      ],
    );
    assert.deepEqual(payload.lesson_context.retrieval_candidates, [{ node_id: "node:known", name: "Known", kind: "concept", score: 0.9 }]);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("builds OpenAI Responses and Chat Completions requests with the same schema intent as Python", () => {
  const repo = makeFixtureRepo();
  try {
    const responses = buildModelExtractionRequest({
      bookId,
      batchAnchor: canonicalAnchor,
      repoRoot: repo.root,
      model: "gpt-test",
      prompt: "只保留证据充分的节点。",
      reasoningEffort: "medium",
    });
    assert.equal(responses.api_mode, "responses");
    assert.equal(responses.endpoint, "https://api.openai.com/v1/responses");
    assert.equal(responses.body.model, "gpt-test");
    assert.deepEqual(responses.body.reasoning, { effort: "medium" });
    assert.equal(((responses.body.text as Record<string, unknown>).format as Record<string, unknown>).name, "world_knowledge_lesson_bundle");
    assert.match(responses.user_payload, /"lesson_context"/);

    const chat = buildModelExtractionRequest({
      bookId,
      batchAnchor: "chunk:1-1-a",
      repoRoot: repo.root,
      apiMode: "chat_completions",
      baseUrl: "https://example.test/v1/",
    });
    assert.equal(chat.endpoint, "https://example.test/v1/chat/completions");
    assert.equal((chat.body.response_format as Record<string, unknown>).type, "json_schema");
    assert.equal(((chat.body.response_format as Record<string, Record<string, unknown>>).json_schema).name, "world_knowledge_lesson_bundle");

    const schema = buildResponseSchema();
    assert.equal(schema.name, "world_knowledge_lesson_bundle");
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("parses model JSON when providers wrap it in a Markdown code fence", () => {
  const bundle = parseModelBundleFromResponse({
    choices: [
      {
        message: {
          content: [
            "",
            "```json",
            JSON.stringify({ nodes: [], edges: [], evidence_units: [], domain_profiles: [], node_cards: [], issues: [] }, null, 2),
            "```",
          ].join("\n"),
        },
      },
    ],
  });

  assert.deepEqual(bundle.nodes, []);
  assert.deepEqual(bundle.issues, []);
});

test("parses model JSON from a fenced block with surrounding provider text", () => {
  const bundle = parseModelBundleFromResponse({
    choices: [
      {
        message: {
          content: [
            "下面是抽取结果：",
            "```json",
            JSON.stringify({ nodes: [], edges: [], evidence_units: [], domain_profiles: [], node_cards: [], issues: ["ok"] }, null, 2),
            "```",
            "请查收。",
          ].join("\n"),
        },
      },
    ],
  });

  assert.deepEqual(bundle.issues, ["ok"]);
});

test("converts a model bundle into Python-compatible staging artifacts", () => {
  const repo = makeFixtureRepo();
  try {
    const payload = buildExtractionPayloadFromModelBundle(
      {
        bookId,
        batchAnchor: canonicalAnchor,
        repoRoot: repo.root,
        subject: "chemistry",
        schoolStage: "senior-secondary",
        gradeBand: "grade-11",
      },
      {
        nodes: [
          {
            id: "node:map",
            name: "知识图谱",
            kind: "concept",
            subkind: null,
            definition: "以节点和关系表示知识。",
            aliases: ["Knowledge Map"],
            domains: ["chemistry"],
            knowledge_form: ["propositional"],
            learning_mode: ["conceptual"],
            scope: "domain-specific",
            properties: {},
            external_ids: {},
            tags: [],
            notes: "",
          },
          {
            id: "node:repr",
            name: "表示方法",
            kind: "method",
            subkind: null,
            definition: "表达对象和关系的方法。",
            aliases: [],
            domains: ["chemistry"],
            knowledge_form: ["practical"],
            learning_mode: ["procedural"],
            scope: "domain-specific",
            properties: {},
            external_ids: {},
            tags: [],
            notes: "",
          },
        ],
        edges: [
          { from: "知识图谱", to: "表示方法", type: "uses", directionality: "directed", confidence: 0.9, evidence_anchor: "ev1", notes: "" },
          { from: "node:map", to: "missing", type: "uses", directionality: "directed", confidence: 0.9, evidence_anchor: "ev1", notes: "" },
        ],
        evidence_units: [{ anchor: "ev1", excerpt: "知识图谱是一种表示方法", locator: "line:2", modality: "text", node_ids: ["node:map"] }],
        domain_profiles: [{ node_id: "node:map", domain: "chemistry", school_stages: [], curriculum_roles: [], properties: {} }],
        node_cards: [
          {
            node_id: "node:map",
            summary: "",
            definition: "以节点和关系表示知识。",
            essence: "连接对象。",
            key_points: ["节点", "关系"],
            example: "概念关系图",
            application: "教材抽取",
            misconception: "不是普通标签表。",
            evidence_anchor: "ev1",
          },
        ],
        issues: ["ok"],
      },
    );

    assert.equal(payload.status, "success");
    assert.equal(payload.batch_anchor, canonicalAnchor);
    assert.deepEqual(payload.counts, {
      nodes: 2,
      edges: 1,
      domain_profiles: 2,
      mentions: 2,
      evidence: 4,
      node_cards: 2,
    });
    assert.equal(payload.edges[0]?.from, "node:map");
    assert.equal(payload.evidence[0]?.extraction_method, "openai_responses");
    assert.equal(payload.evidence[1]?.extraction_method, "markdown_hint");
    assert.equal(payload.mentions[1]?.role, "mentions");
    assert.equal(payload.domain_profiles[1]?.notes, "Backfilled because the model omitted a domain profile.");
    assert.equal(payload.node_cards[0]?.summary, "以节点和关系表示知识。");
    assert.match(payload.issues.at(-1) ?? "", /Dropped 1 edges/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("backfills missing model node names and empty definitions", () => {
  const repo = makeFixtureRepo();
  try {
    const payload = buildExtractionPayloadFromModelBundle(
      {
        bookId,
        batchAnchor: canonicalAnchor,
        repoRoot: repo.root,
        subject: "chemistry",
        schoolStage: "senior-secondary",
        gradeBand: "grade-11",
      },
      {
        nodes: [
          {
            id: "node:bad",
            name: "",
            kind: "concept",
            subkind: null,
            definition: "没有名称的节点应被丢弃。",
            aliases: [],
            domains: ["chemistry"],
            knowledge_form: ["propositional"],
            learning_mode: ["conceptual"],
            scope: "domain-specific",
            properties: {},
            external_ids: {},
            tags: [],
            notes: "",
          },
          {
            id: "",
            name: "",
            kind: "concept",
            subkind: null,
            definition: "",
            aliases: [],
            domains: ["chemistry"],
            knowledge_form: ["propositional"],
            learning_mode: ["conceptual"],
            scope: "domain-specific",
            properties: {},
            external_ids: {},
            tags: [],
            notes: "",
          },
          {
            id: "node:energy",
            name: "能量",
            kind: "concept",
            subkind: null,
            definition: "",
            aliases: [],
            domains: ["chemistry"],
            knowledge_form: ["propositional"],
            learning_mode: ["conceptual"],
            scope: "domain-specific",
            properties: {},
            external_ids: {},
            tags: [],
            notes: "",
          },
        ],
        edges: [{ from: "node:bad", to: "node:energy", type: "related_to", directionality: "directed", confidence: 0.8, evidence_anchor: "ev1", notes: "" }],
        evidence_units: [{ anchor: "ev1", excerpt: "能量是重要概念。", locator: "line:1", modality: "text", node_ids: ["node:bad", "node:energy"] }],
        domain_profiles: [],
        node_cards: [],
        issues: [],
      },
    );

    assert.deepEqual(payload.nodes.map((node) => node.id), ["node:bad", "node:energy"]);
    assert.equal(payload.nodes[0]?.name, "没有名称的节点应被丢弃");
    assert.equal(payload.nodes[1]?.definition, "能量");
    assert.equal(payload.edges.length, 1);
    assert.ok(payload.issues.some((issue) => issue.includes("Dropped model node")));
    assert.ok(payload.issues.some((issue) => issue.includes("Backfilled missing name")));
    assert.ok(payload.issues.some((issue) => issue.includes("Backfilled empty definition")));
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("builds retrieval queries and markdown evidence hints without extracting locally", () => {
  assert.deepEqual(buildRetrievalQueries({ title: "主标题" }, ["# 主标题", "短语", "完整句子。", "| a |"], 4), ["主标题", "短语"]);
  assert.deepEqual(
    extractMarkdownEvidenceHints(["$$", "E=mc^2", "$$", "| a |", "| b |"]).map((hint) => hint.modality),
    ["equation", "table"],
  );
});

function makeFixtureRepo(): { root: string } {
  const root = mkdtempSync(join(tmpdir(), "okm-model-extraction-"));
  mkdirSync(join(root, "data", "outlines"), { recursive: true });
  mkdirSync(join(root, "data", "mineru", "model-book"), { recursive: true });
  writeFileSync(
    join(root, "data", "outlines", `${bookId}.outline.json`),
    JSON.stringify({
      source_path: "data/mineru/model-book/full.md",
      structure: [
        { id: "struct:model-book:lesson:1-1", kind: "lesson", title: "第一课" },
        {
          id: canonicalAnchor,
          kind: "chunk",
          parent_id: "struct:model-book:lesson:1-1",
          order_path: "1.1.a",
          title: "结构化抽取",
          md_start: 2,
          md_end: 8,
          page_start: 3,
          page_end: 4,
        },
      ],
    }),
  );
  writeFileSync(
    join(root, "data", "mineru", "model-book", "full.md"),
    [
      "外部内容",
      "# 结构化抽取",
      "知识图谱是一种表示方法",
      "![流程图](images/flow.png)",
      "| 对象 | 关系 |",
      "| --- | --- |",
      "$a+b=c$",
      "结尾",
      "外部内容",
    ].join("\n"),
  );
  return { root };
}
