import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  VALID_DOMAINS,
  VALID_EDGE_TYPES,
  VALID_KNOWLEDGE_FORMS,
  VALID_LEARNING_MODES,
  VALID_NODE_KINDS,
} from "../shared/knowledge.js";
import {
  REPO_ROOT,
  iterOutlineItems,
  makeDomainProfileId,
  makeEdgeId,
  makeLessonRunId,
  makeNodeCardId,
  normalizeTerm,
  safePathToken,
  type OutlineItem,
} from "../shared/pathing.js";
import { resolveOutlineAnchorFromItems } from "./parallel-batch.js";

type RawRecord = Record<string, unknown>;

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "gpt-4.1";
export const DEFAULT_OPENAI_TIMEOUT_MS = 180_000;

export type ModelApiMode = "responses" | "chat_completions";
export type ModelExtractionStrategy = "single_pass" | "hybrid";

export type MarkdownEvidenceHint = {
  modality: "image" | "table" | "equation";
  locator: string;
  excerpt: string;
  caption?: string;
  path?: string;
};

export type ModelLessonContext = {
  book_id: string;
  textbook_id: string;
  batch_anchor: string;
  lesson_run_id: string;
  lesson_title: unknown;
  subject: string;
  school_stage: string;
  grade_band: string;
  page_start: unknown;
  page_end: unknown;
  source_path: string;
  markdown_excerpt_preview: string;
  retrieval_candidates: RawRecord[];
  markdown_evidence_hints: MarkdownEvidenceHint[];
};

export type ModelLessonPayload = {
  lesson_context: ModelLessonContext;
  markdown_lines: string[];
};

export type BuildModelLessonPayloadInput = {
  bookId: string;
  batchAnchor: string;
  repoRoot?: string;
  outline?: RawRecord;
  markdownLines?: string[];
  retrievalCandidates?: RawRecord[];
  textbookId?: string;
  subject?: string;
  schoolStage?: string;
  gradeBand?: string;
};

export type BuildModelExtractionRequestInput = BuildModelLessonPayloadInput & {
  apiMode?: ModelApiMode;
  baseUrl?: string;
  model?: string;
  prompt?: string;
  reasoningEffort?: string;
  timeoutMs?: number;
};

export type ModelExtractionRequest = {
  api_mode: ModelApiMode;
  endpoint: string;
  timeout_ms: number;
  instructions: string;
  user_payload: string;
  body: RawRecord;
};

export type ModelBundle = {
  nodes?: RawRecord[];
  edges?: RawRecord[];
  evidence_units?: RawRecord[];
  domain_profiles?: RawRecord[];
  node_cards?: RawRecord[];
  issues?: unknown[];
};

export type HybridNodeEvidenceBundle = Pick<ModelBundle, "nodes" | "evidence_units" | "issues">;
export type HybridEdgeBundle = Pick<ModelBundle, "edges" | "issues">;

export type ExtractionPayload = {
  status: "success";
  lesson_run_id: string;
  book_id: string;
  batch_anchor: string;
  nodes: RawRecord[];
  edges: RawRecord[];
  domain_profiles: RawRecord[];
  mentions: RawRecord[];
  evidence: RawRecord[];
  node_cards: RawRecord[];
  counts: {
    nodes: number;
    edges: number;
    domain_profiles: number;
    mentions: number;
    evidence: number;
    node_cards: number;
  };
  issues: string[];
};

export function buildModelLessonPayload(input: BuildModelLessonPayloadInput): ModelLessonPayload {
  const { item, markdownLines, outline, anchorRef } = sliceMarkdownForModelLesson(input);
  return {
    lesson_context: {
      book_id: input.bookId,
      textbook_id: input.textbookId || input.bookId,
      batch_anchor: anchorRef,
      lesson_run_id: makeLessonRunId(input.bookId, anchorRef),
      lesson_title: item.title ?? "",
      subject: input.subject ?? "computer-science",
      school_stage: input.schoolStage ?? "higher",
      grade_band: input.gradeBand ?? "university",
      page_start: item.page_start,
      page_end: item.page_end,
      source_path: stringValue(outline.source_path),
      markdown_excerpt_preview: makeExcerpt(markdownLines),
      retrieval_candidates: input.retrievalCandidates ?? [],
      markdown_evidence_hints: extractMarkdownEvidenceHints(markdownLines),
    },
    markdown_lines: markdownLines,
  };
}

export function buildSystemInstructions(input: { prompt?: string } = {}): string {
  const base = `
你是 Open Knowledge Map 项目的专用教材知识抽取器。
任务是为当前单个 lesson/chunk 生成统一世界知识标准下的结构化候选。

硬约束：
1. 只处理当前一个 lesson/chunk。
2. 先证据后知识对象：每个节点和关系都必须能落到当前 lesson 的 evidence anchor。
3. 不要把章节编号、复习题、术语表、小结当成正式知识节点。
4. 节点主类只能使用 9 类：entity/concept/property/process/event/method/rule/representation/resource。
5. tag 只是辅助检索，不承担主分类；主分类靠 kind、domain、relation。
6. 关系只允许使用 schema 合法 type，证据不足就不要编造。
7. 输出必须严格符合 JSON schema。

主类判断：
- entity：具体对象、物质、人物、地点、设备、样本。
- concept：抽象概念、理论对象、学科核心术语。
- property：性质、属性、状态量、可观测特征。
- process：连续过程、机制、变化过程。
- event：具有时间边界的事件或历史事实。
- method：步骤、算法、实验方法、操作技能。
- rule：定律、规则、公式、原则、约束。
- representation：图、表、模型、符号、方程、示意图。
- resource：资料、文本、工具、数据集、媒介资源。

关系判断：
- is_a 用于类属关系；instance_of 用于具体实例属于某类。
- part_of/contains 用于组成和包含。
- has_property 用于对象具有属性。
- uses/produces 用于方法或过程使用、产出某对象。
- depends_on/prerequisite_for 用于依赖和先修。
- causes/affects 用于因果和影响。
- represents/about 用于表示对象和论述主题。
- same_as 只用于高度确定的同一对象；不确定时用 related_to。

	学习维度判断：
	- factual：事实、名称、符号、具体信息。
	- conceptual：概念、分类、原理、结构关系。
	- procedural：步骤、算法、实验操作、解题方法。
	- metacognitive：策略选择、反思、认知监控。

	语义核心：
	- 节点的 definition 保持短定义，只回答“它是什么”。
	- 如果当前证据支持更完整信息，放入 node.properties.semantic_core。
	- semantic_core 可以包含 core_claims、formal_expressions、conditions、boundaries、counterexamples、misconceptions。
	- 没有证据支撑的公式、边界、反例、常见误解不要补。

	教学画像：
	- domain_profiles 只描述该知识对象在具体领域和学段中的教学投影。
	- school_stages 和 curriculum_roles 说明教学位置。
	- 如果当前证据能支持学习目标、难度、诊断题、常见错误、评价任务，放入 domain_profiles.properties.pedagogical_profile。
	- pedagogical_profile 可以包含 learning_objectives、difficulty_level、diagnostic_questions、common_errors、assessment_tasks、remediation_suggestions、extension_suggestions。
	`.trim();
  const prompt = input.prompt?.trim();
  return prompt ? `${base}\n\n补充项目提示：\n${prompt}` : base;
}

export function buildModelExtractionRequest(input: BuildModelExtractionRequestInput): ModelExtractionRequest {
  const apiMode = input.apiMode ?? "responses";
  const baseUrl = (input.baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
  const instructions = buildSystemInstructions({ prompt: input.prompt });
  const userPayload = JSON.stringify(buildModelLessonPayload(input), null, 2);
  const model = input.model ?? DEFAULT_OPENAI_MODEL;
  const schema = buildResponseSchema();
  const body =
    apiMode === "responses"
      ? buildResponsesBody(model, instructions, userPayload, schema, input.reasoningEffort)
      : buildChatCompletionsBody(model, instructions, userPayload, schema, input.reasoningEffort);

  return {
    api_mode: apiMode,
    endpoint: `${baseUrl}/${apiMode === "responses" ? "responses" : "chat/completions"}`,
    timeout_ms: input.timeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS,
    instructions,
    user_payload: userPayload,
    body,
  };
}

export function buildHybridNodeEvidenceExtractionRequest(input: BuildModelExtractionRequestInput): ModelExtractionRequest {
  return buildSchemaBackedExtractionRequest(input, {
    instructions: buildHybridNodeEvidenceInstructions({ prompt: input.prompt }),
    userPayload: JSON.stringify(buildModelLessonPayload(input), null, 2),
    schema: buildHybridNodeEvidenceResponseSchema(),
  });
}

export function buildHybridEdgeExtractionRequest(
  input: BuildModelExtractionRequestInput,
  nodeEvidenceBundle: HybridNodeEvidenceBundle,
): ModelExtractionRequest {
  const lessonPayload = buildModelLessonPayload(input);
  const normalized = normalizeHybridNodeEvidenceBundle(nodeEvidenceBundle);
  const userPayload = JSON.stringify(
    {
      lesson_context: lessonPayload.lesson_context,
      allowed_edge_types: sortedSet(VALID_EDGE_TYPES),
      candidate_nodes: normalized.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        kind: node.kind,
        aliases: node.aliases,
        definition: node.definition,
      })),
      evidence_units: normalized.evidence_units.map((evidence) => ({
        anchor: evidence.anchor,
        excerpt: evidence.excerpt,
        locator: evidence.locator,
        modality: evidence.modality,
        node_ids: evidence.node_ids,
      })),
    },
    null,
    2,
  );
  return buildSchemaBackedExtractionRequest(input, {
    instructions: buildHybridEdgeInstructions({ prompt: input.prompt }),
    userPayload,
    schema: buildHybridEdgeResponseSchema(),
  });
}

export function buildHybridExtractionPayloadFromModelResponses(
  input: BuildModelLessonPayloadInput,
  nodeEvidenceBody: RawRecord,
  edgeBody: RawRecord,
): ExtractionPayload {
  return buildHybridExtractionPayloadFromModelBundles(
    input,
    parseHybridNodeEvidenceBundleFromResponse(nodeEvidenceBody),
    parseHybridEdgeBundleFromResponse(edgeBody),
  );
}

export function buildHybridExtractionPayloadFromModelBundles(
  input: BuildModelLessonPayloadInput,
  nodeEvidenceBundle: HybridNodeEvidenceBundle,
  edgeBundle: HybridEdgeBundle,
): ExtractionPayload {
  const bundle = buildStrictHybridModelBundle(nodeEvidenceBundle, edgeBundle);
  return buildExtractionPayloadFromModelBundle(input, bundle);
}

function buildSchemaBackedExtractionRequest(
  input: BuildModelExtractionRequestInput,
  options: { instructions: string; userPayload: string; schema: RawRecord },
): ModelExtractionRequest {
  const apiMode = input.apiMode ?? "responses";
  const baseUrl = (input.baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
  const model = input.model ?? DEFAULT_OPENAI_MODEL;
  const body =
    apiMode === "responses"
      ? buildResponsesBody(model, options.instructions, options.userPayload, options.schema, input.reasoningEffort)
      : buildChatCompletionsBody(model, options.instructions, options.userPayload, options.schema, input.reasoningEffort);

  return {
    api_mode: apiMode,
    endpoint: `${baseUrl}/${apiMode === "responses" ? "responses" : "chat/completions"}`,
    timeout_ms: input.timeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS,
    instructions: options.instructions,
    user_payload: options.userPayload,
    body,
  };
}

function buildHybridNodeEvidenceInstructions(input: { prompt?: string } = {}): string {
  const base = `
你是 Open Knowledge Map 项目的第一阶段教材知识抽取器。
任务是只从当前 lesson/chunk 中抽取证据和候选知识节点。

硬约束：
1. 只输出 nodes、evidence_units、issues 三个字段。
2. 这一阶段绝对不要输出关系；关系会在第二阶段单独判断。
3. 每个节点必须能被当前 lesson 的 evidence_units 支撑，证据不足就不要列为节点。
4. evidence_units.anchor 必须稳定、简短、唯一，例如 ev1、ev2。
5. node.id 必须稳定、唯一，后续关系阶段会直接引用这些 id。
6. 节点主类只能使用 9 类：entity/concept/property/process/event/method/rule/representation/resource。
7. 不要把章节编号、复习题、术语表、小结当成正式知识节点。
8. 输出必须严格符合 JSON schema。
  `.trim();
  const prompt = input.prompt?.trim();
  return prompt ? `${base}\n\n补充项目提示：\n${prompt}` : base;
}

function buildHybridEdgeInstructions(input: { prompt?: string } = {}): string {
  const base = `
你是 Open Knowledge Map 项目的第二阶段关系抽取器。
任务是只根据第一阶段给出的 candidate_nodes 和 evidence_units 判断关系。

硬约束：
1. 只输出 edges、issues 两个字段。
2. 不要新增节点，不要改写节点 id，不要新增证据。
3. edge.from 和 edge.to 必须来自 candidate_nodes.id。
4. edge.evidence_anchor 必须完全等于 evidence_units.anchor 中的一个值。
5. 关系 type 只能来自 allowed_edge_types。
6. 如果证据不能直接支持关系，就不要输出该关系。
7. 优先抽取教材明确表达的类属、组成、性质、因果、依赖、表示、使用、产出关系。
8. 输出必须严格符合 JSON schema，不要解释。
  `.trim();
  const prompt = input.prompt?.trim();
  return prompt ? `${base}\n\n补充项目提示：\n${prompt}` : base;
}

export async function callModelExtractionRequest(
  request: ModelExtractionRequest,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RawRecord> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeout_ms);
  try {
    const response = await fetchImpl(request.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI request failed with ${response.status}: ${text}`);
    }
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) throw new Error("OpenAI response must be a JSON object.");
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildResponseSchema(): RawRecord {
  const stringList = {
    type: "array",
    items: { type: "string" },
  };
  const semanticCore = {
    type: "object",
    additionalProperties: true,
    properties: {
      core_claims: stringList,
      formal_expressions: stringList,
      conditions: stringList,
      boundaries: stringList,
      counterexamples: stringList,
      misconceptions: stringList,
    },
  };
  const pedagogicalProfile = {
    type: "object",
    additionalProperties: true,
    properties: {
      learning_objectives: stringList,
      difficulty_level: { type: "string", enum: ["introductory", "basic", "intermediate", "advanced", "expert"] },
      diagnostic_questions: stringList,
      common_errors: stringList,
      assessment_tasks: stringList,
      remediation_suggestions: stringList,
      extension_suggestions: stringList,
    },
  };
  const nodeItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      kind: { type: "string", enum: sortedSet(VALID_NODE_KINDS) },
      subkind: { type: ["string", "null"] },
      definition: { type: "string" },
      aliases: { type: "array", items: { type: "string" } },
      domains: { type: "array", items: { type: "string", enum: sortedSet(VALID_DOMAINS) } },
      knowledge_form: { type: "array", items: { type: "string", enum: sortedSet(VALID_KNOWLEDGE_FORMS) } },
      learning_mode: { type: "array", items: { type: "string", enum: sortedSet(VALID_LEARNING_MODES) } },
      scope: { type: "string", enum: ["universal", "domain-specific", "culture-specific"] },
      properties: {
        type: "object",
        additionalProperties: true,
        properties: {
          semantic_core: semanticCore,
        },
      },
      external_ids: { type: "object", additionalProperties: { type: "string" } },
      tags: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
    },
    required: [
      "id",
      "name",
      "kind",
      "subkind",
      "definition",
      "domains",
      "knowledge_form",
      "learning_mode",
      "scope",
      "properties",
      "external_ids",
      "tags",
      "notes",
    ],
  };
  const edgeItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      from: { type: "string" },
      to: { type: "string" },
      type: { type: "string", enum: sortedSet(VALID_EDGE_TYPES) },
      directionality: { type: "string", enum: ["directed", "undirected"] },
      confidence: { type: "number" },
      evidence_anchor: { type: "string" },
      notes: { type: "string" },
    },
    required: ["from", "to", "type", "directionality", "confidence", "evidence_anchor", "notes"],
  };
  const evidenceItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      anchor: { type: "string" },
      excerpt: { type: "string" },
      locator: { type: "string" },
      modality: { type: "string", enum: ["text", "image", "table", "equation"] },
      node_ids: { type: "array", items: { type: "string" } },
    },
    required: ["anchor", "excerpt", "locator", "modality", "node_ids"],
  };
  const domainProfileItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      node_id: { type: "string" },
      domain: { type: "string", enum: sortedSet(VALID_DOMAINS) },
      school_stages: { type: "array", items: { type: "string" } },
      curriculum_roles: { type: "array", items: { type: "string" } },
      properties: {
        type: "object",
        additionalProperties: true,
        properties: {
          pedagogical_profile: pedagogicalProfile,
        },
      },
    },
    required: ["node_id", "domain", "school_stages", "curriculum_roles", "properties"],
  };
  const cardItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      node_id: { type: "string" },
      summary: { type: "string" },
      definition: { type: "string" },
      essence: { type: "string" },
      key_points: { type: "array", items: { type: "string" } },
      example: { type: "string" },
      application: { type: "string" },
      misconception: { type: "string" },
      evidence_anchor: { type: "string" },
    },
    required: ["node_id", "summary", "definition", "essence", "key_points", "example", "application", "misconception", "evidence_anchor"],
  };
  return {
    name: "world_knowledge_lesson_bundle",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        nodes: { type: "array", items: nodeItem },
        edges: { type: "array", items: edgeItem },
        evidence_units: { type: "array", items: evidenceItem },
        domain_profiles: { type: "array", items: domainProfileItem },
        node_cards: { type: "array", items: cardItem },
        issues: { type: "array", items: { type: "string" } },
      },
      required: ["nodes", "edges", "evidence_units", "domain_profiles", "node_cards", "issues"],
    },
  };
}

export function buildHybridNodeEvidenceResponseSchema(): RawRecord {
  const properties = responseSchemaProperties();
  return {
    name: "world_knowledge_node_evidence_bundle",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        nodes: properties.nodes,
        evidence_units: properties.evidence_units,
        issues: properties.issues,
      },
      required: ["nodes", "evidence_units", "issues"],
    },
  };
}

export function buildHybridEdgeResponseSchema(): RawRecord {
  const properties = responseSchemaProperties();
  return {
    name: "world_knowledge_edge_bundle",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        edges: properties.edges,
        issues: properties.issues,
      },
      required: ["edges", "issues"],
    },
  };
}

function responseSchemaProperties(): RawRecord {
  const schema = recordValue(recordValue(buildResponseSchema().schema).properties);
  return schema;
}

export function extractTextOutput(body: RawRecord): string {
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const firstChoice = choices[0];
  if (isRecord(firstChoice) && isRecord(firstChoice.message) && typeof firstChoice.message.content === "string" && firstChoice.message.content.trim()) {
    return firstChoice.message.content;
  }

  const output = Array.isArray(body.output) ? body.output : [];
  for (const message of output) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const content of message.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  throw new Error("Responses API returned no output_text payload.");
}

export function parseModelBundleFromResponse(body: RawRecord): ModelBundle {
  const parsed = parseJsonObjectFromText(extractTextOutput(body));
  if (!isRecord(parsed)) throw new Error("Model output must be a JSON object.");
  return parsed as ModelBundle;
}

export function parseHybridNodeEvidenceBundleFromResponse(body: RawRecord): HybridNodeEvidenceBundle {
  const parsed = parseJsonObjectFromText(extractTextOutput(body));
  if (!isRecord(parsed)) throw new Error("Hybrid node/evidence output must be a JSON object.");
  return parsed as HybridNodeEvidenceBundle;
}

export function parseHybridEdgeBundleFromResponse(body: RawRecord): HybridEdgeBundle {
  const parsed = parseJsonValueFromText(extractTextOutput(body));
  if (Array.isArray(parsed)) {
    return { edges: parsed.filter(isRecord), issues: ["Model returned a bare JSON array instead of the requested edge object."] };
  }
  if (!isRecord(parsed)) throw new Error("Hybrid edge output must be a JSON object or edge array.");
  return parsed as HybridEdgeBundle;
}

function parseJsonObjectFromText(text: string): RawRecord {
  const trimmed = text.trim();
  const candidates = [trimmed];
  for (const block of extractFencedBlocks(trimmed)) {
    candidates.push(block);
  }
  for (const objectText of extractBalancedJsonObjects(trimmed)) {
    candidates.push(objectText);
  }

  const errors: string[] = [];
  for (const candidate of uniqueStable(candidates.filter(Boolean))) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRecord(parsed)) return parsed;
      errors.push("parsed JSON was not an object");
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  throw new Error(`Model output must be a JSON object: ${errors[0] ?? "empty output"}`);
}

function parseJsonValueFromText(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  for (const block of extractFencedBlocks(trimmed)) {
    candidates.push(block);
  }
  for (const arrayText of extractBalancedJsonArrays(trimmed)) {
    candidates.push(arrayText);
  }
  for (const objectText of extractBalancedJsonObjects(trimmed)) {
    candidates.push(objectText);
  }

  const errors: string[] = [];
  for (const candidate of uniqueStable(candidates.filter(Boolean))) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  throw new Error(`Model output must contain JSON: ${errors[0] ?? "empty output"}`);
}

function extractFencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const pattern = /```[ \t]*(?:json)?[^\n\r`]*[\r\n]+([\s\S]*?)```/gi;
  for (const match of text.matchAll(pattern)) {
    const block = match[1]?.trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

function extractBalancedJsonObjects(text: string): string[] {
  const objects: string[] = [];
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    const end = findBalancedJsonValueEnd(text, start, "{", "}");
    if (end >= 0) objects.push(text.slice(start, end + 1).trim());
  }
  return objects;
}

function extractBalancedJsonArrays(text: string): string[] {
  const arrays: string[] = [];
  for (let start = text.indexOf("["); start >= 0; start = text.indexOf("[", start + 1)) {
    const end = findBalancedJsonValueEnd(text, start, "[", "]");
    if (end >= 0) arrays.push(text.slice(start, end + 1).trim());
  }
  return arrays;
}

function findBalancedJsonValueEnd(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function uniqueStable(values: Iterable<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function buildExtractionPayloadFromModelResponse(input: BuildModelLessonPayloadInput, body: RawRecord): ExtractionPayload {
  return buildExtractionPayloadFromModelBundle(input, parseModelBundleFromResponse(body));
}

function buildStrictHybridModelBundle(nodeEvidenceBundle: HybridNodeEvidenceBundle, edgeBundle: HybridEdgeBundle): ModelBundle {
  const normalized = normalizeHybridNodeEvidenceBundle(nodeEvidenceBundle);
  const nodeIds = new Set(normalized.nodes.map((node) => stringValue(node.id)).filter(Boolean));
  const evidenceAnchors = new Set(normalized.evidence_units.map((evidence) => stringValue(evidence.anchor)).filter(Boolean));
  const edges: RawRecord[] = [];
  const seenEdges = new Set<string>();
  let droppedEdges = 0;

  for (const raw of asRecords(edgeBundle.edges)) {
    const from = stringValue(raw.from || raw.source || raw.source_id).trim();
    const to = stringValue(raw.to || raw.target || raw.target_id).trim();
    const type = stringValue(raw.type || raw.relation || raw.predicate).trim();
    const evidenceAnchor = stringValue(raw.evidence_anchor || raw.anchor || raw.evidence).trim();
    if (!nodeIds.has(from) || !nodeIds.has(to) || !VALID_EDGE_TYPES.has(type) || !evidenceAnchors.has(evidenceAnchor)) {
      droppedEdges += 1;
      continue;
    }

    const edgeKey = `${from}\u0000${type}\u0000${to}\u0000${evidenceAnchor}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    edges.push({
      from,
      to,
      type,
      directionality: stringValue(raw.directionality || "directed"),
      confidence: numberOrDefault(raw.confidence, 0.8),
      evidence_anchor: evidenceAnchor,
      notes: stringValue(raw.notes).trim(),
    });
  }

  return {
    nodes: normalized.nodes,
    evidence_units: normalized.evidence_units,
    edges,
    domain_profiles: [],
    node_cards: [],
    issues: trimmedStrings(nodeEvidenceBundle.issues).concat(
      trimmedStrings(edgeBundle.issues),
      normalized.issues,
      droppedEdges > 0
        ? [`Strict hybrid validator dropped ${droppedEdges} edge(s) with missing node ids, invalid relation types, or missing evidence anchors.`]
        : [],
    ),
  };
}

function normalizeHybridNodeEvidenceBundle(bundle: HybridNodeEvidenceBundle): {
  nodes: RawRecord[];
  evidence_units: RawRecord[];
  issues: string[];
} {
  const issues: string[] = [];
  const nodes: RawRecord[] = [];
  const seenNodeIds = new Set<string>();

  for (const raw of asRecords(bundle.nodes)) {
    const id = stringValue(raw.id || raw.node_id).trim();
    if (!id || seenNodeIds.has(id)) continue;
    const name = stringValue(raw.name || raw.label || raw.title || raw.term).trim();
    if (!name) {
      issues.push(`Hybrid stage 1 dropped node '${id}' because it had no name.`);
      continue;
    }

    const kind = validOrDefault(stringValue(raw.kind || raw.node_kind).trim(), VALID_NODE_KINDS, "concept");
    if (kind !== stringValue(raw.kind || raw.node_kind).trim()) {
      issues.push(`Hybrid stage 1 normalized node kind for ${id}.`);
    }
    seenNodeIds.add(id);
    nodes.push({
      id,
      name,
      kind,
      subkind: raw.subkind ?? null,
      definition: stringValue(raw.definition || raw.description || name).trim(),
      aliases: trimmedStrings(raw.aliases),
      domains: validListOrDefault(raw.domains ?? raw.domain, VALID_DOMAINS, "general"),
      knowledge_form: validListOrDefault(raw.knowledge_form, VALID_KNOWLEDGE_FORMS, "propositional"),
      learning_mode: validListOrDefault(raw.learning_mode ?? raw.learning_dimension, VALID_LEARNING_MODES, "conceptual"),
      scope: validOrDefault(stringValue(raw.scope).trim(), new Set(["universal", "domain-specific", "culture-specific"]), "domain-specific"),
      properties: recordValue(raw.properties),
      external_ids: recordValue(raw.external_ids),
      tags: trimmedStrings(raw.tags),
      notes: stringValue(raw.notes).trim(),
    });
  }

  const nodeIds = new Set(nodes.map((node) => stringValue(node.id)));
  const evidenceUnits: RawRecord[] = [];
  const seenEvidenceAnchors = new Set<string>();
  for (const [zeroIndex, raw] of asRecords(bundle.evidence_units).entries()) {
    const fallbackAnchor = `ev${zeroIndex + 1}`;
    const anchor = stringValue(raw.anchor || raw.evidence_anchor || raw.id || fallbackAnchor).trim();
    const excerpt = stringValue(raw.excerpt || raw.quote || raw.text).trim();
    if (!anchor || !excerpt || seenEvidenceAnchors.has(anchor)) continue;
    seenEvidenceAnchors.add(anchor);
    evidenceUnits.push({
      anchor,
      excerpt,
      locator: stringValue(raw.locator || raw.source_locator || raw.location || "lesson-chunk").trim(),
      modality: validOrDefault(stringValue(raw.modality || "text").trim(), new Set(["text", "image", "table", "equation"]), "text"),
      node_ids: trimmedStrings(raw.node_ids).filter((nodeId) => nodeIds.has(nodeId)),
    });
  }

  return {
    nodes,
    evidence_units: evidenceUnits,
    issues,
  };
}

export function buildExtractionPayloadFromModelBundle(input: BuildModelLessonPayloadInput, bundle: ModelBundle): ExtractionPayload {
  const { item, markdownLines, outline, anchorRef } = sliceMarkdownForModelLesson(input);
  const sourceId = input.textbookId || input.bookId;
  const sourcePath = stringValue(outline.source_path);
  const lessonRunId = makeLessonRunId(input.bookId, anchorRef);
  const subject = input.subject ?? "computer-science";
  const schoolStage = input.schoolStage ?? "higher";
  const gradeBand = input.gradeBand ?? "university";

  const nodes: RawRecord[] = [];
  const nodeIds = new Set<string>();
  const normalizationIssues: string[] = [];
  for (const raw of asRecords(bundle.nodes)) {
    const rawId = stringValue(raw.id).trim();
    const rawName = stringValue(raw.name).trim();
    const rawDefinition = stringValue(raw.definition).trim();
    const inferredName = inferNodeName(rawId, rawName, rawDefinition, raw);
    if (!rawId || !inferredName) {
      normalizationIssues.push(`Dropped model node with missing id/name: ${JSON.stringify({ id: rawId, name: rawName })}`);
      continue;
    }
    const node = {
      id: rawId,
      name: inferredName,
      kind: stringValue(raw.kind).trim(),
      subkind: raw.subkind ?? null,
      definition: rawDefinition || inferredName,
      aliases: trimmedStrings(raw.aliases),
      domains: trimmedStrings(raw.domains).length > 0 ? trimmedStrings(raw.domains) : ["general"],
      knowledge_form: trimmedStrings(raw.knowledge_form).length > 0 ? trimmedStrings(raw.knowledge_form) : ["propositional"],
      learning_mode: trimmedStrings(raw.learning_mode).length > 0 ? trimmedStrings(raw.learning_mode) : ["conceptual"],
      scope: stringValue(raw.scope || "domain-specific"),
      properties: recordValue(raw.properties),
      external_ids: recordValue(raw.external_ids),
      tags: trimmedStrings(raw.tags),
      notes: stringValue(raw.notes).trim(),
      status: "draft",
      source_refs: [],
    };
    if (!rawName) normalizationIssues.push(`Backfilled missing name for model node ${rawId}.`);
    if (!rawDefinition) normalizationIssues.push(`Backfilled empty definition for model node ${rawId}.`);
    if (nodeIds.has(node.id)) continue;
    nodeIds.add(node.id);
    nodes.push(node);
  }

  const evidence: RawRecord[] = [];
  const evidenceByAnchor = new Map<string, string>();
  for (const [zeroIndex, raw] of asRecords(bundle.evidence_units).entries()) {
    const index = zeroIndex + 1;
    const anchor = stringValue(raw.anchor).trim();
    const excerpt = stringValue(raw.excerpt).trim();
    if (!anchor || !excerpt) continue;
    const evidenceId = `evidence:${safePathToken(input.bookId)}:${index}`;
    evidenceByAnchor.set(anchor, evidenceId);
    evidence.push({
      id: evidenceId,
      source_type: "textbook",
      source_id: sourceId,
      anchor_ref: anchorRef,
      source_path: sourcePath,
      page_start: item.page_start,
      page_end: item.page_end,
      excerpt,
      locator: stringValue(raw.locator).trim(),
      modality: stringValue(raw.modality || "text"),
      extraction_method: "openai_responses",
      normalized_claims: [excerpt.slice(0, 120)],
      properties: {},
    });
  }

  const hintStartIndex = evidence.length + 1;
  for (const [offset, hint] of extractMarkdownEvidenceHints(markdownLines).entries()) {
    const excerpt = hint.excerpt.trim();
    if (!excerpt) continue;
    const evidenceId = `evidence:${safePathToken(input.bookId)}:hint:${hintStartIndex + offset}`;
    evidence.push({
      id: evidenceId,
      source_type: "textbook",
      source_id: sourceId,
      anchor_ref: anchorRef,
      source_path: sourcePath,
      page_start: item.page_start,
      page_end: item.page_end,
      excerpt,
      locator: hint.locator.trim(),
      modality: hint.modality,
      extraction_method: "markdown_hint",
      normalized_claims: [excerpt.slice(0, 120)],
      properties: Object.fromEntries(Object.entries(hint).filter(([key]) => !["excerpt", "locator", "modality"].includes(key))),
    });
  }

  if (nodes.length > 0 && evidence.length === 0) {
    const backfillExcerpt = makeExcerpt(markdownLines, 600);
    const excerpt = backfillExcerpt || stringValue(item.title || anchorRef);
    evidence.push({
      id: `evidence:${safePathToken(input.bookId)}:backfill:1`,
      source_type: "textbook",
      source_id: sourceId,
      anchor_ref: anchorRef,
      source_path: sourcePath,
      page_start: item.page_start,
      page_end: item.page_end,
      excerpt,
      locator: "lesson-chunk",
      modality: "text",
      extraction_method: "model_missing_evidence_backfill",
      normalized_claims: [excerpt.slice(0, 120)],
      properties: {},
    });
  }

  const mentions: RawRecord[] = [];
  for (const [zeroIndex, raw] of asRecords(bundle.evidence_units).entries()) {
    const index = zeroIndex + 1;
    const evidenceId = evidenceByAnchor.get(stringValue(raw.anchor).trim());
    if (!evidenceId) continue;
    for (const nodeId of trimmedStrings(raw.node_ids)) {
      if (!nodeIds.has(nodeId)) continue;
      mentions.push({
        id: `mention:${safePathToken(input.bookId)}:${safePathToken(nodeId)}:${index}`,
        source_type: "textbook",
        source_id: sourceId,
        anchor_ref: anchorRef,
        target_type: "node",
        target_id: nodeId,
        role: index === 1 ? "defines" : "focuses_on",
        source_refs: [evidenceId],
        confidence: 0.88,
        properties: {},
      });
    }
  }

  const backfillEvidenceId = stringValue(evidence[0]?.id);
  const mentionedNodeIds = new Set(mentions.map((mention) => stringValue(mention.target_id)));
  for (const node of nodes) {
    const nodeId = stringValue(node.id);
    if (mentionedNodeIds.has(nodeId) || !backfillEvidenceId) continue;
    mentions.push({
      id: `mention:${safePathToken(input.bookId)}:${safePathToken(nodeId)}:backfill`,
      source_type: "textbook",
      source_id: sourceId,
      anchor_ref: anchorRef,
      target_type: "node",
      target_id: nodeId,
      role: "mentions",
      source_refs: [backfillEvidenceId],
      confidence: 0.72,
      properties: { backfilled: true },
    });
  }

  const edges: RawRecord[] = [];
  let droppedEdges = 0;
  const nodeLookup = new Map<string, string>();
  for (const node of nodes) {
    const nodeId = stringValue(node.id);
    const nodeName = stringValue(node.name);
    nodeLookup.set(nodeId, nodeId);
    nodeLookup.set(nodeName, nodeId);
    nodeLookup.set(normalizeTerm(nodeName), nodeId);
    for (const alias of trimmedStrings(node.aliases)) {
      nodeLookup.set(alias, nodeId);
      nodeLookup.set(normalizeTerm(alias), nodeId);
    }
  }
  for (const raw of asRecords(bundle.edges)) {
    const rawFrom = stringValue(raw.from).trim();
    const rawTo = stringValue(raw.to).trim();
    const fromId = nodeLookup.get(rawFrom) ?? nodeLookup.get(normalizeTerm(rawFrom)) ?? rawFrom;
    const toId = nodeLookup.get(rawTo) ?? nodeLookup.get(normalizeTerm(rawTo)) ?? rawTo;
    const edgeType = stringValue(raw.type).trim();
    if (!nodeIds.has(fromId) || !nodeIds.has(toId) || !VALID_EDGE_TYPES.has(edgeType)) {
      droppedEdges += 1;
      continue;
    }
    const evidenceId = evidenceByAnchor.get(stringValue(raw.evidence_anchor).trim()) ?? backfillEvidenceId;
    edges.push({
      id: makeEdgeId(fromId, edgeType, toId),
      type: edgeType,
      from: fromId,
      to: toId,
      directionality: stringValue(raw.directionality || "directed"),
      confidence: numberOrDefault(raw.confidence, 0.8),
      source_refs: evidenceId ? [evidenceId] : [],
      properties: {},
      status: "draft",
      notes: stringValue(raw.notes).trim(),
    });
  }

  const domainProfiles: RawRecord[] = [];
  for (const raw of asRecords(bundle.domain_profiles)) {
    const nodeId = stringValue(raw.node_id).trim();
    const domain = stringValue(raw.domain).trim();
    if (!nodeIds.has(nodeId) || !VALID_DOMAINS.has(domain)) continue;
    const sourceRefs = mentions
      .filter((mention) => mention.target_id === nodeId && Array.isArray(mention.source_refs))
      .map((mention) => stringValue((mention.source_refs as unknown[])[0]))
      .filter(Boolean);
    domainProfiles.push({
      id: makeDomainProfileId(nodeId, domain),
      node_id: nodeId,
      domain,
      school_stages: trimmedStrings(raw.school_stages).length > 0 ? trimmedStrings(raw.school_stages) : [schoolStage],
      curriculum_roles: trimmedStrings(raw.curriculum_roles).length > 0 ? trimmedStrings(raw.curriculum_roles) : ["core"],
      source_refs: sourceRefs.length > 0 ? sourceRefs.slice(0, 1) : backfillEvidenceId ? [backfillEvidenceId] : [],
      properties: isRecord(raw.properties) ? raw.properties : { subject, grade_band: gradeBand },
      status: "draft",
      notes: "",
    });
  }

  const profiledNodeIds = new Set(domainProfiles.map((profile) => stringValue(profile.node_id)));
  const defaultDomain = VALID_DOMAINS.has(subject) ? subject : "general";
  for (const node of nodes) {
    const nodeId = stringValue(node.id);
    if (profiledNodeIds.has(nodeId)) continue;
    const nodeDomains = trimmedStrings(node.domains).filter((domain) => VALID_DOMAINS.has(domain));
    const domain = nodeDomains.includes(defaultDomain) || nodeDomains.length === 0 ? defaultDomain : nodeDomains[0]!;
    domainProfiles.push({
      id: makeDomainProfileId(nodeId, domain),
      node_id: nodeId,
      domain,
      school_stages: [schoolStage],
      curriculum_roles: ["core"],
      source_refs: backfillEvidenceId ? [backfillEvidenceId] : [],
      properties: { subject, grade_band: gradeBand, backfilled: true },
      status: "draft",
      notes: "Backfilled because the model omitted a domain profile.",
    });
  }

  const evidenceText = new Map(evidence.map((evidenceItem) => [stringValue(evidenceItem.id), stringValue(evidenceItem.excerpt)]));
  const nodeCards: RawRecord[] = [];
  for (const raw of asRecords(bundle.node_cards)) {
    const nodeId = stringValue(raw.node_id).trim();
    if (!nodeIds.has(nodeId)) continue;
    const evidenceId = evidenceByAnchor.get(stringValue(raw.evidence_anchor).trim()) ?? backfillEvidenceId;
    const title = stringValue(nodes.find((node) => node.id === nodeId)?.name);
    nodeCards.push({
      id: makeNodeCardId(nodeId),
      node_id: nodeId,
      title,
      summary: stringValue(raw.summary).trim(),
      sections: [
        cardSection("definition", "定义", "definition", [stringValue(raw.definition || evidenceText.get(evidenceId) || "").trim()], evidenceId),
        cardSection("essence", "核心本质", "essence", [stringValue(raw.essence).trim()], evidenceId),
        cardSection("key-points", "关键要点", "key_points", trimmedStrings(raw.key_points), evidenceId),
        cardSection("example", "示例", "example", [stringValue(raw.example).trim()], evidenceId),
        cardSection("application", "应用", "application", [stringValue(raw.application).trim()], evidenceId),
        cardSection("misconception", "常见误解", "misconception", [stringValue(raw.misconception).trim()], evidenceId),
      ],
      source_refs: evidenceId ? [evidenceId] : [],
      properties: {},
      status: "draft",
    });
  }

  const nodeById = new Map(nodes.map((node) => [stringValue(node.id), node]));
  const cardNodeIds = new Set(nodeCards.map((card) => stringValue(card.node_id)));
  for (const card of nodeCards) {
    if (stringValue(card.summary)) continue;
    const node = nodeById.get(stringValue(card.node_id));
    card.summary = stringValue(node?.definition || node?.name || card.node_id);
  }
  for (const node of nodes) {
    const nodeId = stringValue(node.id);
    if (cardNodeIds.has(nodeId)) continue;
    const definition = stringValue(node.definition || node.name).trim();
    const refs = backfillEvidenceId ? [backfillEvidenceId] : [];
    nodeCards.push({
      id: makeNodeCardId(nodeId),
      node_id: nodeId,
      title: node.name,
      summary: definition,
      sections: [
        cardSection("definition", "定义", "definition", [definition], backfillEvidenceId, { backfilled: true }),
        cardSection("essence", "核心本质", "essence", [definition], backfillEvidenceId, { backfilled: true }),
        cardSection("key-points", "关键要点", "key_points", [definition], backfillEvidenceId, { backfilled: true }),
        cardSection("example", "示例", "example", [stringValue(node.name)], backfillEvidenceId, { backfilled: true }),
        cardSection("application", "应用", "application", [stringValue(item.title || "")], backfillEvidenceId, { backfilled: true }),
        cardSection("misconception", "常见误解", "misconception", ["需结合证据原文确认适用范围。"], backfillEvidenceId, { backfilled: true }),
      ],
      source_refs: refs,
      properties: { backfilled: true },
      status: "draft",
    });
  }

  return {
    status: "success",
    lesson_run_id: lessonRunId,
    book_id: input.bookId,
    batch_anchor: anchorRef,
    nodes,
    edges,
    domain_profiles: domainProfiles,
    mentions,
    evidence,
    node_cards: nodeCards,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      domain_profiles: domainProfiles.length,
      mentions: mentions.length,
      evidence: evidence.length,
      node_cards: nodeCards.length,
    },
    issues: trimmedStrings(bundle.issues).concat(
      normalizationIssues,
      droppedEdges > 0 ? [`Dropped ${droppedEdges} edges that could not be resolved to valid node ids or relation types.`] : [],
    ),
  };
}

export function makeExcerpt(lines: string[], limit = 1200): string {
  const text = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

export function extractMarkdownEvidenceHints(lines: string[]): MarkdownEvidenceHint[] {
  const hints: MarkdownEvidenceHint[] = [];
  let inEquation = false;
  let equationLines: string[] = [];
  let tableLines: string[] = [];

  const flushTable = (): void => {
    if (tableLines.length >= 2) {
      hints.push({
        modality: "table",
        locator: `markdown-table-${hints.length + 1}`,
        excerpt: tableLines.slice(0, 12).join("\n"),
      });
    }
    tableLines = [];
  };

  for (const [zeroIndex, rawLine] of lines.entries()) {
    const lineNumber = zeroIndex + 1;
    const line = rawLine.trim();
    if (!line) {
      flushTable();
      continue;
    }

    if (line.startsWith("$$")) {
      if (inEquation) {
        equationLines.push(line);
        hints.push({ modality: "equation", locator: `line:${lineNumber}`, excerpt: equationLines.join("\n") });
        equationLines = [];
        inEquation = false;
      } else {
        flushTable();
        equationLines = [line];
        inEquation = !line.endsWith("$$") || line.length <= 2;
        if (!inEquation) {
          hints.push({ modality: "equation", locator: `line:${lineNumber}`, excerpt: line });
          equationLines = [];
        }
      }
      continue;
    }

    if (inEquation) {
      equationLines.push(line);
      continue;
    }

    if (/(?<!\$)\$[^$]+\$(?!\$)/.test(line)) {
      flushTable();
      hints.push({ modality: "equation", locator: `line:${lineNumber}`, excerpt: line });
      continue;
    }

    const imageMatch = /!\[([^\]]*)\]\(([^)]+)\)/.exec(line);
    if (imageMatch) {
      flushTable();
      hints.push({
        modality: "image",
        locator: `line:${lineNumber}`,
        excerpt: line,
        caption: imageMatch[1]?.trim() ?? "",
        path: imageMatch[2]?.trim() ?? "",
      });
      continue;
    }

    if (line.startsWith("|") && line.endsWith("|")) {
      tableLines.push(line);
      continue;
    }

    flushTable();
  }

  flushTable();
  if (inEquation && equationLines.length > 0) {
    hints.push({ modality: "equation", locator: "markdown-equation-unclosed", excerpt: equationLines.join("\n") });
  }
  return hints.slice(0, 20);
}

export function buildRetrievalQueries(item: OutlineItem, lines: string[], limit = 6): string[] {
  const queries: string[] = [];
  const title = stringValue(item.title).trim();
  if (title) queries.push(title);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("!") || line.startsWith("|")) continue;
    if (line.startsWith("#")) {
      queries.push(line.replace(/^#+/, "").trim());
    } else if (line.length <= 40 && !/[。.!?？]$/.test(line)) {
      queries.push(line);
    }
    if (queries.length >= limit) break;
  }
  return uniqueStrings(queries).slice(0, limit);
}

function sliceMarkdownForModelLesson(input: BuildModelLessonPayloadInput): {
  item: OutlineItem;
  markdownLines: string[];
  outline: RawRecord;
  anchorRef: string;
} {
  const repoRoot = input.repoRoot ?? REPO_ROOT;
  const outline = input.outline ?? loadOutline(input.bookId, repoRoot);
  const items = outlineItems(outline);
  const anchorRef = resolveOutlineAnchorFromItems(input.bookId, input.batchAnchor, items, { strict: true });
  const resolved = resolveChunkOrLessonFromItems(input.bookId, input.batchAnchor, items);
  if (resolved === null) throw new Error(`Anchor not found: ${input.batchAnchor}`);
  const item = Array.isArray(resolved) ? resolved[0] : resolved;
  if (!item) throw new Error(`Anchor not found: ${input.batchAnchor}`);
  const allLines = input.markdownLines ?? loadMarkdownLines(stringValue(outline.source_path), repoRoot);
  const start = numberOrDefault(item.md_start, 1);
  const end = numberOrDefault(item.md_end, allLines.length);
  return {
    item,
    markdownLines: allLines.slice(Math.max(0, start - 1), end),
    outline,
    anchorRef,
  };
}

function resolveChunkOrLessonFromItems(bookId: string, anchor: string, items: OutlineItem[]): OutlineItem | OutlineItem[] | null {
  const byId = new Map(items.filter((item) => typeof item.id === "string").map((item) => [item.id as string, item]));
  const resolved = resolveOutlineAnchorFromItems(bookId, anchor, items, { strict: false });
  const item = byId.get(resolved);
  if (!item) return null;
  if (item.kind === "chunk") return item;
  const chunks = items.filter((candidate) => candidate.parent_id === resolved && candidate.kind === "chunk");
  if (chunks.length > 0) {
    return chunks.sort((left, right) => stringValue(left.order_path).localeCompare(stringValue(right.order_path)));
  }
  return item;
}

function loadOutline(bookId: string, repoRoot: string): RawRecord {
  const path = resolve(repoRoot, "data", "outlines", `${bookId}.outline.json`);
  if (!existsSync(path)) throw new Error(`Outline not found for book '${bookId}': ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`Outline for book '${bookId}' must be a JSON object.`);
  return parsed;
}

function loadMarkdownLines(sourcePath: string, repoRoot: string): string[] {
  if (!sourcePath) throw new Error("Outline is missing source_path.");
  const path = isAbsolute(sourcePath) ? sourcePath : resolve(repoRoot, sourcePath);
  return readFileSync(path, "utf8").split(/\r?\n/);
}

function outlineItems(outline: RawRecord): OutlineItem[] {
  const rawItems = Array.isArray(outline.structure) ? outline.structure : Array.isArray(outline.items) ? outline.items : [];
  return iterOutlineItems(rawItems as OutlineItem[]);
}

function buildResponsesBody(model: string, instructions: string, userPayload: string, schema: RawRecord, reasoningEffort?: string): RawRecord {
  const body: RawRecord = {
    model,
    instructions,
    input: [{ role: "user", content: [{ type: "input_text", text: userPayload }] }],
    text: { format: { type: "json_schema", ...schema } },
  };
  if (reasoningEffort) body.reasoning = { effort: reasoningEffort };
  return body;
}

function buildChatCompletionsBody(model: string, instructions: string, userPayload: string, schema: RawRecord, reasoningEffort?: string): RawRecord {
  const body: RawRecord = {
    model,
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: userPayload },
    ],
    response_format: {
      type: "json_schema",
      json_schema: schema,
    },
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  return body;
}

function cardSection(
  id: string,
  title: string,
  sectionType: string,
  content: string[],
  evidenceId: string,
  properties: RawRecord = {},
): RawRecord {
  return {
    id,
    title,
    section_type: sectionType,
    content,
    source_refs: evidenceId ? [evidenceId] : [],
    properties,
  };
}

function sortedSet(values: Set<string>): string[] {
  return [...values].sort();
}

function asRecords(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function recordValue(value: unknown): RawRecord {
  return isRecord(value) ? value : {};
}

function inferNodeName(rawId: string, rawName: string, rawDefinition: string, raw: RawRecord): string {
  if (rawName) return rawName;
  const explicit = stringValue(raw.title || raw.label || raw.term).trim();
  if (explicit) return explicit;
  const alias = trimmedStrings(raw.aliases)[0];
  if (alias) return alias;
  const fromDefinition = rawDefinition.split(/[。；;，,：:\n]/)[0]?.trim();
  if (fromDefinition) return fromDefinition.length > 32 ? fromDefinition.slice(0, 32).trim() : fromDefinition;
  return humanizeNodeId(rawId);
}

function humanizeNodeId(rawId: string): string {
  return rawId
    .replace(/^(node|n|concept|entity|property|prop|rule|method|representation|event|e|m|p)[:_-]+/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

function trimmedStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return typeof value === "string" && value.trim() ? [value.trim()] : [];
  return value.map(stringValue).map((item) => item.trim()).filter(Boolean);
}

function uniqueStrings(values: Iterable<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function validOrDefault(value: string, allowed: Set<string>, fallback: string): string {
  return allowed.has(value) ? value : fallback;
}

function validListOrDefault(value: unknown, allowed: Set<string>, fallback: string): string[] {
  const validValues = trimmedStrings(value).filter((item) => allowed.has(item));
  return validValues.length > 0 ? uniqueStrings(validValues) : [fallback];
}

function numberOrDefault(value: unknown, defaultValue: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue !== 0 ? numberValue : defaultValue;
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
