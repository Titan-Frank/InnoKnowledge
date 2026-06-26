import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { filterImageEvidencePayload } from "./image-relevance.js";

test("sends decorative-looking image labels to VLM instead of local rules", async () => {
  const repo = makeImageFixture();
  let called = false;
  try {
    const result = await filterImageEvidencePayload(
      {
        evidence: [
          imageEvidence("ev-text", "文字证据", "line:1", ""),
          imageEvidence("ev-think", "![想一想](images/think.png)", "line:2", "images/think.png"),
        ],
        mentions: [{ id: "m1", source_refs: ["ev-think"] }],
        edges: [{ id: "e1", source_refs: ["ev-think"] }],
        domain_profiles: [],
        node_cards: [],
        counts: { evidence: 2, mentions: 1, edges: 1, domain_profiles: 0, node_cards: 0 },
        issues: [],
      },
      {
        repoRoot: repo.root,
        vlmApiUrl: "http://localhost:8000/v1",
        fetchImpl: async () => {
          called = true;
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      keep: false,
                      relevance: "decorative",
                      reason: "只是栏目装饰。",
                      confidence: 0.94,
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
    );

    assert.equal(called, true);
    assert.deepEqual(result.dropped_evidence_ids, ["ev-think"]);
    assert.equal((result.decisions["ev-think"]?.source), "vlm");
    assert.equal((result.decisions["ev-think"]?.relevance), "decorative");
    assert.deepEqual((result.payload.evidence as unknown[]).map((item) => (item as Record<string, unknown>).id), ["ev-text"]);
    assert.equal((result.payload.mentions as unknown[]).length, 0);
    assert.equal((result.payload.edges as unknown[]).length, 0);
    assert.equal((result.payload.counts as Record<string, unknown>).evidence, 1);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("keeps image evidence as uncertain when VLM is not configured", async () => {
  const repo = makeImageFixture();
  try {
    const result = await filterImageEvidencePayload(
      {
        evidence: [imageEvidence("ev-unknown", "![](images/unknown.png)", "line:3", "images/unknown.png")],
        mentions: [],
        edges: [],
        domain_profiles: [],
        node_cards: [],
        counts: { evidence: 1, mentions: 0, edges: 0, domain_profiles: 0, node_cards: 0 },
        issues: [],
      },
      { repoRoot: repo.root },
    );

    assert.deepEqual(result.dropped_evidence_ids, []);
    assert.equal(result.decisions["ev-unknown"]?.source, "fallback");
    assert.equal(result.decisions["ev-unknown"]?.relevance, "uncertain");
    assert.equal((result.payload.evidence as unknown[]).length, 1);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("uses VLM for uncertain images and prunes dropped references", async () => {
  const repo = makeImageFixture();
  const fetchCalls: unknown[] = [];
  try {
    const result = await filterImageEvidencePayload(
      {
        evidence: [imageEvidence("ev-unknown", "![教材图片](images/unknown.png)", "line:3", "images/unknown.png")],
        mentions: [{ id: "m1", source_refs: ["ev-unknown"] }],
        edges: [{ id: "e1", source_refs: ["ev-unknown"] }],
        domain_profiles: [{ id: "p1", source_refs: ["ev-unknown"] }],
        node_cards: [{ id: "c1", source_refs: ["ev-unknown"], sections: [{ id: "s1", source_refs: ["ev-unknown"] }] }],
        counts: { evidence: 1, mentions: 1, edges: 1, domain_profiles: 1, node_cards: 1 },
        issues: [],
      },
      {
        repoRoot: repo.root,
        vlmApiUrl: "http://localhost:8000/v1",
        fetchImpl: async (url, init) => {
          fetchCalls.push({ url, init });
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      keep: false,
                      relevance: "decorative",
                      reason: "只是栏目装饰。",
                      confidence: 0.93,
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
    );

    assert.equal(fetchCalls.length, 1);
    assert.equal((fetchCalls[0] as { url: string }).url, "http://localhost:8000/v1/chat/completions");
    assert.deepEqual(result.dropped_evidence_ids, ["ev-unknown"]);
    assert.equal(result.decisions["ev-unknown"]?.source, "vlm");
    assert.equal((result.payload.evidence as unknown[]).length, 0);
    assert.equal((result.payload.mentions as unknown[]).length, 0);
    assert.equal((result.payload.edges as unknown[]).length, 0);
    assert.deepEqual((result.payload.domain_profiles as Array<Record<string, unknown>>)[0]?.source_refs, []);
    assert.deepEqual((result.payload.node_cards as Array<Record<string, unknown>>)[0]?.source_refs, []);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("includes source markdown context in VLM prompt", async () => {
  const repo = makeImageFixture();
  let prompt = "";
  try {
    writeFileSync(join(repo.root, "data", "mineru", "book", "full.md"), [
      "# 第一章 电场",
      "",
      "电场线可以表示电场方向。",
      "![电场线示意图](images/unknown.png)",
      "箭头方向表示正电荷受力方向。",
    ].join("\n"));

    const result = await filterImageEvidencePayload(
      {
        evidence: [imageEvidence("ev-context", "![电场线示意图](images/unknown.png)", "line:999", "images/unknown.png")],
        mentions: [],
        edges: [],
        domain_profiles: [],
        node_cards: [],
        counts: { evidence: 1, mentions: 0, edges: 0, domain_profiles: 0, node_cards: 0 },
        issues: [],
      },
      {
        repoRoot: repo.root,
        vlmApiUrl: "http://localhost:8000/v1",
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
          prompt = body.messages?.[0]?.content?.find((part) => part.type === "text")?.text ?? "";
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      keep: true,
                      relevance: "core_content",
                      reason: "图片内容和电场线上下文一致。",
                      confidence: 0.92,
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
    );

    assert.equal(result.decisions["ev-context"]?.relevance, "core_content");
    assert.match(prompt, /只要图片内容能和标题、前文、图片行、后文中的任一处形成合理对应，就保留/);
    assert.match(prompt, /不是最核心、信息量一般、只起辅助作用/);
    assert.match(prompt, /relevance="supporting"/);
    assert.match(prompt, /标题路径：第一章 电场/);
    assert.match(prompt, /源文件行：4/);
    assert.match(prompt, /前文：电场线可以表示电场方向。/);
    assert.match(prompt, /图片行：\[图片：电场线示意图\]/);
    assert.match(prompt, /后文：箭头方向表示正电荷受力方向。/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("forces mismatch and decorative VLM labels to drop even when keep is inconsistent", async () => {
  const repo = makeImageFixture();
  try {
    const result = await filterImageEvidencePayload(
      {
        evidence: [imageEvidence("ev-mismatch", "![无关图片](images/unknown.png)", "line:3", "images/unknown.png")],
        mentions: [{ id: "m1", source_refs: ["ev-mismatch"] }],
        edges: [{ id: "e1", source_refs: ["ev-mismatch"] }],
        domain_profiles: [],
        node_cards: [],
        counts: { evidence: 1, mentions: 1, edges: 1, domain_profiles: 0, node_cards: 0 },
        issues: [],
      },
      {
        repoRoot: repo.root,
        vlmApiUrl: "http://localhost:8000/v1",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      keep: true,
                      relevance: "mismatch",
                      reason: "图片内容和上下文不匹配。",
                      confidence: 0.9,
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
    );

    assert.equal(result.decisions["ev-mismatch"]?.keep, false);
    assert.deepEqual(result.dropped_evidence_ids, ["ev-mismatch"]);
    assert.equal((result.payload.evidence as unknown[]).length, 0);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("repairs node evidence refs with remaining text evidence after image pruning", async () => {
  const repo = makeImageFixture();
  try {
    const result = await filterImageEvidencePayload(
      {
        evidence: [textEvidence("ev-text", "电场强度描述电场性质。"), imageEvidence("ev-icon", "![想一想](images/think.png)", "line:3", "images/think.png")],
        nodes: [{ id: "n-field", source_refs: ["ev-icon"] }],
        mentions: [{ id: "m1", target_id: "n-field", source_refs: ["ev-icon"] }],
        domain_profiles: [{ id: "p1", node_id: "n-field", source_refs: ["ev-icon"] }],
        node_cards: [{ id: "c1", node_id: "n-field", source_refs: ["ev-icon"], sections: [{ id: "definition", source_refs: ["ev-icon"] }] }],
        counts: { evidence: 2, mentions: 1, edges: 0, domain_profiles: 1, node_cards: 1 },
        issues: [],
      },
      {
        repoRoot: repo.root,
        vlmApiUrl: "http://localhost:8000/v1",
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: unknown }> };
          const serialized = JSON.stringify(body);
          const keep = serialized.includes("ev-text");
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      keep,
                      relevance: keep ? "core_content" : "decorative",
                      reason: keep ? "文字证据保留。" : "只是栏目装饰。",
                      confidence: 0.93,
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
    );

    assert.deepEqual(result.dropped_evidence_ids, ["ev-icon"]);
    assert.deepEqual((result.payload.nodes as Array<Record<string, unknown>>)[0]?.source_refs, ["ev-text"]);
    assert.deepEqual((result.payload.mentions as Array<Record<string, unknown>>)[0]?.source_refs, ["ev-text"]);
    assert.deepEqual((result.payload.domain_profiles as Array<Record<string, unknown>>)[0]?.source_refs, ["ev-text"]);
    assert.deepEqual((result.payload.node_cards as Array<Record<string, unknown>>)[0]?.source_refs, ["ev-text"]);
    assert.deepEqual(((result.payload.node_cards as Array<Record<string, unknown>>)[0]?.sections as Array<Record<string, unknown>>)[0]?.source_refs, ["ev-text"]);
    assert.equal((result.payload.counts as Record<string, unknown>).mentions, 1);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("parses VLM JSON when providers wrap it in a Markdown code fence", async () => {
  const repo = makeImageFixture();
  try {
    const result = await filterImageEvidencePayload(
      {
        evidence: [imageEvidence("ev-code-fence", "![教材图片](images/unknown.png)", "line:3", "images/unknown.png")],
        mentions: [],
        edges: [],
        domain_profiles: [],
        node_cards: [],
        counts: { evidence: 1, mentions: 0, edges: 0, domain_profiles: 0, node_cards: 0 },
        issues: [],
      },
      {
        repoRoot: repo.root,
        vlmApiUrl: "http://localhost:8000/v1",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: [
                      "```json",
                      JSON.stringify({ keep: true, relevance: "supporting", reason: "支持正文说明。", confidence: 0.8 }, null, 2),
                      "```",
                    ].join("\n"),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
    );

    assert.equal(result.decisions["ev-code-fence"]?.source, "vlm");
    assert.equal(result.decisions["ev-code-fence"]?.relevance, "supporting");
    assert.equal((result.payload.evidence as unknown[]).length, 1);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("does not keep core-looking image labels without VLM review", async () => {
  const repo = makeImageFixture();
  let called = false;
  try {
    const result = await filterImageEvidencePayload(
      {
        evidence: [imageEvidence("ev-core-label", "![分子结构示意图](images/unknown.png)", "line:4", "images/unknown.png")],
        mentions: [],
        edges: [],
        domain_profiles: [],
        node_cards: [],
        counts: { evidence: 1, mentions: 0, edges: 0, domain_profiles: 0, node_cards: 0 },
        issues: [],
      },
      {
        repoRoot: repo.root,
        vlmApiUrl: "http://localhost:8000/v1",
        fetchImpl: async () => {
          called = true;
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      keep: true,
                      relevance: "core_content",
                      reason: "确实是知识内容图。",
                      confidence: 0.91,
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
    );

    assert.equal(called, true);
    assert.equal(result.decisions["ev-core-label"]?.source, "vlm");
    assert.equal(result.decisions["ev-core-label"]?.relevance, "core_content");
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("runs image VLM checks with bounded concurrency", async () => {
  const repo = makeImageFixture();
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  try {
    await filterImageEvidencePayload(
      {
        evidence: Array.from({ length: 4 }, (_, index) => imageEvidence(`ev-${index}`, `![](images/unknown.png)`, `line:${index}`, "images/unknown.png")),
        mentions: [],
        edges: [],
        domain_profiles: [],
        node_cards: [],
        counts: { evidence: 4, mentions: 0, edges: 0, domain_profiles: 0, node_cards: 0 },
        issues: [],
      },
      {
        repoRoot: repo.root,
        vlmApiUrl: "http://localhost:8000/v1",
        vlmConcurrency: 2,
        fetchImpl: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          calls += 1;
          await delay(20);
          active -= 1;
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      keep: true,
                      relevance: "supporting",
                      reason: "可作为辅助图片。",
                      confidence: 0.82,
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
    );

    assert.equal(calls, 4);
    assert.equal(maxActive, 2);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("reuses cached VLM decisions for the same image and prompt", async () => {
  const repo = makeImageFixture();
  let calls = 0;
  const payload = {
    evidence: [imageEvidence("ev-cache", "![](images/unknown.png)", "line:3", "images/unknown.png")],
    mentions: [],
    edges: [],
    domain_profiles: [],
    node_cards: [],
    counts: { evidence: 1, mentions: 0, edges: 0, domain_profiles: 0, node_cards: 0 },
    issues: [],
  };
  try {
    const first = await filterImageEvidencePayload(payload, {
      repoRoot: repo.root,
      vlmApiUrl: "http://localhost:8000/v1",
      vlmCacheDir: join(repo.root, ".cache", "image-relevance"),
      fetchImpl: async () => {
        calls += 1;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    keep: true,
                    relevance: "core_content",
                    reason: "缓存前的 VLM 判断。",
                    confidence: 0.91,
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    const second = await filterImageEvidencePayload(payload, {
      repoRoot: repo.root,
      vlmApiUrl: "http://localhost:8000/v1",
      vlmCacheDir: join(repo.root, ".cache", "image-relevance"),
      fetchImpl: async () => {
        throw new Error("cache miss");
      },
    });

    assert.equal(calls, 1);
    assert.equal(first.decisions["ev-cache"]?.relevance, "core_content");
    assert.equal(second.decisions["ev-cache"]?.source, "vlm");
    assert.equal(second.decisions["ev-cache"]?.reason, "缓存前的 VLM 判断。");
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function imageEvidence(id: string, excerpt: string, locator: string, path: string): Record<string, unknown> {
  return {
    id,
    source_type: "textbook",
    source_id: "book",
    anchor_ref: "lesson",
    source_path: "data/mineru/book/full.md",
    excerpt,
    locator,
    modality: "image",
    extraction_method: "markdown_hint",
    normalized_claims: [excerpt],
    properties: path ? { path, caption: excerpt.replace(/!\[([^\]]*)\].*/, "$1") } : {},
  };
}

function textEvidence(id: string, excerpt: string): Record<string, unknown> {
  return {
    id,
    source_type: "textbook",
    source_id: "book",
    anchor_ref: "lesson",
    source_path: "data/mineru/book/full.md",
    excerpt,
    locator: "line:1",
    modality: "text",
    extraction_method: "openai_responses",
    normalized_claims: [excerpt],
    properties: {},
  };
}

function makeImageFixture(): { root: string } {
  const root = mkdtempSync(join(tmpdir(), "okm-image-relevance-"));
  const imageDir = join(root, "data", "mineru", "book", "images");
  mkdirSync(imageDir, { recursive: true });
  writeFileSync(join(root, "data", "mineru", "book", "full.md"), "# lesson\n");
  writeFileSync(join(imageDir, "think.png"), pngHeader(220, 170));
  writeFileSync(join(imageDir, "unknown.png"), pngHeader(220, 170));
  return { root };
}

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt8(0x89, 0);
  buffer.write("PNG", 1, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}
