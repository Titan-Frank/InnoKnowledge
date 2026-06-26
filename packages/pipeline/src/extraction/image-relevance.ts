import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";

type RawRecord = Record<string, unknown>;

export type ImageRelevanceLabel = "core_content" | "supporting" | "decorative" | "mismatch" | "uncertain";

export type ImageRelevanceDecision = {
  keep: boolean;
  relevance: ImageRelevanceLabel;
  reason: string;
  source: "vlm" | "fallback";
  confidence?: number;
  path?: string;
  width?: number;
  height?: number;
  review_status?: "auto" | "pending" | "confirmed" | "rejected";
};

export type ImageEvidenceFilterOptions = {
  repoRoot: string;
  vlmApiUrl?: string;
  vlmApiKey?: string;
  vlmModel?: string;
  vlmConcurrency?: number;
  vlmCacheDir?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type ImageEvidenceFilterResult = {
  payload: RawRecord;
  decisions: Record<string, ImageRelevanceDecision>;
  dropped_evidence_ids: string[];
  issues: string[];
};

type SourceLineCache = Map<string, string[] | null>;
type ImageEvidenceFilterRuntimeOptions = ImageEvidenceFilterOptions & { sourceLineCache?: SourceLineCache };
type ImagePromptContext = {
  sourcePath: string;
  sourceLine: number | null;
  headingPath: string[];
  before: string[];
  imageLine: string;
  after: string[];
};

const DEFAULT_VLM_MODEL = "gpt-4.1-mini";
const DEFAULT_VLM_TIMEOUT_MS = 60_000;
const DEFAULT_VLM_CONCURRENCY = 8;
const CACHE_VERSION = 1;
const PROMPT_VERSION = "textbook-image-relevance-v3-context";

export async function filterImageEvidencePayload(
  payload: RawRecord,
  options: ImageEvidenceFilterOptions,
): Promise<ImageEvidenceFilterResult> {
  const evidence = recordArray(payload.evidence);
  const decisions: Record<string, ImageRelevanceDecision> = {};
  const dropped = new Set<string>();
  const issues: string[] = [];
  const nextEvidence: RawRecord[] = [];
  const sourceLineCache: SourceLineCache = new Map();

  const imageJobs = evidence
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => stringValue(item.modality).toLowerCase() === "image");
  const imageResults = await mapLimited(
    imageJobs,
    normalizedConcurrency(options.vlmConcurrency),
    async ({ item, index }) => ({
      index,
      decision: await classifyImageEvidence(item, { ...options, sourceLineCache }).catch((error) => ({
        keep: true,
        relevance: "uncertain" as const,
        reason: `图片相关性判断失败，默认保留：${(error as Error).message}`,
        source: "fallback" as const,
      })),
    }),
  );
  const imageDecisions = new Map(imageResults.map((result) => [result.index, result.decision]));

  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index]!;
    if (stringValue(item.modality).toLowerCase() !== "image") {
      nextEvidence.push(item);
      continue;
    }

    const decision = imageDecisions.get(index) ?? {
      keep: true,
      relevance: "uncertain" as const,
      reason: "图片相关性判断缺少结果，默认保留。",
      source: "fallback" as const,
    };
    const id = stringValue(item.id || item.raw_evidence_id);
    if (id) decisions[id] = decision;

    if (!decision.keep && id) {
      dropped.add(id);
      issues.push(`Filtered image evidence ${id}: ${decision.reason}`);
      continue;
    }

    nextEvidence.push({
      ...item,
      properties: {
        ...recordValue(item.properties),
        image_relevance: imageRelevanceForStorage(decision),
      },
    });
  }

  if (dropped.size === 0) {
    return {
      payload: {
        ...payload,
        evidence: nextEvidence,
        issues: mergeIssues(payload.issues, issues),
      },
      decisions,
      dropped_evidence_ids: [],
      issues,
    };
  }

  const pruned = repairPrunedEvidenceReferences(pruneDroppedEvidenceRefs({ ...payload, evidence: nextEvidence }, dropped));
  const counts = recordValue(payload.counts);
  return {
    payload: {
      ...pruned,
      counts: {
        ...counts,
        evidence: recordArray(pruned.evidence).length,
        edges: recordArray(pruned.edges).length,
        mentions: recordArray(pruned.mentions).length,
        domain_profiles: recordArray(pruned.domain_profiles).length,
        node_cards: recordArray(pruned.node_cards).length,
      },
      issues: mergeIssues(payload.issues, issues),
    },
    decisions,
    dropped_evidence_ids: [...dropped],
    issues,
  };
}

function imageRelevanceForStorage(decision: ImageRelevanceDecision): ImageRelevanceDecision {
  if (decision.review_status) return decision;
  return {
    ...decision,
    review_status: decision.relevance === "uncertain" ? "pending" : "auto",
  };
}

export async function classifyImageEvidence(
  evidence: RawRecord,
  options: ImageEvidenceFilterRuntimeOptions,
): Promise<ImageRelevanceDecision> {
  const imagePath = resolveEvidenceImagePath(evidence, options.repoRoot);
  const metadata = imagePath ? readImageMetadata(imagePath) : null;

  const apiUrl = options.vlmApiUrl?.trim();
  if (apiUrl && imagePath && existsSync(imagePath)) {
    return callVlmForImageRelevance(evidence, imagePath, metadata, {
      ...options,
      vlmApiUrl: apiUrl,
    });
  }

  return {
    keep: true,
    relevance: "uncertain",
    reason: apiUrl ? "图片文件无法读取，无法调用 VLM，默认保留。" : "未配置 VLM，默认保留。",
    source: "fallback",
    path: imagePath,
    width: metadata?.width,
    height: metadata?.height,
  };
}

async function callVlmForImageRelevance(
  evidence: RawRecord,
  imagePath: string,
  metadata: ImageMetadata | null,
  options: ImageEvidenceFilterRuntimeOptions & { vlmApiUrl: string },
): Promise<ImageRelevanceDecision> {
  const endpoint = normalizeVlmEndpoint(options.vlmApiUrl);
  const mime = mimeTypeForPath(imagePath);
  const prompt = buildVlmPrompt(evidence, metadata, imagePromptContext(evidence, imagePath, options.repoRoot, options.sourceLineCache));
  const imageBytes = readFileSync(imagePath);
  const imageHash = sha256(imageBytes);
  const promptHash = sha256(prompt);
  const model = options.vlmModel ?? DEFAULT_VLM_MODEL;
  const cacheKey = imageRelevanceCacheKey({ endpoint, model, imageHash, promptHash });
  const cached = readCachedDecision(options.vlmCacheDir, cacheKey);
  if (cached) {
    return {
      ...cached,
      path: imagePath,
      width: metadata?.width,
      height: metadata?.height,
    };
  }

  const imageUrl = `data:${mime};base64,${imageBytes.toString("base64")}`;
  const request = endpoint.endsWith("/responses")
    ? buildResponsesVlmBody(model, prompt, imageUrl)
    : buildChatVlmBody(model, prompt, imageUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_VLM_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = options.vlmApiKey?.trim();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`VLM request failed with ${response.status}: ${text}`);
    const parsed = JSON.parse(text) as unknown;
    const modelResult = parseVlmDecision(parsed);
    const decision: ImageRelevanceDecision = {
      keep: modelResult.keep,
      relevance: modelResult.relevance,
      reason: modelResult.reason,
      confidence: modelResult.confidence,
      source: "vlm",
      path: imagePath,
      width: metadata?.width,
      height: metadata?.height,
    };
    writeCachedDecision(options.vlmCacheDir, cacheKey, {
      endpoint,
      model,
      imageHash,
      promptHash,
      decision,
    });
    return decision;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapLimited<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const current = items[nextIndex]!;
        nextIndex += 1;
        results.push(await worker(current));
      }
    }),
  );
  return results;
}

function normalizedConcurrency(value: number | undefined): number {
  if (value === undefined) return DEFAULT_VLM_CONCURRENCY;
  if (!Number.isFinite(value)) return DEFAULT_VLM_CONCURRENCY;
  return Math.max(1, Math.min(8, Math.floor(value)));
}

function buildVlmPrompt(evidence: RawRecord, metadata: ImageMetadata | null, context: ImagePromptContext): string {
  const properties = recordValue(evidence.properties);
  return [
    "判断这张教材图片是否应该作为知识证据保留。请同时依据图片内容和图片在教材中的上下文判断。",
    "保留：直接表达概念、结构、实验、数据、流程、地图、模型、例题或其他核心知识内容。",
    "过滤：栏目图标、提示语、页眉页脚、二维码、标志、装饰图，或者图片内容和当前标题/上下文明显不匹配。",
    "如果图片本身有知识内容，但和标题、前后文或当前课时明显不相关，返回 keep=false、relevance=\"mismatch\"。",
    "如果图片只是装饰或栏目提示，即使附近正文有知识内容，也返回 keep=false、relevance=\"decorative\"。",
    "无法判断时不要猜，返回 keep=true、relevance=\"uncertain\"，交给人工复核。",
    "只返回 JSON：keep、relevance、reason、confidence。",
    "",
    "教材上下文：",
    `标题路径：${context.headingPath.length > 0 ? context.headingPath.join(" / ") : stringValue(evidence.anchor_ref) || "未知"}`,
    `源文件：${context.sourcePath || "未知"}`,
    `源文件行：${context.sourceLine ?? "未知"}`,
    context.before.length > 0 ? `前文：${context.before.join(" / ").slice(0, 900)}` : "前文：无",
    `图片行：${(context.imageLine || stringValue(evidence.excerpt) || "无").slice(0, 500)}`,
    context.after.length > 0 ? `后文：${context.after.join(" / ").slice(0, 900)}` : "后文：无",
    "",
    "证据元数据：",
    `图片说明：${stringValue(properties.caption) || "无"}`,
    `图片路径：${stringValue(properties.path) || "无"}`,
    `证据原文：${stringValue(evidence.excerpt).slice(0, 500)}`,
    `位置：${stringValue(evidence.locator) || "无"}`,
    metadata ? `尺寸：${metadata.width}x${metadata.height}` : "尺寸：未知",
  ].join("\n");
}

function buildChatVlmBody(model: string, prompt: string, imageUrl: string): RawRecord {
  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: imageRelevanceJsonSchema(),
    },
  };
}

function buildResponsesVlmBody(model: string, prompt: string, imageUrl: string): RawRecord {
  return {
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: imageUrl },
        ],
      },
    ],
    text: { format: { type: "json_schema", ...imageRelevanceJsonSchema() } },
  };
}

function imageRelevanceJsonSchema(): RawRecord {
  return {
    name: "textbook_image_relevance",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        keep: { type: "boolean" },
        relevance: { type: "string", enum: ["core_content", "supporting", "decorative", "mismatch", "uncertain"] },
        reason: { type: "string" },
        confidence: { type: "number" },
      },
      required: ["keep", "relevance", "reason", "confidence"],
    },
  };
}

function parseVlmDecision(body: unknown): Omit<ImageRelevanceDecision, "source" | "path" | "width" | "height"> {
  const direct = isRecord(body) && typeof body.keep === "boolean" ? body : undefined;
  const parsed = direct ?? parseJsonObject(extractModelText(body));
  const relevance = parseRelevanceLabel(parsed.relevance);
  return {
    keep: typeof parsed.keep === "boolean" ? parsed.keep : relevance !== "decorative" && relevance !== "mismatch",
    relevance,
    reason: stringValue(parsed.reason).trim() || "VLM 未给出原因。",
    confidence: numberOrUndefined(parsed.confidence),
  };
}

function extractModelText(body: unknown): string {
  if (!isRecord(body)) throw new Error("VLM response must be a JSON object.");
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const firstChoice = choices[0];
  if (isRecord(firstChoice) && isRecord(firstChoice.message)) {
    const content = firstChoice.message.content;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\n");
      if (text.trim()) return text;
    }
  }

  const output = Array.isArray(body.output) ? body.output : [];
  for (const message of output) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const content of message.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("VLM response did not contain text output.");
}

function parseJsonObject(text: string): RawRecord {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced) candidates.push(fenced[1]!.trim());
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));

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
  throw new Error(`VLM JSON output must be an object: ${errors[0] ?? "empty output"}`);
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

function parseRelevanceLabel(value: unknown): ImageRelevanceLabel {
  const raw = stringValue(value);
  if (raw === "core_content" || raw === "supporting" || raw === "decorative" || raw === "mismatch" || raw === "uncertain") return raw;
  return "uncertain";
}

type CachedImageDecisionInput = {
  endpoint: string;
  model: string;
  imageHash: string;
  promptHash: string;
  decision: ImageRelevanceDecision;
};

function imageRelevanceCacheKey(input: Omit<CachedImageDecisionInput, "decision">): string {
  return sha256(JSON.stringify([
    CACHE_VERSION,
    PROMPT_VERSION,
    input.endpoint,
    input.model,
    input.imageHash,
    input.promptHash,
  ]));
}

function readCachedDecision(cacheDir: string | undefined, key: string): ImageRelevanceDecision | null {
  if (!cacheDir) return null;
  const cachePath = resolve(cacheDir, `${key}.json`);
  if (!existsSync(cachePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.version !== CACHE_VERSION || parsed.prompt_version !== PROMPT_VERSION) return null;
    const rawDecision = recordValue(parsed.decision);
    const relevance = parseRelevanceLabel(rawDecision.relevance);
    return {
      keep: typeof rawDecision.keep === "boolean" ? rawDecision.keep : relevance !== "decorative" && relevance !== "mismatch",
      relevance,
      reason: stringValue(rawDecision.reason).trim() || "缓存的 VLM 判断未给出原因。",
      confidence: numberOrUndefined(rawDecision.confidence),
      source: "vlm",
    };
  } catch {
    return null;
  }
}

function writeCachedDecision(cacheDir: string | undefined, key: string, input: CachedImageDecisionInput): void {
  if (!cacheDir) return;
  try {
    mkdirSync(cacheDir, { recursive: true });
    const cachePath = resolve(cacheDir, `${key}.json`);
    const tempPath = resolve(cacheDir, `${key}.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tempPath, `${JSON.stringify({
      version: CACHE_VERSION,
      prompt_version: PROMPT_VERSION,
      endpoint: input.endpoint,
      model: input.model,
      image_hash: input.imageHash,
      prompt_hash: input.promptHash,
      updated_at: new Date().toISOString(),
      decision: {
        keep: input.decision.keep,
        relevance: input.decision.relevance,
        reason: input.decision.reason,
        confidence: input.decision.confidence,
        source: input.decision.source,
      },
    }, null, 2)}\n`);
    renameSync(tempPath, cachePath);
  } catch {
    // 缓存只是提速手段，失败不能影响抽取结果。
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function pruneDroppedEvidenceRefs(payload: RawRecord, dropped: Set<string>): RawRecord {
  return {
    ...payload,
    nodes: pruneNodeRefs(recordArray(payload.nodes), dropped),
    edges: pruneRecords(recordArray(payload.edges), dropped, { dropWhenEmptyAfterPrune: true }),
    mentions: pruneRecords(recordArray(payload.mentions), dropped, { dropWhenEmptyAfterPrune: true }),
    domain_profiles: pruneRecords(recordArray(payload.domain_profiles), dropped, { dropWhenEmptyAfterPrune: false }),
    node_cards: pruneNodeCards(recordArray(payload.node_cards), dropped),
  };
}

function repairPrunedEvidenceReferences(payload: RawRecord): RawRecord {
  const nodes = recordArray(payload.nodes);
  const evidence = recordArray(payload.evidence);
  if (nodes.length === 0 || evidence.length === 0) return payload;

  const fallbackEvidenceId = firstFallbackEvidenceId(evidence);
  if (!fallbackEvidenceId) return payload;

  const nodeIds = new Set(nodes.map((node) => stringValue(node.id)).filter(Boolean));
  const repairedNodes = nodes.map((node) => (trimmedStrings(node.source_refs).length > 0 ? node : { ...node, source_refs: [fallbackEvidenceId] }));
  const mentions = recordArray(payload.mentions);
  const mentionedNodeIds = new Set(
    mentions
      .filter((mention) => trimmedStrings(mention.source_refs).length > 0)
      .map((mention) => stringValue(mention.target_id))
      .filter(Boolean),
  );
  const repairedMentions = [...mentions];
  for (const nodeId of nodeIds) {
    if (mentionedNodeIds.has(nodeId)) continue;
    repairedMentions.push({
      id: `mention:image-filter-backfill:${safeToken(nodeId)}`,
      source_type: stringValue(evidence[0]?.source_type || "textbook"),
      source_id: stringValue(evidence[0]?.source_id || payload.book_id || ""),
      anchor_ref: stringValue(evidence[0]?.anchor_ref || payload.batch_anchor || ""),
      target_type: "node",
      target_id: nodeId,
      role: "mentions",
      source_refs: [fallbackEvidenceId],
      confidence: 0.68,
      properties: { backfilled_after_image_filter: true },
    });
  }

  return {
    ...payload,
    nodes: repairedNodes,
    edges: repairRecordRefs(recordArray(payload.edges), fallbackEvidenceId),
    mentions: repairedMentions,
    domain_profiles: repairRecordRefs(recordArray(payload.domain_profiles), fallbackEvidenceId),
    node_cards: repairNodeCardRefs(recordArray(payload.node_cards), fallbackEvidenceId),
  };
}

function firstFallbackEvidenceId(evidence: RawRecord[]): string {
  const preferred = evidence.find((item) => stringValue(item.modality).toLowerCase() !== "image");
  return stringValue(preferred?.id || preferred?.raw_evidence_id || evidence[0]?.id || evidence[0]?.raw_evidence_id);
}

function pruneNodeRefs(nodes: RawRecord[], dropped: Set<string>): RawRecord[] {
  return nodes.map((node) => ({ ...node, source_refs: trimmedStrings(node.source_refs).filter((ref) => !dropped.has(ref)) }));
}

function repairRecordRefs(records: RawRecord[], fallbackEvidenceId: string): RawRecord[] {
  return records.map((record) => (trimmedStrings(record.source_refs).length > 0 ? record : { ...record, source_refs: [fallbackEvidenceId] }));
}

function repairNodeCardRefs(cards: RawRecord[], fallbackEvidenceId: string): RawRecord[] {
  return cards.map((card) => {
    const sections = Array.isArray(card.sections)
      ? card.sections.map((section) => {
          if (!isRecord(section) || trimmedStrings(section.source_refs).length > 0) return section;
          return { ...section, source_refs: [fallbackEvidenceId] };
        })
      : card.sections;
    return {
      ...card,
      source_refs: trimmedStrings(card.source_refs).length > 0 ? trimmedStrings(card.source_refs) : [fallbackEvidenceId],
      sections,
    };
  });
}

function safeToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 96) || "node";
}

function pruneRecords(records: RawRecord[], dropped: Set<string>, options: { dropWhenEmptyAfterPrune: boolean }): RawRecord[] {
  const result: RawRecord[] = [];
  for (const record of records) {
    const originalRefs = trimmedStrings(record.source_refs);
    const sourceRefs = originalRefs.filter((ref) => !dropped.has(ref));
    if (options.dropWhenEmptyAfterPrune && originalRefs.length > 0 && sourceRefs.length === 0) continue;
    result.push({ ...record, source_refs: sourceRefs });
  }
  return result;
}

function pruneNodeCards(cards: RawRecord[], dropped: Set<string>): RawRecord[] {
  return cards.map((card) => {
    const sections = Array.isArray(card.sections)
      ? card.sections.map((section) => {
          if (!isRecord(section)) return section;
          return {
            ...section,
            source_refs: trimmedStrings(section.source_refs).filter((ref) => !dropped.has(ref)),
          };
        })
      : card.sections;
    return {
      ...card,
      source_refs: trimmedStrings(card.source_refs).filter((ref) => !dropped.has(ref)),
      sections,
    };
  });
}

function imagePromptContext(evidence: RawRecord, imagePath: string, repoRoot: string, sourceLineCache: SourceLineCache | undefined): ImagePromptContext {
  const properties = recordValue(evidence.properties);
  const sourcePath = stringValue(evidence.source_path || properties.source_path).trim();
  const fallbackLine = cleanContextLine(stringValue(evidence.excerpt));
  const fallback: ImagePromptContext = {
    sourcePath,
    sourceLine: null,
    headingPath: [],
    before: [],
    imageLine: fallbackLine,
    after: [],
  };

  const resolvedSourcePath = resolveSourcePath(sourcePath, repoRoot);
  if (!resolvedSourcePath) return fallback;

  const lines = readSourceLines(resolvedSourcePath, sourceLineCache);
  if (!lines) return fallback;

  const sourceLine =
    findImageSourceLine(lines, rawImagePathFromEvidence(evidence), imagePath, stringValue(evidence.excerpt)) ||
    lineNumberFromLocator(stringValue(evidence.locator));
  if (!sourceLine || sourceLine < 1 || sourceLine > lines.length) return fallback;

  const lineIndex = sourceLine - 1;
  return {
    sourcePath,
    sourceLine,
    headingPath: headingPathForLine(lines, lineIndex),
    before: nearbyContextLines(lines, lineIndex, -1),
    imageLine: cleanContextLine(lines[lineIndex] ?? "") || fallbackLine,
    after: nearbyContextLines(lines, lineIndex, 1),
  };
}

function resolveSourcePath(sourcePath: string, repoRoot: string): string {
  if (!sourcePath || /^https?:\/\//i.test(sourcePath)) return "";
  return isAbsolute(sourcePath) ? sourcePath : resolve(repoRoot, sourcePath);
}

function readSourceLines(sourcePath: string, sourceLineCache: SourceLineCache | undefined): string[] | null {
  if (sourceLineCache?.has(sourcePath)) return sourceLineCache.get(sourcePath) ?? null;
  let lines: string[] | null = null;
  try {
    if (existsSync(sourcePath)) lines = readFileSync(sourcePath, "utf8").split(/\r?\n/);
  } catch {
    lines = null;
  }
  sourceLineCache?.set(sourcePath, lines);
  return lines;
}

function rawImagePathFromEvidence(evidence: RawRecord): string {
  const properties = recordValue(evidence.properties);
  return stringValue(properties.path || properties.image_path || evidence.path).trim() || imagePathFromMarkdown(stringValue(evidence.excerpt));
}

function lineNumberFromLocator(locator: string): number | null {
  const match = /line:(\d+)/i.exec(locator);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function findImageSourceLine(lines: string[], rawImagePath: string, imagePath: string, excerpt: string): number | null {
  const candidates = imagePathCandidates(rawImagePath, imagePath, imagePathFromMarkdown(excerpt));
  for (let index = 0; index < lines.length; index += 1) {
    if (candidates.some((candidate) => lines[index]?.includes(candidate))) return index + 1;
  }

  const normalizedExcerpt = cleanContextLine(excerpt);
  if (normalizedExcerpt.length < 8) return null;
  for (let index = 0; index < lines.length; index += 1) {
    if (cleanContextLine(lines[index] ?? "").includes(normalizedExcerpt)) return index + 1;
  }
  return null;
}

function imagePathCandidates(...values: string[]): string[] {
  const candidates = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    candidates.add(trimmed);
    candidates.add(safeDecodeURIComponent(trimmed));
    const base = basenameFromPath(trimmed);
    if (base) candidates.add(base);
  }
  return [...candidates].filter((candidate) => candidate.length > 0);
}

function basenameFromPath(value: string): string {
  return value.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "";
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function headingPathForLine(lines: string[], lineIndex: number): string[] {
  const headings: string[] = [];
  for (let index = 0; index <= lineIndex; index += 1) {
    const match = /^(#{1,6})\s+(.+)$/.exec(lines[index]?.trim() ?? "");
    if (!match) continue;
    const level = match[1].length;
    headings[level - 1] = cleanContextLine(match[2]);
    headings.length = level;
  }
  return headings.filter(Boolean);
}

function nearbyContextLines(lines: string[], lineIndex: number, direction: -1 | 1): string[] {
  const output: string[] = [];
  for (let index = lineIndex + direction; index >= 0 && index < lines.length; index += direction) {
    if (/^#{1,6}\s+/.test(lines[index]?.trim() ?? "")) continue;
    const line = cleanContextLine(lines[index] ?? "");
    if (line && line !== "[图片]") {
      if (direction === -1) output.unshift(line);
      else output.push(line);
    }
    if (output.length >= 4) break;
  }
  return output;
}

function cleanContextLine(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match: string, alt: string, src: string) => {
      const label = alt.trim() || basenameFromPath(src.trim()) || "图片";
      return `[图片：${label}]`;
    })
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveEvidenceImagePath(evidence: RawRecord, repoRoot: string): string | undefined {
  const properties = recordValue(evidence.properties);
  const rawPath = stringValue(properties.path || properties.image_path || evidence.path).trim() || imagePathFromMarkdown(stringValue(evidence.excerpt));
  if (!rawPath || /^https?:\/\//i.test(rawPath)) return rawPath || undefined;
  if (isAbsolute(rawPath)) return rawPath;

  const candidates: string[] = [];
  const sourcePath = stringValue(evidence.source_path || properties.source_path).trim();
  if (sourcePath) {
    const sourceAbs = isAbsolute(sourcePath) ? sourcePath : resolve(repoRoot, sourcePath);
    candidates.push(resolve(dirname(sourceAbs), rawPath));
  }
  candidates.push(resolve(repoRoot, rawPath));
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function imagePathFromMarkdown(value: string): string {
  return /!\[[^\]]*\]\(([^)]+)\)/.exec(value)?.[1]?.trim() ?? "";
}

type ImageMetadata = { width: number; height: number };

function readImageMetadata(path: string): ImageMetadata | null {
  if (!path || /^https?:\/\//i.test(path) || !existsSync(path)) return null;
  const buffer = readFileSync(path);
  if (buffer.length < 10) return null;
  if (buffer.toString("ascii", 1, 4) === "PNG" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.toString("ascii", 0, 3) === "GIF" && buffer.length >= 10) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return readJpegMetadata(buffer);
  return null;
}

function readJpegMetadata(buffer: Buffer): ImageMetadata | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker !== undefined && marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function normalizeVlmEndpoint(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (/\/(chat\/completions|responses)$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;
  return trimmed;
}

function mimeTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function mergeIssues(existing: unknown, added: string[]): string[] {
  return [...trimmedStrings(existing), ...added];
}

function recordArray(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function recordValue(value: unknown): RawRecord {
  return isRecord(value) ? value : {};
}

function trimmedStrings(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list.map((item) => stringValue(item).trim()).filter(Boolean);
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
