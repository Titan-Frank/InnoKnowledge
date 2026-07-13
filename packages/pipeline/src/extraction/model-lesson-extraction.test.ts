import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildExtractionPayloadFromModelBundle,
  buildHybridEdgeExtractionRequest,
  buildHybridEdgeResponseSchema,
  buildHybridExtractionPayloadFromModelBundles,
  buildHybridNodeEvidenceExtractionRequest,
  buildHybridNodeEvidenceResponseSchema,
  buildModelLessonPayload,
  buildRetrievalQueries,
  buildResponseSchema,
  extractMarkdownEvidenceHints,
  parseModelBundleFromResponse,
} from "./model-lesson-extraction.js";
import { resolveExtractionTemplate } from "./extraction-template.js";

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
    assert.deepEqual(payload.lesson_context.enrich_hints, []);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("builds two-stage model requests with chat completions as the default API", () => {
  const repo = makeFixtureRepo();
  try {
    const request = buildHybridNodeEvidenceExtractionRequest({
      bookId,
      batchAnchor: canonicalAnchor,
      repoRoot: repo.root,
      model: "gpt-test",
      prompt: "只保留证据充分的节点。",
      reasoningEffort: "medium",
      extractionTemplate: resolveExtractionTemplate({ templateId: "physics" }),
    });
    assert.equal(request.api_mode, "chat_completions");
    assert.equal(request.endpoint, "https://api.openai.com/v1/chat/completions");
    assert.equal(request.body.model, "gpt-test");
    assert.equal((request.body.response_format as Record<string, unknown>).type, "json_schema");
    assert.equal(((request.body.response_format as Record<string, Record<string, unknown>>).json_schema).name, "world_knowledge_node_evidence_bundle");
    assert.match(request.user_payload, /"lesson_context"/);
    assert.match(request.user_payload, /"extraction_template"/);
    assert.match(request.instructions, /物理教材抽取模板/);
    assert.match(request.instructions, /第一阶段/);
    assert.match(request.instructions, /不能作为节点证据/);
    assert.match(request.instructions, /lesson_disposition/);
    assert.match(request.instructions, /no_knowledge/);
    assert.doesNotMatch(request.instructions, /- edges:/);
    assert.doesNotMatch(request.instructions, /关系规则：/);

    const responses = buildHybridNodeEvidenceExtractionRequest({
      bookId,
      batchAnchor: "chunk:1-1-a",
      repoRoot: repo.root,
      apiMode: "responses",
      baseUrl: "https://example.test/v1/",
    });
    assert.equal(responses.endpoint, "https://example.test/v1/responses");
    assert.equal(((responses.body.text as Record<string, unknown>).format as Record<string, unknown>).name, "world_knowledge_node_evidence_bundle");

    const schema = buildResponseSchema();
    assert.equal(schema.name, "world_knowledge_lesson_bundle");
    assert.equal(buildHybridNodeEvidenceResponseSchema().name, "world_knowledge_node_evidence_bundle");
    assert.equal(buildHybridEdgeResponseSchema().name, "world_knowledge_edge_bundle");
    const hybridRequired = ((buildHybridNodeEvidenceResponseSchema().schema as Record<string, unknown>).required as string[]);
    assert.ok(hybridRequired.includes("lesson_disposition"));
    assert.ok(hybridRequired.includes("no_knowledge_reason"));
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("builds the hybrid edge request from first-stage nodes and evidence only", () => {
  const repo = makeFixtureRepo();
  try {
    const request = buildHybridEdgeExtractionRequest(
      {
        bookId,
        batchAnchor: canonicalAnchor,
        repoRoot: repo.root,
        subject: "chemistry",
        schoolStage: "senior-secondary",
        gradeBand: "grade-11",
        extractionTemplate: resolveExtractionTemplate({ templateId: "chemistry" }),
      },
      {
        nodes: [{ id: "node:map", label: "知识图谱", kind: "concept", definition: "结构化表示知识。" }],
        evidence_units: [{ anchor: "ev1", excerpt: "知识图谱是一种表示方法", source_locator: "line:2", node_ids: ["node:map"] }],
        issues: [],
      },
    );

    const userPayload = JSON.parse(request.user_payload) as {
      markdown_lines?: unknown;
      candidate_nodes: Array<{ id: string; name: string }>;
      evidence_units: Array<{ anchor: string }>;
      allowed_edge_types: string[];
    };
    assert.equal(userPayload.markdown_lines, undefined);
    assert.deepEqual(userPayload.candidate_nodes, [
      { id: "node:map", name: "知识图谱", kind: "concept", aliases: [], definition: "结构化表示知识。" },
    ]);
    assert.deepEqual(userPayload.evidence_units.map((item) => item.anchor), ["ev1"]);
    assert.ok(userPayload.allowed_edge_types.includes("produces"));
    assert.ok(!userPayload.allowed_edge_types.includes("same_as"));
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("strictly keeps hybrid edges only when nodes and evidence anchors exist", () => {
  const repo = makeFixtureRepo();
  try {
    const payload = buildHybridExtractionPayloadFromModelBundles(
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
          { id: "node:map", label: "知识图谱", kind: "concept", definition: "以节点和关系表示知识。", domain: "chemistry" },
          { id: "node:repr", name: "表示方法", kind: "method", definition: "表达对象和关系的方法。", learning_dimension: ["procedural"] },
        ],
        evidence_units: [
          { anchor: "ev1", excerpt: "知识图谱是一种表示方法", locator: "line:2", modality: "text", node_ids: ["node:map", "node:repr"] },
        ],
        issues: ["stage1"],
      },
      {
        edges: [
          { source: "node:map", target: "node:repr", type: "uses", confidence: 0.9, evidence_anchor: "ev1", notes: "" },
          { from: "node:map", to: "missing", type: "uses", confidence: 0.9, evidence_anchor: "ev1", notes: "" },
          { from: "node:map", to: "node:repr", type: "uses", confidence: 0.9, evidence_anchor: "missing", notes: "" },
        ],
        issues: ["stage2"],
      },
    );

    assert.equal(payload.counts.nodes, 2);
    assert.equal(payload.counts.edges, 1);
    assert.equal(payload.edges[0]?.from, "node:map");
    assert.equal(payload.edges[0]?.to, "node:repr");
    assert.ok(payload.issues.includes("stage1"));
    assert.ok(payload.issues.includes("stage2"));
    assert.ok(payload.issues.some((issue) => issue.includes("Strict hybrid validator dropped 2 edge")));
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("keeps an explicit no_knowledge lesson completely empty", () => {
  const repo = makeFixtureRepo();
  try {
    const payload = buildHybridExtractionPayloadFromModelBundles(
      { bookId, batchAnchor: canonicalAnchor, repoRoot: repo.root },
      {
        lesson_disposition: "no_knowledge",
        no_knowledge_reason: "当前课时只有导航信息。",
        nodes: [],
        evidence_units: [],
        issues: [],
      },
      { edges: [], issues: [] },
    );

    assert.equal(payload.lesson_disposition, "no_knowledge");
    assert.equal(payload.no_knowledge_reason, "当前课时只有导航信息。");
    assert.deepEqual(payload.counts, {
      nodes: 0,
      edges: 0,
      domain_profiles: 0,
      curriculum_projections: 0,
      mentions: 0,
      evidence: 0,
      node_cards: 0,
    });
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("marks fallback evidence as quality-excluded without inventing a mention", () => {
  const repo = makeFixtureRepo();
  try {
    const payload = buildHybridExtractionPayloadFromModelBundles(
      { bookId, batchAnchor: canonicalAnchor, repoRoot: repo.root, markdownLines: ["知识正文"] },
      {
        lesson_disposition: "extracted",
        no_knowledge_reason: "",
        nodes: [{ id: "node:map", name: "知识图谱", kind: "concept", definition: "结构化表示知识。" }],
        evidence_units: [],
        issues: [],
      },
      { edges: [], issues: [] },
    );

    assert.equal(payload.evidence.length, 1);
    assert.deepEqual(payload.evidence[0]?.properties, {
      synthetic: true,
      quality_excluded: true,
      review_status: "pending",
    });
    assert.deepEqual(payload.mentions, []);
    assert.deepEqual(payload.domain_profiles[0]?.source_refs, []);
    assert.deepEqual(payload.node_cards[0]?.source_refs, []);
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
        domain_profiles: [{ node_id: "node:map", domain: "chemistry", domain_role: "model", properties: {} }],
        curriculum_projections: [],
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
      curriculum_projections: 2,
      mentions: 1,
      evidence: 4,
      node_cards: 2,
    });
    assert.equal(payload.edges[0]?.from, "node:map");
    assert.equal(payload.evidence[0]?.extraction_method, "openai_chat_completions");
    assert.equal(payload.evidence[1]?.extraction_method, "markdown_hint");
    assert.equal(payload.mentions.length, 1);
    assert.equal(payload.mentions[0]?.role, "defines");
    assert.equal(payload.domain_profiles[1]?.notes, "Backfilled because the model omitted a domain profile.");
    assert.equal(payload.node_cards[0]?.summary, "以节点和关系表示知识。");
    assert.match(payload.issues.at(-1) ?? "", /Dropped 1 edges/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("attaches extraction template metadata and display rules to staging artifacts", () => {
  const repo = makeFixtureRepo();
  try {
    const payload = buildExtractionPayloadFromModelBundle(
      {
        bookId,
        batchAnchor: canonicalAnchor,
        repoRoot: repo.root,
        subject: "physics",
        schoolStage: "senior-secondary",
        gradeBand: "grade-11",
        extractionTemplate: resolveExtractionTemplate({ templateId: "physics" }),
      },
      {
        nodes: [
          {
            id: "node:force",
            name: "力",
            kind: "property",
            subkind: null,
            definition: "物体间的相互作用。",
            aliases: [],
            domains: ["physics"],
            knowledge_form: ["propositional"],
            learning_mode: ["conceptual"],
            scope: "domain-specific",
            properties: {},
            external_ids: {},
            tags: [],
            notes: "",
          },
          {
            id: "node:model",
            name: "力的示意图",
            kind: "representation",
            subkind: null,
            definition: "用箭头表示力的图。",
            aliases: [],
            domains: ["physics"],
            knowledge_form: ["representational"],
            learning_mode: ["conceptual"],
            scope: "domain-specific",
            properties: {},
            external_ids: {},
            tags: [],
            notes: "",
          },
        ],
        edges: [
          { from: "node:model", to: "node:force", type: "represents", directionality: "directed", confidence: 0.92, evidence_anchor: "ev1", notes: "" },
        ],
        evidence_units: [{ anchor: "ev1", excerpt: "力的示意图可以表示力的方向。", locator: "line:2", modality: "text", node_ids: ["node:force"] }],
        domain_profiles: [],
        node_cards: [],
        issues: [],
      },
    );

    const nodeProperties = payload.nodes[0]?.properties as Record<string, unknown>;
    const nodeTemplate = nodeProperties.extraction_template as Record<string, unknown>;
    const nodeDisplay = nodeProperties.template_display as Record<string, unknown>;
    assert.equal(nodeTemplate.id, "textbook/physics");
    assert.equal(nodeDisplay.label, "物理量");
    assert.equal(nodeDisplay.color, "#FFB400");

    const edgeProperties = payload.edges[0]?.properties as Record<string, unknown>;
    const edgeDisplay = edgeProperties.template_display as Record<string, unknown>;
    assert.equal((edgeProperties.extraction_template as Record<string, unknown>).id, "textbook/physics");
    assert.equal(edgeDisplay.label, "表示");
    assert.equal((payload.evidence[0]?.properties as Record<string, Record<string, unknown>>).extraction_template.id, "textbook/physics");
    assert.equal((payload.mentions[0]?.properties as Record<string, Record<string, unknown>>).extraction_template.id, "textbook/physics");
    assert.equal((payload.domain_profiles[0]?.properties as Record<string, Record<string, unknown>>).extraction_template.id, "textbook/physics");
    assert.equal((payload.node_cards[0]?.properties as Record<string, Record<string, unknown>>).extraction_template.id, "textbook/physics");
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
