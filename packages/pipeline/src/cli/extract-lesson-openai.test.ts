import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runExtractLessonOpenAiCli } from "./extract-lesson-openai.js";

const bookId = "cli-model-book";
const canonicalAnchor = "struct:cli-model-book:chunk:1-1-a";

test("returns a blocked JSON payload when the API key is missing", async () => {
  const repo = makeFixtureRepo();
  const stdout: string[] = [];
  try {
    const code = await runExtractLessonOpenAiCli(
      ["--book-id", bookId, "--batch-anchor", canonicalAnchor, "--output-root", "/tmp/output", "--repo-root", repo.root],
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
          return new Response(
            JSON.stringify({
              output: [{ content: [{ type: "output_text", text: JSON.stringify({ nodes: [], edges: [], evidence_units: [], domain_profiles: [], node_cards: [], issues: [] }) }] }],
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
    const requestBody = requestBodies[0] as { input: Array<{ content: Array<{ text: string }> }> };
    const lessonPayload = JSON.parse(requestBody.input[0]!.content[0]!.text) as { lesson_context: { retrieval_candidates: unknown[] } };
    assert.deepEqual(lessonPayload.lesson_context.retrieval_candidates, [
      { node_id: "node:known", name: "模型抽取", kind: "concept", score: 100, method: "local" },
    ]);
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
      ["--book-id", bookId, "--batch-anchor", canonicalAnchor, "--output-root", "/tmp/output", "--repo-root", repo.root],
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
          return new Response(
            JSON.stringify({
              output: [{ content: [{ type: "output_text", text: JSON.stringify({ nodes: [], edges: [], evidence_units: [], domain_profiles: [], node_cards: [], issues: [] }) }] }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
    );

    assert.equal(code, 0);
    assert.equal(requestUrl, "https://llm.example.test/v1/responses");
    assert.equal(requestBody.model, "test-llm-model");
    const payload = JSON.parse(stdout.join("")) as { status: string };
    assert.equal(payload.status, "success");
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
    assert.deepEqual(statements.slice(0, 7), [
      "upsert-world-lesson-run",
      "delete-world_staging_nodes",
      "delete-world_staging_edges",
      "delete-world_staging_domain_profiles",
      "delete-world_staging_mentions",
      "delete-world_staging_evidence",
      "delete-world_staging_node_cards",
    ]);
    assert.ok(statements.includes("insert-world-staging-nodes"));
    const payload = JSON.parse(stdout.join("")) as { status: string; staging: { dataset_id: string; statements: string[] }; counts: { nodes: number } };
    assert.equal(payload.status, "success");
    assert.equal(payload.staging.dataset_id, "dataset-a");
    assert.equal(payload.counts.nodes, 1);
    assert.deepEqual(payload.staging.statements, statements);
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
