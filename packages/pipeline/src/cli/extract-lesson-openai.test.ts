import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runExtractLessonOpenAiCli } from "./extract-lesson-openai.js";

const bookId = "cli-model-book";
const canonicalAnchor = "struct:cli-model-book:chunk:1-1-a";

function requestBodiesStageName(body: Record<string, unknown>): string {
  return String(((body.response_format as { json_schema?: { name?: unknown } } | undefined)?.json_schema?.name) ?? "");
}

test("returns a blocked JSON payload when the API key is missing", async () => {
  const repo = makeFixtureRepo();
  const stdout: string[] = [];
  try {
    const code = await runExtractLessonOpenAiCli(
      [
        "--book-id",
        bookId,
        "--batch-anchor",
        canonicalAnchor,
        "--output-root",
        "/tmp/output",
        "--repo-root",
        repo.root,
      ],
      { stdout: (text) => stdout.push(text), stderr: () => undefined, env: {} },
    );

    assert.equal(code, 2);
    const payload = JSON.parse(stdout.join("")) as { status: string; issues: string[] };
    assert.equal(payload.status, "blocked");
    assert.match(payload.issues[0] ?? "", /Missing API key/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("accepts an explicit no_knowledge lesson without calling the relation stage", async () => {
  const repo = makeFixtureRepo();
  const stdout: string[] = [];
  let calls = 0;
  try {
    const code = await runExtractLessonOpenAiCli(
      [
        "--book-id",
        bookId,
        "--batch-anchor",
        canonicalAnchor,
        "--output-root",
        "/tmp/output",
        "--repo-root",
        repo.root,
        "--no-image-filter",
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: { OPENAI_API_KEY: "test-key" },
        fetchImpl: async () => {
          calls += 1;
          return new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              lesson_disposition: "no_knowledge",
              no_knowledge_reason: "当前课时只有导航信息。",
              nodes: [],
              evidence_units: [],
              issues: [],
            }) } }],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        },
      },
    );

    assert.equal(code, 0);
    assert.equal(calls, 1);
    const payload = JSON.parse(stdout.join("")) as Record<string, unknown>;
    assert.equal(payload.lesson_disposition, "no_knowledge");
    assert.equal(payload.no_knowledge_reason, "当前课时只有导航信息。");
    assert.deepEqual(payload.counts, {
      nodes: 0,
      edges: 0,
      domain_profiles: 0,
      mentions: 0,
      evidence: 0,
      node_cards: 0,
    });
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("calls the model with retrieval context loaded from a read-only executor", async () => {
  const repo = makeFixtureRepo();
  const stdout: string[] = [];
  const statementNames: string[] = [];
  const requestBodies: unknown[] = [];
  try {
    const code = await runExtractLessonOpenAiCli(
      [
        "--book-id",
        bookId,
        "--batch-anchor",
        canonicalAnchor,
        "--output-root",
        "/tmp/output",
        "--repo-root",
        repo.root,
        "--dataset-id",
        "dataset-a",
        "--subject",
        "chemistry",
        "--school-stage",
        "senior-secondary",
        "--retrieval-context",
        "--retrieval-mode",
        "local",
        "--retrieval-limit",
        "1",
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: { OPENAI_API_KEY: "test-key" },
        fetchImpl: async (_url, init) => {
          requestBodies.push(JSON.parse(String(init?.body)));
          const text = requestBodies.length === 1
            ? JSON.stringify({ nodes: [], evidence_units: [], issues: [] })
            : JSON.stringify({ edges: [], issues: [] });
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: text } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
        retrievalQueryExecutor: (statement) => {
          statementNames.push(statement.name);
          return [{ id: "node:known", name: "模型抽取", kind: "concept", score: 100 }];
        },
      },
    );

    assert.equal(code, 0);
    assert.deepEqual(statementNames, ["select-local-retrieval-candidates"]);
    const payload = JSON.parse(stdout.join("")) as { status: string; counts: { nodes: number } };
    assert.equal(payload.status, "success");
    assert.equal(payload.counts.nodes, 0);
    const requestBody = requestBodies[0] as { messages: Array<{ content: string }> };
    const lessonPayload = JSON.parse(requestBody.messages[1]!.content) as { lesson_context: { retrieval_candidates: unknown[] } };
    assert.deepEqual(lessonPayload.lesson_context.retrieval_candidates, [
      { node_id: "node:known", name: "模型抽取", kind: "concept", score: 100, method: "local" },
    ]);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("passes matching enrich context as auxiliary lesson hints", async () => {
  const repo = makeFixtureRepo();
  const stdout: string[] = [];
  const statementNames: string[] = [];
  const requestBodies: unknown[] = [];
  try {
    const code = await runExtractLessonOpenAiCli(
      [
        "--book-id",
        bookId,
        "--book-title",
        "高中化学选择性必修2 物质结构与性质",
        "--batch-anchor",
        canonicalAnchor,
        "--output-root",
        "/tmp/output",
        "--repo-root",
        repo.root,
        "--dataset-id",
        "dataset-a",
        "--subject",
        "chemistry",
        "--school-stage",
        "senior-secondary",
        "--enrich-context",
        "--enrich-context-limit",
        "1",
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: { OPENAI_API_KEY: "test-key" },
        fetchImpl: async (_url, init) => {
          requestBodies.push(JSON.parse(String(init?.body)));
          const text = requestBodies.length === 1
            ? JSON.stringify({ nodes: [], evidence_units: [], issues: [] })
            : JSON.stringify({ edges: [], issues: [] });
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: text } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
        enrichContextExecutor: (statement) => {
          statementNames.push(statement.name);
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
                  title: "模型抽取",
                  enrichment: {
                    definition: "模型抽取是根据证据生成结构化节点的过程。",
                    content: "用于辅助判断术语边界。",
                  },
                },
              ],
            },
          ];
          if (statement.name === "select-enrich-context-books") {
            return rows.map(({ tree_json, ...row }) => row);
          }
          return rows;
        },
      },
    );

    assert.equal(code, 0);
    assert.deepEqual(statementNames, ["select-enrich-context-books", "select-enrich-context-book-trees"]);
    const requestBody = requestBodies[0] as { messages: Array<{ content: string }> };
    const lessonPayload = JSON.parse(requestBody.messages[1]!.content) as {
      lesson_context: { enrich_hints: Array<{ title: string; definition: string }> };
    };
    assert.equal(lessonPayload.lesson_context.enrich_hints.length, 1);
    assert.equal(lessonPayload.lesson_context.enrich_hints[0]?.title, "模型抽取");
    assert.match(lessonPayload.lesson_context.enrich_hints[0]?.definition ?? "", /结构化节点/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("uses OpenAI model and base URL from environment when flags are omitted", async () => {
  const repo = makeFixtureRepo();
  const stdout: string[] = [];
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  try {
    const code = await runExtractLessonOpenAiCli(
      [
        "--book-id",
        bookId,
        "--batch-anchor",
        canonicalAnchor,
        "--output-root",
        "/tmp/output",
        "--repo-root",
        repo.root,
        "--no-image-filter",
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: {
          OPENAI_API_KEY: "test-key",
          OPENAI_BASE_URL: "https://llm.example.test/v1",
          OPENAI_MODEL: "test-llm-model",
        },
        fetchImpl: async (url, init) => {
          requestUrl = String(url);
          requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          const text = requestBody.response_format
            ? requestUrl.endsWith("/chat/completions") && requestBodiesStageName(requestBody) === "world_knowledge_edge_bundle"
              ? JSON.stringify({ edges: [], issues: [] })
              : JSON.stringify({ nodes: [], evidence_units: [], issues: [] })
            : JSON.stringify({ nodes: [], evidence_units: [], issues: [] });
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: text } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
    );

    assert.equal(code, 0);
    assert.equal(requestUrl, "https://llm.example.test/v1/chat/completions");
    assert.equal(requestBody.model, "test-llm-model");
    const payload = JSON.parse(stdout.join("")) as { status: string };
    assert.equal(payload.status, "success");
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("retries transient model request failures before blocking", async () => {
  const repo = makeFixtureRepo();
  const stdout: string[] = [];
  let calls = 0;
  try {
    const code = await runExtractLessonOpenAiCli(
      [
        "--book-id",
        bookId,
        "--batch-anchor",
        canonicalAnchor,
        "--output-root",
        "/tmp/output",
        "--repo-root",
        repo.root,
        "--no-image-filter",
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: { OPENAI_API_KEY: "test-key", MODEL_RETRY_COUNT: "1" },
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) throw new Error("fetch failed");
          const text = calls === 2
            ? JSON.stringify({ nodes: [], evidence_units: [], issues: [] })
            : JSON.stringify({ edges: [], issues: [] });
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: text } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
    );

    assert.equal(code, 0);
    assert.equal(calls, 3);
    const payload = JSON.parse(stdout.join("")) as { status: string };
    assert.equal(payload.status, "success");
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("retries a successful model response that contains no output text", async () => {
  const repo = makeFixtureRepo();
  const stdout: string[] = [];
  let calls = 0;
  try {
    const code = await runExtractLessonOpenAiCli(
      [
        "--book-id",
        bookId,
        "--batch-anchor",
        canonicalAnchor,
        "--output-root",
        "/tmp/output",
        "--repo-root",
        repo.root,
        "--no-image-filter",
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: { OPENAI_API_KEY: "test-key", MODEL_RETRY_COUNT: "1" },
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) {
            return new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          const text = calls === 2
            ? JSON.stringify({ nodes: [], evidence_units: [], issues: [] })
            : JSON.stringify({ edges: [], issues: [] });
          return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    );

    assert.equal(code, 0);
    assert.equal(calls, 3);
    const payload = JSON.parse(stdout.join("")) as { status: string };
    assert.equal(payload.status, "success");
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("runs the two-stage extraction flow", async () => {
  const repo = makeFixtureRepo();
  const stdout: string[] = [];
  const requestBodies: Record<string, unknown>[] = [];
  try {
    const code = await runExtractLessonOpenAiCli(
      [
        "--book-id",
        bookId,
        "--batch-anchor",
        canonicalAnchor,
        "--output-root",
        "/tmp/output",
        "--repo-root",
        repo.root,
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: { OPENAI_API_KEY: "test-key" },
        fetchImpl: async (_url, init) => {
          const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          requestBodies.push(requestBody);
          const text =
            requestBodies.length === 1
              ? JSON.stringify({
                  nodes: [
                    { id: "node:map", label: "模型抽取", kind: "concept", definition: "根据证据生成结构化节点。" },
                    { id: "node:evidence", name: "证据", kind: "concept", definition: "支撑节点和关系的教材片段。" },
                  ],
                  evidence_units: [
                    {
                      anchor: "ev1",
                      excerpt: "模型根据证据抽取节点。",
                      locator: "line:2",
                      modality: "text",
                      node_ids: ["node:map", "node:evidence"],
                    },
                  ],
                  issues: [],
                })
              : JSON.stringify([
                  {
                    from: "node:map",
                    to: "node:evidence",
                    type: "uses",
                    directionality: "directed",
                    confidence: 0.9,
                    evidence_anchor: "ev1",
                    notes: "",
                  },
                ]);
          return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    );

    assert.equal(code, 0);
    assert.equal(requestBodies.length, 2);
    assert.equal(((requestBodies[0]?.response_format as Record<string, Record<string, unknown>>).json_schema).name, "world_knowledge_node_evidence_bundle");
    assert.equal(((requestBodies[1]?.response_format as Record<string, Record<string, unknown>>).json_schema).name, "world_knowledge_edge_bundle");
    const secondPayload = JSON.parse((requestBodies[1]?.messages as Array<{ content: string }>)[1]!.content) as {
      markdown_lines?: unknown;
      candidate_nodes: unknown[];
    };
    assert.equal(secondPayload.markdown_lines, undefined);
    assert.equal(secondPayload.candidate_nodes.length, 2);
    const payload = JSON.parse(stdout.join("")) as { status: string; counts: { nodes: number; edges: number }; issues: string[] };
    assert.equal(payload.status, "success");
    assert.equal(payload.counts.nodes, 2);
    assert.equal(payload.counts.edges, 1);
    assert.ok(payload.issues.some((issue) => issue.includes("bare JSON array")));
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("assessment chunks use one existing-node-only model stage", async () => {
  const repo = makeAssessmentFixtureRepo();
  const stdout: string[] = [];
  let calls = 0;
  try {
    const code = await runExtractLessonOpenAiCli(
      [
        "--book-id",
        bookId,
        "--batch-anchor",
        canonicalAnchor,
        "--output-root",
        "/tmp/output",
        "--repo-root",
        repo.root,
        "--retrieval-candidates-json",
        JSON.stringify([{ node_id: "node:known", name: "模型抽取", kind: "concept", score: 100 }]),
        "--no-image-filter",
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: { OPENAI_API_KEY: "test-key" },
        fetchImpl: async () => {
          calls += 1;
          return new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              lesson_disposition: "extracted",
              no_knowledge_reason: "",
              nodes: [
                { id: "node:known", name: "模型抽取", kind: "concept", definition: "已有节点", properties: { assessment: { ability_points: ["识别模型抽取"], task_types: ["练习题"], confidence: 0.9 } } },
                { id: "node:new", name: "不得创建", kind: "concept", definition: "陌生节点" },
              ],
              evidence_units: [{ anchor: "ev1", excerpt: "完成模型抽取练习。", locator: "line:2", modality: "text", node_ids: ["node:known", "node:new"] }],
              issues: [],
            }) } }],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        },
      },
    );

    assert.equal(code, 0);
    assert.equal(calls, 1);
    const payload = JSON.parse(stdout.join("")) as Record<string, unknown>;
    assert.equal(payload.content_role, "assessment");
    assert.equal(payload.extraction_policy, "existing_nodes_only");
    assert.deepEqual((payload.nodes as Array<Record<string, unknown>>).map((node) => node.id), ["node:known"]);
    assert.deepEqual(payload.edges, []);
    assert.deepEqual(payload.node_cards, []);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("writes successful model output into staging through an injected executor", async () => {
  const repo = makeFixtureRepo();
  const stdout: string[] = [];
  const statements: string[] = [];
  try {
    const code = await runExtractLessonOpenAiCli(
      [
        "--book-id",
        bookId,
        "--batch-anchor",
        canonicalAnchor,
        "--output-root",
        "/tmp/output",
        "--repo-root",
        repo.root,
        "--dataset-id",
        "dataset-a",
        "--write-staging",
      ],
      {
        stdout: (text) => stdout.push(text),
        stderr: () => undefined,
        env: { OPENAI_API_KEY: "test-key" },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              output: [
                {
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify({
                        nodes: [
                          {
                            id: "node:map",
                            name: "模型抽取",
                            kind: "concept",
                            subkind: null,
                            definition: "根据证据生成结构化节点。",
                            aliases: [],
                            domains: ["computer-science"],
                            knowledge_form: ["propositional"],
                            learning_mode: ["conceptual"],
                            scope: "domain-specific",
                            properties: {},
                            external_ids: {},
                            tags: [],
                            notes: "",
                          },
                        ],
                        edges: [],
                        evidence_units: [
                          {
                            anchor: "ev1",
                            excerpt: "模型根据证据抽取节点。",
                            locator: "line:2",
                            modality: "text",
                            node_ids: ["node:map"],
                          },
                        ],
                        domain_profiles: [
                          {
                            node_id: "node:map",
                            domain: "computer-science",
                            school_stages: ["higher"],
                            curriculum_roles: ["core"],
                            properties: {},
                          },
                        ],
                        node_cards: [
                          {
                            node_id: "node:map",
                            summary: "根据证据生成结构化节点。",
                            definition: "根据证据生成结构化节点。",
                            essence: "证据驱动。",
                            key_points: ["证据", "结构化"],
                            example: "单课抽取",
                            application: "知识图谱构建",
                            misconception: "不是本地规则抽取。",
                            evidence_anchor: "ev1",
                          },
                        ],
                        issues: [],
                      }),
                    },
                  ],
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        stagingStatementExecutor: (statement) => {
          statements.push(statement.name);
        },
      },
    );

    assert.equal(code, 0);
    assert.equal(statements[0], "begin-staging-transaction");
    assert.equal(statements.at(-1), "commit-staging-transaction");
    const stagedStatements = statements.filter((statement) => !statement.includes("staging-transaction"));
    assert.deepEqual(stagedStatements.slice(0, 7), [
      "upsert-world-lesson-run",
      "delete-world_staging_nodes",
      "delete-world_staging_edges",
      "delete-world_staging_domain_profiles",
      "delete-world_staging_mentions",
      "delete-world_staging_evidence",
      "delete-world_staging_node_cards",
    ]);
    assert.ok(stagedStatements.includes("insert-world-staging-nodes"));
    const payload = JSON.parse(stdout.join("")) as { status: string; staging: { dataset_id: string; statements: string[] }; counts: { nodes: number } };
    assert.equal(payload.status, "success");
    assert.equal(payload.staging.dataset_id, "dataset-a");
    assert.equal(payload.counts.nodes, 1);
    assert.deepEqual(payload.staging.statements, stagedStatements);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("write-staging requires an explicit database or injected executor", async () => {
  const repo = makeFixtureRepo();
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    const code = await runExtractLessonOpenAiCli(
      ["--book-id", bookId, "--batch-anchor", canonicalAnchor, "--output-root", "/tmp/output", "--repo-root", repo.root, "--write-staging"],
      {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
        env: { OPENAI_API_KEY: "test-key" },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              output: [{ content: [{ type: "output_text", text: JSON.stringify({ nodes: [], edges: [], evidence_units: [], domain_profiles: [], node_cards: [], issues: [] }) }] }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
    );

    assert.equal(code, 1);
    assert.equal(stdout.join(""), "");
    assert.match(stderr.join(""), /--write-staging requires --db/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("rejects the retired local fallback flag", async () => {
  const stderr: string[] = [];
  const code = await runExtractLessonOpenAiCli(
    ["--book-id", bookId, "--batch-anchor", canonicalAnchor, "--output-root", "/tmp/output", "--fallback-local-on-error"],
    { stdout: () => undefined, stderr: (text) => stderr.push(text), env: {} },
  );

  assert.equal(code, 1);
  assert.match(stderr.join(""), /only calls the model/);
});

function makeFixtureRepo(): { root: string } {
  const root = mkdtempSync(join(tmpdir(), "okm-cli-model-extraction-"));
  mkdirSync(join(root, "data", "outlines"), { recursive: true });
  mkdirSync(join(root, "data", "mineru", "cli-model-book"), { recursive: true });
  writeFileSync(
    join(root, "data", "outlines", `${bookId}.outline.json`),
    JSON.stringify({
      source_path: "data/mineru/cli-model-book/full.md",
      structure: [
        { id: "struct:cli-model-book:lesson:1-1", kind: "lesson", title: "第一课" },
        {
          id: canonicalAnchor,
          kind: "chunk",
          parent_id: "struct:cli-model-book:lesson:1-1",
          order_path: "1.1.a",
          title: "模型抽取",
          md_start: 1,
          md_end: 2,
          page_start: 1,
          page_end: 1,
        },
      ],
    }),
  );
  writeFileSync(join(root, "data", "mineru", "cli-model-book", "full.md"), ["# 模型抽取", "模型根据证据抽取节点。"].join("\n"));
  return { root };
}

function makeAssessmentFixtureRepo(): { root: string } {
  const fixture = makeFixtureRepo();
  writeFileSync(
    join(fixture.root, "data", "outlines", `${bookId}.outline.json`),
    JSON.stringify({
      source_path: "data/mineru/cli-model-book/full.md",
      structure: [{
        id: canonicalAnchor,
        kind: "chunk",
        title: "课后练习",
        content_role: "assessment",
        md_start: 1,
        md_end: 2,
        page_start: 1,
        page_end: 1,
      }],
    }),
  );
  return fixture;
}
