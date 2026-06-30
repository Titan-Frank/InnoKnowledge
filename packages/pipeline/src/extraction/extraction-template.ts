import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { VALID_EDGE_TYPES, VALID_NODE_KINDS } from "../shared/knowledge.js";
import { REPO_ROOT } from "../shared/pathing.js";

type RawRecord = Record<string, unknown>;

export type ExtractionTemplate = {
  id: string;
  version: number;
  name: string;
  description: string;
  selector: {
    subjects: string[];
    book_id_patterns: string[];
  };
  prompt: {
    focus: string[];
    node_rules: string[];
    edge_rules: string[];
    evidence_rules: string[];
  };
  output: {
    node_fields: string[];
    edge_fields: string[];
    evidence_fields: string[];
    allowed_node_kinds: string[];
    preferred_edge_types: string[];
  };
  identifiers: {
    node_id: string;
    relation_id: string;
    evidence_anchor: string;
  };
  display: {
    node_labels: Record<string, string>;
    edge_labels: Record<string, string>;
    colors: Record<string, string>;
  };
};

export type ExtractionTemplateSummary = {
  id: string;
  name: string;
  description: string;
  subjects: string[];
};

export const AUTO_EXTRACTION_TEMPLATE_ID = "auto";
export const DEFAULT_EXTRACTION_TEMPLATE_ID = "textbook/general";

const TEMPLATE_DIR = join("schemas", "extraction-templates", "textbook");

export function resolveExtractionTemplate(input: {
  repoRoot?: string;
  templateId?: string | null;
  subject?: string | null;
  bookId?: string | null;
} = {}): ExtractionTemplate {
  const templates = loadTextbookExtractionTemplates(input.repoRoot);
  const requested = normalizeTemplateId(input.templateId);
  if (requested !== AUTO_EXTRACTION_TEMPLATE_ID) {
    return templateByIdOrThrow(templates, requested);
  }
  return selectExtractionTemplate(templates, input.subject, input.bookId);
}

export function loadTextbookExtractionTemplates(repoRoot = REPO_ROOT): ExtractionTemplate[] {
  const dir = resolve(repoRoot, TEMPLATE_DIR);
  if (!existsSync(dir)) {
    if (resolve(repoRoot) !== resolve(REPO_ROOT)) return loadTextbookExtractionTemplates(REPO_ROOT);
    return [];
  }
  return readdirSync(dir)
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort()
    .map((file) => readExtractionTemplateFile(resolve(dir, file)));
}

export function listTextbookExtractionTemplateSummaries(repoRoot = REPO_ROOT): ExtractionTemplateSummary[] {
  return loadTextbookExtractionTemplates(repoRoot).map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    subjects: template.selector.subjects,
  }));
}

export function buildTemplateInstructionBlock(template: ExtractionTemplate, stage: "node_evidence" | "edges"): string {
  const stageHint = stage === "node_evidence"
    ? "本阶段只使用模板中的节点、证据和标识符规则，不输出关系。"
    : "本阶段只使用模板中的关系、证据和展示标签规则，不新增节点。";
  const lines = [
    `教材抽取模板：${template.name}（${template.id} v${template.version}）`,
    template.description,
    stageHint,
    "",
    "抽取重点：",
    ...bulletLines(template.prompt.focus),
    "",
    "证据规则：",
    ...bulletLines(template.prompt.evidence_rules),
    "",
  ];
  if (stage === "node_evidence") {
    lines.push(
      "节点规则：",
      ...bulletLines(template.prompt.node_rules),
      "",
      "输出字段：",
      `- nodes: ${template.output.node_fields.join(", ")}`,
      `- evidence_units: ${template.output.evidence_fields.join(", ")}`,
      `- allowed_node_kinds: ${template.output.allowed_node_kinds.join(", ")}`,
      "",
      "标识符规则：",
      `- node.id: ${template.identifiers.node_id}`,
      `- evidence.anchor: ${template.identifiers.evidence_anchor}`,
      "",
      "展示标签：",
      `- node_labels: ${formatRecord(template.display.node_labels)}`,
    );
  } else {
    lines.push(
      "关系规则：",
      ...bulletLines(template.prompt.edge_rules),
      "",
      "输出字段：",
      `- edges: ${template.output.edge_fields.join(", ")}`,
      `- preferred_edge_types: ${template.output.preferred_edge_types.join(", ")}`,
      "",
      "标识符规则：",
      `- edge.id: ${template.identifiers.relation_id}`,
      `- evidence.anchor: ${template.identifiers.evidence_anchor}`,
      "",
      "展示标签：",
      `- edge_labels: ${formatRecord(template.display.edge_labels)}`,
    );
  }
  return lines.join("\n").trim();
}

export function templateModelPayload(template: ExtractionTemplate): RawRecord {
  return {
    id: template.id,
    version: template.version,
    name: template.name,
    description: template.description,
    focus: template.prompt.focus,
    output: template.output,
    identifiers: template.identifiers,
    display: {
      node_labels: template.display.node_labels,
      edge_labels: template.display.edge_labels,
    },
  };
}

export function templateAllowedNodeKinds(template?: ExtractionTemplate | null): string[] {
  const values = template?.output.allowed_node_kinds ?? [];
  const filtered = values.filter((value) => VALID_NODE_KINDS.has(value));
  return filtered.length > 0 ? filtered : [...VALID_NODE_KINDS].sort();
}

export function templatePreferredEdgeTypes(template?: ExtractionTemplate | null): string[] {
  const values = template?.output.preferred_edge_types ?? [];
  const filtered = values.filter((value) => VALID_EDGE_TYPES.has(value));
  return filtered.length > 0 ? filtered : [...VALID_EDGE_TYPES].sort();
}

export function templateNodeDisplay(template: ExtractionTemplate | null | undefined, kind: string, subkind?: string | null): RawRecord | null {
  if (!template) return null;
  const key = subkind && template.display.node_labels[subkind] ? subkind : kind;
  const label = template.display.node_labels[key] ?? template.display.node_labels[kind];
  const color = template.display.colors[key] ?? template.display.colors[kind];
  if (!label && !color) return null;
  return compactRecord({
    template_id: template.id,
    type_key: key,
    label,
    color,
  });
}

export function templateEdgeDisplay(template: ExtractionTemplate | null | undefined, edgeType: string): RawRecord | null {
  if (!template) return null;
  const label = template.display.edge_labels[edgeType];
  if (!label) return null;
  return {
    template_id: template.id,
    label,
  };
}

export function templateMetadata(template: ExtractionTemplate | null | undefined): RawRecord | null {
  if (!template) return null;
  return {
    id: template.id,
    version: template.version,
    name: template.name,
  };
}

function readExtractionTemplateFile(path: string): ExtractionTemplate {
  const parsed = parseYamlSubset(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`Extraction template '${path}' must contain a YAML object.`);
  return normalizeTemplate(parsed, basename(path));
}

function selectExtractionTemplate(templates: ExtractionTemplate[], subject?: string | null, bookId?: string | null): ExtractionTemplate {
  const normalizedSubject = (subject ?? "").trim().toLowerCase();
  const normalizedBookId = (bookId ?? "").trim().toLowerCase();
  const bySubject = templates.find((template) => template.selector.subjects.some((item) => item.toLowerCase() === normalizedSubject));
  if (bySubject) return bySubject;
  const byBook = templates.find((template) =>
    template.selector.book_id_patterns.some((pattern) => pattern && normalizedBookId.includes(pattern.toLowerCase())),
  );
  if (byBook) return byBook;
  return templateByIdOrThrow(templates, DEFAULT_EXTRACTION_TEMPLATE_ID);
}

function templateByIdOrThrow(templates: ExtractionTemplate[], id: string): ExtractionTemplate {
  const normalized = normalizeTemplateId(id);
  const slug = normalized.replace(/^textbook\//, "");
  const template = templates.find((item) => item.id === normalized || item.id === `textbook/${slug}` || item.id.endsWith(`/${slug}`));
  if (!template) {
    throw new Error(`Extraction template '${id}' was not found. Available: ${templates.map((item) => item.id).join(", ")}`);
  }
  return template;
}

function normalizeTemplateId(value: string | null | undefined): string {
  const raw = (value ?? AUTO_EXTRACTION_TEMPLATE_ID).trim();
  if (!raw || raw === AUTO_EXTRACTION_TEMPLATE_ID) return AUTO_EXTRACTION_TEMPLATE_ID;
  return raw.includes("/") ? raw : `textbook/${raw}`;
}

function normalizeTemplate(raw: RawRecord, fileName: string): ExtractionTemplate {
  const id = requiredString(raw.id, `${fileName}: id`);
  const output = recordValue(raw.output);
  const display = recordValue(raw.display);
  return {
    id,
    version: Number(raw.version ?? 1),
    name: requiredString(raw.name, `${id}: name`),
    description: stringValue(raw.description),
    selector: {
      subjects: stringList(recordValue(raw.selector).subjects),
      book_id_patterns: stringList(recordValue(raw.selector).book_id_patterns),
    },
    prompt: {
      focus: stringList(recordValue(raw.prompt).focus),
      node_rules: stringList(recordValue(raw.prompt).node_rules),
      edge_rules: stringList(recordValue(raw.prompt).edge_rules),
      evidence_rules: stringList(recordValue(raw.prompt).evidence_rules),
    },
    output: {
      node_fields: stringList(output.node_fields),
      edge_fields: stringList(output.edge_fields),
      evidence_fields: stringList(output.evidence_fields),
      allowed_node_kinds: stringList(output.allowed_node_kinds),
      preferred_edge_types: stringList(output.preferred_edge_types),
    },
    identifiers: {
      node_id: requiredString(recordValue(raw.identifiers).node_id, `${id}: identifiers.node_id`),
      relation_id: requiredString(recordValue(raw.identifiers).relation_id, `${id}: identifiers.relation_id`),
      evidence_anchor: requiredString(recordValue(raw.identifiers).evidence_anchor, `${id}: identifiers.evidence_anchor`),
    },
    display: {
      node_labels: stringRecord(display.node_labels),
      edge_labels: stringRecord(display.edge_labels),
      colors: stringRecord(display.colors),
    },
  };
}

function parseYamlSubset(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Fall through to the small YAML parser below.
  }

  const lines = text.replace(/\r\n?/g, "\n")
    .split("\n")
    .map((raw) => ({ indent: raw.match(/^ */)?.[0].length ?? 0, text: stripComment(raw.trim()) }))
    .filter((line) => line.text.length > 0);
  const [value] = parseYamlBlock(lines, 0, lines[0]?.indent ?? 0);
  return value;
}

type YamlLine = { indent: number; text: string };

function parseYamlBlock(lines: YamlLine[], start: number, indent: number): [unknown, number] {
  if (lines[start]?.text.startsWith("- ")) return parseYamlArray(lines, start, indent);
  return parseYamlObject(lines, start, indent);
}

function parseYamlObject(lines: YamlLine[], start: number, indent: number): [RawRecord, number] {
  const result: RawRecord = {};
  let index = start;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      index += 1;
      continue;
    }
    if (line.text.startsWith("- ")) break;
    const colonIndex = line.text.indexOf(":");
    if (colonIndex < 0) throw new Error(`Invalid YAML line '${line.text}'.`);
    const key = line.text.slice(0, colonIndex).trim();
    const rawValue = line.text.slice(colonIndex + 1).trim();
    if (rawValue === "") {
      const next = lines[index + 1];
      if (!next || next.indent <= indent) {
        result[key] = {};
        index += 1;
        continue;
      }
      const [child, nextIndex] = parseYamlBlock(lines, index + 1, next.indent);
      result[key] = child;
      index = nextIndex;
      continue;
    }
    result[key] = parseYamlScalar(rawValue);
    index += 1;
  }
  return [result, index];
}

function parseYamlArray(lines: YamlLine[], start: number, indent: number): [unknown[], number] {
  const result: unknown[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.text.startsWith("- ")) break;
    const rawValue = line.text.slice(2).trim();
    if (rawValue === "") {
      const next = lines[index + 1];
      if (!next || next.indent <= indent) {
        result.push(null);
        index += 1;
        continue;
      }
      const [child, nextIndex] = parseYamlBlock(lines, index + 1, next.indent);
      result.push(child);
      index = nextIndex;
      continue;
    }
    result.push(parseYamlScalar(rawValue));
    index += 1;
  }
  return [result, index];
}

function parseYamlScalar(value: string): unknown {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const singleQuoted = /^'(.*)'$/.exec(value);
  if (singleQuoted) return singleQuoted[1]!.replace(/''/g, "'");
  const doubleQuoted = /^"(.*)"$/.exec(value);
  if (doubleQuoted) return doubleQuoted[1]!.replace(/\\"/g, "\"");
  return value;
}

function stripComment(value: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === "\"" && !inSingle) inDouble = !inDouble;
    else if (char === "#" && !inSingle && !inDouble) return value.slice(0, index).trimEnd();
  }
  return value;
}

function bulletLines(values: string[]): string[] {
  return values.map((value) => `- ${value}`);
}

function formatRecord(record: Record<string, string>): string {
  return Object.entries(record).map(([key, value]) => `${key}=${value}`).join("；");
}

function compactRecord(record: RawRecord): RawRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== ""));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).map((item) => item.trim()).filter(Boolean);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stringValue(item)]).filter(([, item]) => item.trim()));
}

function requiredString(value: unknown, label: string): string {
  const text = stringValue(value).trim();
  if (!text) throw new Error(`Missing required extraction template field ${label}.`);
  return text;
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function recordValue(value: unknown): RawRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
