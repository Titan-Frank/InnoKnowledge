import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  VALID_DOMAINS,
  VALID_KNOWLEDGE_FORMS,
  VALID_LEARNING_MODES,
  VALID_NODE_KINDS,
} from "../shared/knowledge.js";
import {
  buildTemplateInstructionBlock,
  templateAllowedNodeKinds,
  templateEdgeDisplay,
  templateMetadata,
  templateModelPayload,
  templateNodeDisplay,
  templatePreferredEdgeTypes,
  type ExtractionTemplate,
} from "./extraction-template.js";
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
import type { EnrichHint } from "./enrich-context.js";

type RawRecord = Record<string, unknown>;

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "gpt-4.1";
export const DEFAULT_OPENAI_TIMEOUT_MS = 180_000;

export type ModelApiMode = "responses" | "chat_completions";

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
  enrich_hints: EnrichHint[];
  markdown_evidence_hints: MarkdownEvidenceHint[];
};

export type ModelLessonPayload = {
  lesson_context: ModelLessonContext;
  extraction_template?: RawRecord;
  markdown_lines: string[];
};

export type BuildModelLessonPayloadInput = {
  bookId: string;
  batchAnchor: string;
  repoRoot?: string;
  outline?: RawRecord;
  markdownLines?: string[];
  retrievalCandidates?: RawRecord[];
  enrichHints?: EnrichHint[];
  textbookId?: string;
  subject?: string;
  schoolStage?: string;
  gradeBand?: string;
  extractionTemplate?: ExtractionTemplate | null;
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
  lesson_disposition?: "extracted" | "no_knowledge";
  no_knowledge_reason?: string;
  nodes?: RawRecord[];
  edges?: RawRecord[];
  evidence_units?: RawRecord[];
  domain_profiles?: RawRecord[];
  node_cards?: RawRecord[];
  issues?: unknown[];
};

export type HybridNodeEvidenceBundle = Pick<ModelBundle, "lesson_disposition" | "no_knowledge_reason" | "nodes" | "evidence_units" | "issues">;
export type HybridEdgeBundle = Pick<ModelBundle, "edges" | "issues">;

export type ExtractionPayload = {
  status: "success";
  lesson_disposition: "extracted" | "no_knowledge";
  no_knowledge_reason: string;
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
      enrich_hints: input.enrichHints ?? [],
      markdown_evidence_hints: extractMarkdownEvidenceHints(markdownLines),
    },
    ...(input.extractionTemplate ? { extraction_template: templateModelPayload(input.extractionTemplate) } : {}),
    markdown_lines: markdownLines,
  };
}

export function buildHybridNodeEvidenceExtractionRequest(input: BuildModelExtractionRequestInput): ModelExtractionRequest {
  return buildSchemaBackedExtractionRequest(input, {
    instructions: buildHybridNodeEvidenceInstructions({ prompt: input.prompt, extractionTemplate: input.extractionTemplate }),
    userPayload: JSON.stringify(buildModelLessonPayload(input), null, 2),
    schema: buildHybridNodeEvidenceResponseSchema(input.extractionTemplate),
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
      allowed_edge_types: templatePreferredEdgeTypes(input.extractionTemplate),
      extraction_template: input.extractionTemplate ? templateModelPayload(input.extractionTemplate) : null,
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
    instructions: buildHybridEdgeInstructions({ prompt: input.prompt, extractionTemplate: input.extractionTemplate }),
    userPayload,
    schema: buildHybridEdgeResponseSchema(input.extractionTemplate),
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
  const bundle = buildStrictHybridModelBundle(nodeEvidenceBundle, edgeBundle, input.extractionTemplate);
  return buildExtractionPayloadFromModelBundle(input, bundle);
}

function buildSchemaBackedExtractionRequest(
  input: BuildModelExtractionRequestInput,
  options: { instructions: string; userPayload: string; schema: RawRecord },
): ModelExtractionRequest {
  const apiMode = input.apiMode ?? "chat_completions";
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

function buildHybridNodeEvidenceInstructions(input: { prompt?: string; extractionTemplate?: ExtractionTemplate | null } = {}): string {
  const base = `
你是 Open Knowledge Map 项目的第一阶段教材知识抽取器。
任务是只从当前 lesson/chunk 中抽取证据和候选知识节点。

硬约束：
1. 只输出 lesson_disposition、no_knowledge_reason、nodes、evidence_units、issues 五个字段。
2. 这一阶段绝对不要输出关系；关系会在第二阶段单独判断。
3. 每个节点必须能被当前 lesson 的 evidence_units 支撑，证据不足就不要列为节点。
4. evidence_units.anchor 必须稳定、简短、唯一，例如 ev1、ev2。
5. node.id 必须稳定、唯一，后续关系阶段会直接引用这些 id。
6. 节点主类只能使用 9 类：entity/concept/property/process/event/method/rule/representation/resource。
7. 不要把章节编号、复习题、术语表、小结当成正式知识节点。
8. 课标是边界，教材是证据，考点是评价，目录是线索；不要把它们直接等同于知识节点。
9. 正式候选节点应具备稳定知识身份、证据锚点、关系潜力、教学用途和未来复用性。
10. lesson_context.enrich_hints 只是对应教材位置的辅助判断材料，只能帮助判断术语边界、命名和粒度，不能作为节点证据。
11. 如果 enrich_hints 和当前 lesson/chunk 证据冲突，以当前 lesson/chunk 的证据为准。
12. 如果当前课时存在至少一个证据充分、符合准入条件的知识对象，lesson_disposition 必须为 extracted，no_knowledge_reason 必须为空字符串。
13. 只有当前课时确实没有任何可抽取知识对象时，lesson_disposition 才能为 no_knowledge；此时 nodes 和 evidence_units 必须都为空，并在 no_knowledge_reason 中写明原因。
14. 不要为了避免空结果而把目录、栏目、题型、活动标题或证据不足的词语提升为节点。
15. 输出必须严格符合 JSON schema。
  `.trim();
  return appendPromptBlocks(base, input.prompt, input.extractionTemplate, "node_evidence");
}

function buildHybridEdgeInstructions(input: { prompt?: string; extractionTemplate?: ExtractionTemplate | null } = {}): string {
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
8. 如果 lesson_context.enrich_hints 存在，它只能帮助理解课时主题，不能作为关系证据。
9. 输出必须严格符合 JSON schema，不要解释。
  `.trim();
  return appendPromptBlocks(base, input.prompt, input.extractionTemplate, "edges");
}

function appendPromptBlocks(
  base: string,
  prompt?: string,
  extractionTemplate?: ExtractionTemplate | null,
  stage: "node_evidence" | "edges" = "node_evidence",
): string {
  const blocks = [base];
  if (extractionTemplate) {
    blocks.push(`模板契约：\n${buildTemplateInstructionBlock(extractionTemplate, stage)}`);
  }
  const trimmedPrompt = prompt?.trim();
  if (trimmedPrompt) blocks.push(`补充项目提示：\n${trimmedPrompt}`);
  return blocks.join("\n\n");
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

export function buildResponseSchema(extractionTemplate?: ExtractionTemplate | null): RawRecord {
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
      kind: { type: "string", enum: templateAllowedNodeKinds(extractionTemplate) },
      subkind: { type: ["string", "null"], pattern: "^[a-z0-9_]+$" },
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
      type: { type: "string", enum: templatePreferredEdgeTypes(extractionTemplate) },
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
        lesson_disposition: { type: "string", enum: ["extracted", "no_knowledge"] },
        no_knowledge_reason: { type: "string" },
        nodes: { type: "array", items: nodeItem },
        edges: { type: "array", items: edgeItem },
        evidence_units: { type: "array", items: evidenceItem },
        domain_profiles: { type: "array", items: domainProfileItem },
        node_cards: { type: "array", items: cardItem },
        issues: { type: "array", items: { type: "string" } },
      },
      required: ["lesson_disposition", "no_knowledge_reason", "nodes", "edges", "evidence_units", "domain_profiles", "node_cards", "issues"],
    },
  };
}

export function buildHybridNodeEvidenceResponseSchema(extractionTemplate?: ExtractionTemplate | null): RawRecord {
  const properties = responseSchemaProperties(extractionTemplate);
  return {
    name: "world_knowledge_node_evidence_bundle",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        lesson_disposition: properties.lesson_disposition,
        no_knowledge_reason: properties.no_knowledge_reason,
        nodes: properties.nodes,
        evidence_units: properties.evidence_units,
        issues: properties.issues,
      },
      required: ["lesson_disposition", "no_knowledge_reason", "nodes", "evidence_units", "issues"],
    },
  };
}

export function buildHybridEdgeResponseSchema(extractionTemplate?: ExtractionTemplate | null): RawRecord {
  const properties = responseSchemaProperties(extractionTemplate);
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

function responseSchemaProperties(extractionTemplate?: ExtractionTemplate | null): RawRecord {
  const schema = recordValue(recordValue(buildResponseSchema(extractionTemplate).schema).properties);
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

function buildStrictHybridModelBundle(
  nodeEvidenceBundle: HybridNodeEvidenceBundle,
  edgeBundle: HybridEdgeBundle,
  extractionTemplate?: ExtractionTemplate | null,
): ModelBundle {
  const normalized = normalizeHybridNodeEvidenceBundle(nodeEvidenceBundle);
  const nodeIds = new Set(normalized.nodes.map((node) => stringValue(node.id)).filter(Boolean));
  const evidenceAnchors = new Set(normalized.evidence_units.map((evidence) => stringValue(evidence.anchor)).filter(Boolean));
  const allowedEdgeTypes = new Set(templatePreferredEdgeTypes(extractionTemplate));
  const edges: RawRecord[] = [];
  const seenEdges = new Set<string>();
  let droppedEdges = 0;

  for (const raw of asRecords(edgeBundle.edges)) {
    const from = stringValue(raw.from || raw.source || raw.source_id).trim();
    const to = stringValue(raw.to || raw.target || raw.target_id).trim();
    const type = stringValue(raw.type || raw.relation || raw.predicate).trim();
    const evidenceAnchor = stringValue(raw.evidence_anchor || raw.anchor || raw.evidence).trim();
    if (!nodeIds.has(from) || !nodeIds.has(to) || !allowedEdgeTypes.has(type) || !evidenceAnchors.has(evidenceAnchor)) {
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
      properties: applyEdgeTemplateProperties(recordValue(raw.properties), extractionTemplate, type),
      notes: stringValue(raw.notes).trim(),
    });
  }

  return {
    lesson_disposition: normalizeLessonDisposition(nodeEvidenceBundle.lesson_disposition),
    no_knowledge_reason: stringValue(nodeEvidenceBundle.no_knowledge_reason).trim(),
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
  const extractionTemplate = input.extractionTemplate;
  const lessonDisposition = normalizeLessonDisposition(bundle.lesson_disposition);
  const noKnowledgeReason = stringValue(bundle.no_knowledge_reason).trim();
  const isNoKnowledge = lessonDisposition === "no_knowledge";

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
      properties: applyNodeTemplateProperties(recordValue(raw.properties), extractionTemplate, stringValue(raw.kind).trim(), raw.subkind),
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
  const modelExtractionMethod = (input as BuildModelExtractionRequestInput).apiMode === "responses"
    ? "openai_responses"
    : "openai_chat_completions";
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
      extraction_method: modelExtractionMethod,
      normalized_claims: [excerpt.slice(0, 120)],
      properties: applyEvidenceTemplateProperties({}, extractionTemplate),
    });
  }

  if (!isNoKnowledge) {
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
        properties: applyEvidenceTemplateProperties(
          Object.fromEntries(Object.entries(hint).filter(([key]) => !["excerpt", "locator", "modality"].includes(key))),
          extractionTemplate,
        ),
      });
    }
  }

  if (!isNoKnowledge && nodes.length > 0 && evidence.length === 0) {
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
      properties: applyEvidenceTemplateProperties(
        {
          synthetic: true,
          quality_excluded: true,
          review_status: "pending",
        },
        extractionTemplate,
      ),
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
        properties: applyMentionTemplateProperties({}, extractionTemplate),
      });
    }
  }

  const evidenceRefsByNode = new Map<string, string[]>();
  for (const mention of mentions) {
    const nodeId = stringValue(mention.target_id);
    const refs = trimmedStrings(mention.source_refs);
    evidenceRefsByNode.set(nodeId, uniqueStrings([...(evidenceRefsByNode.get(nodeId) ?? []), ...refs]));
  }

  const edges: RawRecord[] = [];
  let droppedEdges = 0;
  const allowedEdgeTypes = new Set(templatePreferredEdgeTypes(extractionTemplate));
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
    if (!nodeIds.has(fromId) || !nodeIds.has(toId) || !allowedEdgeTypes.has(edgeType)) {
      droppedEdges += 1;
      continue;
    }
    const evidenceId = evidenceByAnchor.get(stringValue(raw.evidence_anchor).trim());
    edges.push({
      id: makeEdgeId(fromId, edgeType, toId),
      type: edgeType,
      from: fromId,
      to: toId,
      directionality: stringValue(raw.directionality || "directed"),
      confidence: numberOrDefault(raw.confidence, 0.8),
      source_refs: evidenceId ? [evidenceId] : [],
      properties: applyEdgeTemplateProperties(recordValue(raw.properties), extractionTemplate, edgeType),
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
      source_refs: sourceRefs.slice(0, 1),
      properties: applyProfileTemplateProperties(isRecord(raw.properties) ? raw.properties : { subject, grade_band: gradeBand }, extractionTemplate),
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
      source_refs: (evidenceRefsByNode.get(nodeId) ?? []).slice(0, 1),
      properties: applyProfileTemplateProperties({ subject, grade_band: gradeBand, backfilled: true }, extractionTemplate),
      status: "draft",
      notes: "Backfilled because the model omitted a domain profile.",
    });
  }

  const evidenceText = new Map(evidence.map((evidenceItem) => [stringValue(evidenceItem.id), stringValue(evidenceItem.excerpt)]));
  const nodeCards: RawRecord[] = [];
  for (const raw of asRecords(bundle.node_cards)) {
    const nodeId = stringValue(raw.node_id).trim();
    if (!nodeIds.has(nodeId)) continue;
    const evidenceId = evidenceByAnchor.get(stringValue(raw.evidence_anchor).trim()) ?? "";
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
      properties: applyCardTemplateProperties({}, extractionTemplate),
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
    const evidenceId = (evidenceRefsByNode.get(nodeId) ?? [])[0] ?? "";
    const refs = evidenceId ? [evidenceId] : [];
    nodeCards.push({
      id: makeNodeCardId(nodeId),
      node_id: nodeId,
      title: node.name,
      summary: definition,
      sections: [
        cardSection("definition", "定义", "definition", [definition], evidenceId, { backfilled: true }),
        cardSection("essence", "核心本质", "essence", [definition], evidenceId, { backfilled: true }),
        cardSection("key-points", "关键要点", "key_points", [definition], evidenceId, { backfilled: true }),
        cardSection("example", "示例", "example", [stringValue(node.name)], evidenceId, { backfilled: true }),
        cardSection("application", "应用", "application", [stringValue(item.title || "")], evidenceId, { backfilled: true }),
        cardSection("misconception", "常见误解", "misconception", ["需结合证据原文确认适用范围。"], evidenceId, { backfilled: true }),
      ],
      source_refs: refs,
      properties: applyCardTemplateProperties({ backfilled: true }, extractionTemplate),
      status: "draft",
    });
  }

  return {
    status: "success",
    lesson_disposition: lessonDisposition,
    no_knowledge_reason: noKnowledgeReason,
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

function applyNodeTemplateProperties(
  properties: RawRecord,
  extractionTemplate: ExtractionTemplate | null | undefined,
  kind: string,
  subkind: unknown,
): RawRecord {
  return applyTemplateProperties(properties, extractionTemplate, {
    template_display: templateNodeDisplay(extractionTemplate, kind, stringValue(subkind || "").trim() || null),
  });
}

function applyEdgeTemplateProperties(
  properties: RawRecord,
  extractionTemplate: ExtractionTemplate | null | undefined,
  edgeType: string,
): RawRecord {
  return applyTemplateProperties(properties, extractionTemplate, {
    template_display: templateEdgeDisplay(extractionTemplate, edgeType),
  });
}

function applyEvidenceTemplateProperties(properties: RawRecord, extractionTemplate: ExtractionTemplate | null | undefined): RawRecord {
  return applyTemplateProperties(properties, extractionTemplate, {});
}

function applyMentionTemplateProperties(properties: RawRecord, extractionTemplate: ExtractionTemplate | null | undefined): RawRecord {
  return applyTemplateProperties(properties, extractionTemplate, {});
}

function applyProfileTemplateProperties(properties: RawRecord, extractionTemplate: ExtractionTemplate | null | undefined): RawRecord {
  return applyTemplateProperties(properties, extractionTemplate, {});
}

function applyCardTemplateProperties(properties: RawRecord, extractionTemplate: ExtractionTemplate | null | undefined): RawRecord {
  return applyTemplateProperties(properties, extractionTemplate, {});
}

function applyTemplateProperties(
  properties: RawRecord,
  extractionTemplate: ExtractionTemplate | null | undefined,
  extra: RawRecord,
): RawRecord {
  const metadata = templateMetadata(extractionTemplate);
  if (!metadata) return properties;
  return Object.fromEntries(
    Object.entries({
      ...properties,
      extraction_template: metadata,
      ...extra,
    }).filter(([, value]) => value !== null && value !== undefined),
  );
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
  const anchorItem = items.find((candidate) => candidate.id === anchorRef);
  const item = anchorItem?.kind === "lesson" ? anchorItem : Array.isArray(resolved) ? resolved[0] : resolved;
  if (!item) throw new Error(`Anchor not found: ${input.batchAnchor}`);
  const allLines = input.markdownLines ?? loadMarkdownLines(stringValue(outline.source_path), repoRoot);
  const spanItems = anchorItem?.kind === "lesson"
    ? outlineSubtree(anchorItem, items)
    : Array.isArray(resolved) ? resolved : [resolved];
  const start = Math.min(...spanItems.map((candidate) => numberOrDefault(candidate.md_start, allLines.length + 1)));
  const end = Math.max(...spanItems.map((candidate) => numberOrDefault(candidate.md_end, 0)));
  return {
    item,
    markdownLines: allLines.slice(Math.max(0, (start <= allLines.length ? start : 1) - 1), end > 0 ? end : allLines.length),
    outline,
    anchorRef,
  };
}

function outlineSubtree(root: OutlineItem, items: OutlineItem[]): OutlineItem[] {
  const result: OutlineItem[] = [];
  const pending = [root];
  const seen = new Set<OutlineItem>();
  while (pending.length > 0) {
    const item = pending.shift();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (Array.isArray(item.children)) pending.push(...item.children);
    if (typeof item.id === "string") {
      pending.push(...items.filter((candidate) => candidate.parent_id === item.id));
    }
  }
  return result;
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

function normalizeLessonDisposition(value: unknown): "extracted" | "no_knowledge" {
  return value === "no_knowledge" ? "no_knowledge" : "extracted";
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
