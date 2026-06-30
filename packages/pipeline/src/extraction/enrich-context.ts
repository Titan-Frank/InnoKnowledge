import type { SqlStatement } from "../staging/staging-sql.js";

type RawRecord = Record<string, unknown>;

type EnrichTreeNode = {
  title: string;
  enrichment: RawRecord;
  child_nodes: RawRecord[];
};

type FlatEnrichNode = {
  title: string;
  titlePath: string[];
  enrichment: RawRecord;
};

type EnrichBookRow = {
  path: string;
  filename: string;
  title: string;
  subject: string;
  stage: string;
  grade: string;
  course: string;
  publisher: string;
  volume: string;
  tree_json: unknown;
};

export type EnrichHint = {
  source: "enrich";
  book_path: string;
  book_title: string;
  title_path: string[];
  title: string;
  definition?: string;
  content_excerpt?: string;
  academic_requirements_excerpt?: string;
  academic_quality_excerpt?: string;
  match_score: number;
  match_reason: string;
};

export type EnrichContextQueryExecutor = (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];

export type LoadEnrichHintsForLessonInput = {
  datasetId: string;
  executor: EnrichContextQueryExecutor;
  bookId?: string;
  textbookId?: string;
  bookTitle?: string;
  subject?: string;
  schoolStage?: string;
  gradeBand?: string;
  lessonTitle?: unknown;
  outlineTitlePath?: string[];
  markdownLines?: string[];
  limit?: number;
};

export type EnrichBookCandidateQueryInput = {
  datasetId: string;
  subject?: string;
  schoolStage?: string;
  limit?: number;
};

type LessonQuery = {
  terms: string[];
  titleTerms: string[];
  pathTerms: string[];
  rawTitle: string;
};

export async function loadEnrichHintsForLesson(input: LoadEnrichHintsForLessonInput): Promise<EnrichHint[]> {
  if (!input.datasetId.trim()) return [];
  const rows = await input.executor(
    buildEnrichBookCandidatesQuery({
      datasetId: input.datasetId,
      subject: input.subject,
      schoolStage: input.schoolStage,
      limit: Math.max(8, (input.limit ?? 6) * 8),
    }),
  );
  const query = buildLessonQuery(input);
  const hints: Array<EnrichHint & { raw_score: number }> = [];

  for (const rawRow of rows) {
    const row = normalizeBookRow(rawRow);
    const bookScore = scoreBook(row, input);
    for (const node of flattenEnrichTree(row.tree_json)) {
      const nodeScore = scoreEnrichNode(node, query);
      if (nodeScore.score <= 0) continue;
      hints.push({
        ...toEnrichHint(row, node, bookScore + nodeScore.score, nodeScore.reasons),
        raw_score: bookScore + nodeScore.score,
      });
    }
  }

  return hints
    .sort((left, right) => right.raw_score - left.raw_score || left.title_path.length - right.title_path.length || left.title.localeCompare(right.title))
    .slice(0, input.limit ?? 6)
    .map(({ raw_score, ...hint }) => hint);
}

export function buildEnrichBookCandidatesQuery(input: EnrichBookCandidateQueryInput): SqlStatement {
  const params: unknown[] = [input.datasetId];
  const clauses = ["dataset_id = $1"];
  const subjectClauses = textMatchClauses("subject", "title", "path", subjectAliases(input.subject), params);
  if (subjectClauses.length > 0) clauses.push(`(${subjectClauses.join(" OR ")})`);
  const stageClauses = textMatchClauses("stage", "title", "path", stageAliases(input.schoolStage), params);
  if (stageClauses.length > 0) clauses.push(`(${stageClauses.join(" OR ")})`);

  params.push(input.limit ?? 48);
  const limitIndex = params.length;
  return {
    name: "select-enrich-context-books",
    sql: [
      "SELECT path, filename, title, subject, stage, grade, course, publisher, volume, tree_json",
      "FROM world_enrich_books",
      `WHERE ${clauses.join(" AND ")}`,
      "ORDER BY subject NULLS LAST, stage NULLS LAST, grade NULLS LAST, title ASC, path ASC",
      `LIMIT $${limitIndex}`,
    ].join("\n"),
    params,
  };
}

export function outlineTitlePathFromRecord(outline: RawRecord | undefined, anchor: string): string[] {
  if (!outline || !anchor.trim()) return [];
  const roots = Array.isArray(outline.items) ? outline.items : Array.isArray(outline.structure) ? outline.structure : [];
  const nodes: Array<{ id: string; parentId: string; title: string }> = [];
  collectOutlineItems(roots, "", nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(anchor);
  const path: string[] = [];
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.title) path.unshift(current.title);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function textMatchClauses(exactColumn: string, titleColumn: string, pathColumn: string, aliases: string[], params: unknown[]): string[] {
  const clauses: string[] = [];
  for (const alias of aliases) {
    params.push(alias);
    clauses.push(`${exactColumn} = $${params.length}`);
    params.push(`%${alias}%`);
    clauses.push(`${titleColumn} ILIKE $${params.length}`);
    params.push(`%${alias}%`);
    clauses.push(`${pathColumn} ILIKE $${params.length}`);
  }
  return clauses;
}

function buildLessonQuery(input: LoadEnrichHintsForLessonInput): LessonQuery {
  const rawTitle = stringValue(input.lessonTitle);
  const titleTerms = uniqueNonEmpty([rawTitle, ...lineTerms(input.markdownLines ?? [], { headingsOnly: true })]).map(normalizeForMatch).filter(Boolean);
  const pathTerms = uniqueNonEmpty(input.outlineTitlePath ?? []).map(normalizeForMatch).filter(Boolean);
  const textTerms = lineTerms(input.markdownLines ?? [], { headingsOnly: false }).map(normalizeForMatch).filter((term) => term.length >= 2);
  return {
    terms: uniqueNonEmpty([...titleTerms, ...pathTerms, ...textTerms]).slice(0, 18),
    titleTerms,
    pathTerms,
    rawTitle,
  };
}

function lineTerms(lines: string[], options: { headingsOnly: boolean }): string[] {
  const result: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("!") || line.startsWith("|")) continue;
    if (line.startsWith("#")) {
      result.push(line.replace(/^#+/, "").trim());
    } else if (!options.headingsOnly && line.length <= 40 && !/[。.!?？]$/.test(line)) {
      result.push(line);
    }
    if (result.length >= 10) break;
  }
  return result;
}

function scoreBook(row: EnrichBookRow, input: LoadEnrichHintsForLessonInput): number {
  const metadataText = normalizeForMatch([
    row.path,
    row.filename,
    row.title,
    row.subject,
    row.stage,
    row.grade,
    row.course,
    row.publisher,
    row.volume,
  ].join(" "));
  let score = 0;
  for (const alias of subjectAliases(input.subject)) {
    const normalized = normalizeForMatch(alias);
    if (normalizeForMatch(row.subject) === normalized) score += 40;
    else if (metadataText.includes(normalized)) score += 20;
  }
  for (const alias of stageAliases(input.schoolStage)) {
    const normalized = normalizeForMatch(alias);
    if (normalizeForMatch(row.stage) === normalized) score += 20;
    else if (metadataText.includes(normalized)) score += 8;
  }
  for (const alias of gradeAliases(input.gradeBand)) {
    if (metadataText.includes(normalizeForMatch(alias))) score += 6;
  }
  for (const keyword of bookKeywordVariants(input)) {
    const normalized = normalizeForMatch(keyword);
    if (normalized.length >= 3 && metadataText.includes(normalized)) score += 10;
  }
  return score;
}

function scoreEnrichNode(node: FlatEnrichNode, query: LessonQuery): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const title = normalizeForMatch(node.title);
  const pathText = normalizeForMatch(node.titlePath.join(" "));
  const enrichmentText = normalizeForMatch([
    stringValue(node.enrichment.definition),
    stringValue(node.enrichment.content),
    stringValue(node.enrichment.academic_requirements),
  ].join(" "));
  const allText = `${title} ${pathText} ${enrichmentText}`;
  let score = 0;

  for (const term of query.titleTerms) {
    if (!term) continue;
    if (title === term) {
      score += 100;
      reasons.push("课时标题精确匹配");
    } else if (title.includes(term) || term.includes(title)) {
      score += 70;
      reasons.push("课时标题相近");
    } else if (pathText.includes(term)) {
      score += 35;
      reasons.push("目录路径匹配课时标题");
    }
  }

  for (const term of query.pathTerms) {
    if (!term) continue;
    if (pathText.includes(term)) {
      score += 24;
      reasons.push("目录层级相近");
    }
  }

  for (const term of query.terms) {
    if (term.length < 2) continue;
    if (allText.includes(term)) score += 8;
  }

  if (/练习|复习|小结|整理与提升/.test(node.title) && normalizeForMatch(node.title) !== normalizeForMatch(query.rawTitle)) {
    score -= 20;
  }

  return { score, reasons: uniqueNonEmpty(reasons).slice(0, 3) };
}

function toEnrichHint(row: EnrichBookRow, node: FlatEnrichNode, score: number, reasons: string[]): EnrichHint {
  const enrichment = node.enrichment;
  const hint: EnrichHint = {
    source: "enrich",
    book_path: row.path,
    book_title: row.title || row.filename,
    title_path: node.titlePath,
    title: node.title,
    definition: excerpt(stringValue(enrichment.definition), 180),
    content_excerpt: excerpt(stringValue(enrichment.content), 240),
    academic_requirements_excerpt: excerpt(stringValue(enrichment.academic_requirements), 220),
    academic_quality_excerpt: excerpt(stringValue(enrichment.academic_quality), 220),
    match_score: Math.max(0, Math.round(score)),
    match_reason: reasons.length > 0 ? reasons.join("；") : "标题或正文术语相近",
  };
  return Object.fromEntries(Object.entries(hint).filter(([, value]) => value !== "" && value !== undefined)) as EnrichHint;
}

function normalizeBookRow(row: RawRecord): EnrichBookRow {
  return {
    path: stringValue(row.path),
    filename: stringValue(row.filename),
    title: stringValue(row.title),
    subject: stringValue(row.subject),
    stage: stringValue(row.stage),
    grade: stringValue(row.grade),
    course: stringValue(row.course),
    publisher: stringValue(row.publisher),
    volume: stringValue(row.volume),
    tree_json: row.tree_json,
  };
}

function flattenEnrichTree(tree: unknown): FlatEnrichNode[] {
  const result: FlatEnrichNode[] = [];
  const roots = Array.isArray(tree) ? tree.filter(isRecord) : [];
  for (const root of roots) collectEnrichNode(root, [], result);
  return result;
}

function collectEnrichNode(rawNode: RawRecord, parentPath: string[], result: FlatEnrichNode[]): void {
  const node = normalizeEnrichNode(rawNode);
  if (!node.title) return;
  const titlePath = [...parentPath, node.title];
  result.push({ title: node.title, titlePath, enrichment: node.enrichment });
  for (const child of node.child_nodes) collectEnrichNode(child, titlePath, result);
}

function normalizeEnrichNode(rawNode: RawRecord): EnrichTreeNode {
  const children = Array.isArray(rawNode.child_nodes) ? rawNode.child_nodes.filter(isRecord) : [];
  return {
    title: stringValue(rawNode.title),
    enrichment: isRecord(rawNode.enrichment) ? rawNode.enrichment : {},
    child_nodes: children,
  };
}

function collectOutlineItems(rawItems: unknown[], parentId: string, result: Array<{ id: string; parentId: string; title: string }>): void {
  for (const rawItem of rawItems) {
    if (!isRecord(rawItem)) continue;
    const id = stringValue(rawItem.id);
    const itemParentId = stringValue(rawItem.parent_id) || parentId;
    if (id) result.push({ id, parentId: itemParentId, title: stringValue(rawItem.title) || stringValue(rawItem.label) });
    const childParentId = id || itemParentId;
    for (const childKey of ["items", "structure", "children", "child_nodes"]) {
      const children = rawItem[childKey];
      if (Array.isArray(children)) collectOutlineItems(children, childParentId, result);
    }
  }
}

function subjectAliases(subject: string | undefined): string[] {
  const aliases: Record<string, string[]> = {
    chemistry: ["化学"],
    physics: ["物理"],
    biology: ["生物"],
    mathematics: ["数学"],
    geography: ["地理"],
    history: ["历史"],
    "language-arts": ["语文"],
    english: ["英语"],
    "computer-science": ["信息技术", "信息科技"],
  };
  return aliases[(subject ?? "").trim().toLowerCase()] ?? [];
}

function stageAliases(stage: string | undefined): string[] {
  const aliases: Record<string, string[]> = {
    primary: ["小学"],
    "junior-secondary": ["初中"],
    "senior-secondary": ["高中"],
  };
  return aliases[(stage ?? "").trim().toLowerCase()] ?? [];
}

function gradeAliases(gradeBand: string | undefined): string[] {
  const aliases: Record<string, string[]> = {
    grade1: ["一年级"],
    grade2: ["二年级"],
    grade3: ["三年级"],
    grade4: ["四年级"],
    grade5: ["五年级"],
    grade6: ["六年级"],
    grade7: ["七年级", "初一"],
    grade8: ["八年级", "初二"],
    grade9: ["九年级", "初三"],
    grade10: ["高一"],
    grade11: ["高二", "选择性必修"],
    grade12: ["高三"],
  };
  return aliases[(gradeBand ?? "").trim().toLowerCase()] ?? [];
}

function bookKeywordVariants(input: LoadEnrichHintsForLessonInput): string[] {
  const raw = [input.bookTitle, input.bookId, input.textbookId].map(stringValue).filter(Boolean);
  const result: string[] = [];
  for (const value of raw) {
    result.push(value);
    result.push(...value.split(/[\s/_-]+/).filter((part) => part.length >= 2));
    const selective = value.match(/选择性必修\s*[一二三四五六\d]+/g);
    if (selective) result.push(...selective);
    const compulsory = value.match(/必修\s*(?:第)?[一二三四五六\d]+册?/g);
    if (compulsory) result.push(...compulsory);
  }
  const joined = raw.join(" ").toLowerCase();
  if (/\bxb\s*1\b|xb1|选择性必修\s*1/.test(joined)) result.push("选择性必修1");
  if (/\bxb\s*2\b|xb2|选择性必修\s*2/.test(joined)) result.push("选择性必修2");
  if (/\bxb\s*3\b|xb3|选择性必修\s*3/.test(joined)) result.push("选择性必修3");
  if (/hukj|沪科技|沪科教/.test(joined)) result.push("沪科技", "沪科教");
  if (/rj|pep|人教/.test(joined)) result.push("人教");
  if (/structure|物质结构/.test(joined)) result.push("物质结构与性质");
  return uniqueNonEmpty(result);
}

function excerpt(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function uniqueNonEmpty(values: Iterable<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
