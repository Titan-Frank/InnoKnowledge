import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

type RawRecord = Record<string, unknown>;

export type PdfOutlineItem = {
  id: string;
  kind: "theme" | "lesson";
  label: string;
  title: string;
  page_start: number;
  page_end?: number;
  level: number;
  order_path: string;
  parent_id?: string;
  raw_line: string;
};

export type PdfOutlineDocument = {
  book_id: string;
  title: string;
  source_path: string;
  generated_at: string;
  toc_pages: { start: number; end: number };
  items: PdfOutlineItem[];
};

export type PdfOutlineResult =
  | {
      status: "completed";
      outline_path: string;
      item_count: number;
      toc_pages: { start: number; end: number };
    }
  | {
      status: "blocked";
      error: string;
      outline_path: string;
    };

type TocEntry = {
  kind: "theme" | "lesson" | "boundary";
  label: string;
  title: string;
  pageStart: number;
  orderPath: string;
  level: number;
  rawLine: string;
  themeOrder?: string;
  include: boolean;
};

export function parsePdfTocText(input: {
  bookId: string;
  title: string;
  sourcePath: string;
  tocText: string;
  tocStart: number;
  tocEnd: number;
  generatedAt?: string;
}): PdfOutlineDocument {
  const entries = parseTocEntries(input.tocText);
  const included = entries.filter((entry): entry is TocEntry & { kind: "theme" | "lesson" } => entry.include && (entry.kind === "theme" || entry.kind === "lesson"));
  const items = included.map((entry) => makeOutlineItem(input.bookId, entry, entries));
  if (items.length === 0) throw new Error("Could not extract outline items from PDF TOC text.");
  return {
    book_id: input.bookId,
    title: input.title.trim() || input.bookId,
    source_path: input.sourcePath,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    toc_pages: { start: input.tocStart, end: input.tocEnd },
    items,
  };
}

export function parseTocEntries(tocText: string): TocEntry[] {
  const entries: TocEntry[] = [];
  let currentThemeOrder = "";
  for (const rawLine of tocText.split(/\r?\n/)) {
    const parsed = parseTocLine(rawLine, currentThemeOrder);
    if (!parsed) continue;
    entries.push(parsed);
    if (parsed.kind === "theme") currentThemeOrder = parsed.orderPath;
  }
  return entries;
}

export async function extractPdfOutline(input: {
  bookId: string;
  pdfPath: string;
  outlinePath: string;
  repoRoot: string;
  title?: string;
  sourcePath?: string;
  tocStart?: number;
  tocEnd?: number;
  generatedAt?: string;
  extractText?: (pdfPath: string, startPage: number, endPage: number) => Promise<string>;
}): Promise<PdfOutlineResult> {
  const pdfPath = resolveInputPath(input.pdfPath, input.repoRoot);
  const outlinePath = resolveInputPath(input.outlinePath, input.repoRoot);
  if (!existsSync(pdfPath)) return { status: "blocked", outline_path: outlinePath, error: `PDF not found: ${pdfPath}` };
  try {
    const tocStart = input.tocStart ?? 1;
    const tocEnd = input.tocEnd ?? 20;
    const tocText = await (input.extractText ?? extractTextWithPdfToText)(pdfPath, tocStart, tocEnd);
    const sourcePath = input.sourcePath ? toDisplayPath(resolveInputPath(input.sourcePath, input.repoRoot), input.repoRoot) : toDisplayPath(pdfPath, input.repoRoot);
    const outline = parsePdfTocText({
      bookId: input.bookId,
      title: input.title ?? input.bookId,
      sourcePath,
      tocText,
      tocStart,
      tocEnd,
      generatedAt: input.generatedAt,
    });
    writeJson(outlinePath, outline);
    return { status: "completed", outline_path: outlinePath, item_count: outline.items.length, toc_pages: outline.toc_pages };
  } catch (error) {
    return { status: "blocked", outline_path: outlinePath, error: (error as Error).message };
  }
}

async function extractTextWithPdfToText(pdfPath: string, startPage: number, endPage: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "okm-pdf-outline-"));
  const outPath = join(dir, "toc.txt");
  try {
    await runProcess("pdftotext", ["-f", String(startPage), "-l", String(endPage), "-layout", pdfPath, outPath]);
    return readFileSync(outPath, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseTocLine(rawLine: string, currentThemeOrder: string): TocEntry | null {
  const line = rawLine.trim();
  if (!line || /^(目\s*录|contents)$/i.test(line) || /^\d+$/.test(line)) return null;
  const match = /^(.*?)\s*(?:[.·•…．。]{2,}|[─—-]{2,}|…\s+…)\s*(\d+)\s*$/.exec(line) ?? /^(第\s*\S+\s*章\s+\S.*?)\s+(\d+)\s*$/.exec(line);
  if (!match) return null;
  const heading = normalizeTocHeading(match[1]!);
  const pageStart = Number.parseInt(match[2]!, 10);
  if (!heading || !Number.isFinite(pageStart)) return null;

  const theme = /^第\s*([0-9一二三四五六七八九十百千万]+)\s*章\s*(.+)$/.exec(heading);
  if (theme) {
    const themeNumber = normalizeNumberToken(theme[1]!);
    const title = theme[2]!.trim();
    return {
      kind: "theme",
      label: `第 ${themeNumber} 章`,
      title,
      pageStart,
      orderPath: String(themeNumber),
      level: 1,
      rawLine: `第 ${themeNumber} 章 ${title}`,
      themeOrder: String(themeNumber),
      include: true,
    };
  }

  if (/^附\s*录/.test(heading)) {
    return {
      kind: "boundary",
      label: "附录",
      title: heading,
      pageStart,
      orderPath: "",
      level: 1,
      rawLine: heading,
      include: false,
    };
  }

  if (/复习|练习|小结|总结/.test(heading)) {
    return {
      kind: "boundary",
      label: heading,
      title: heading,
      pageStart,
      orderPath: currentThemeOrder,
      level: 3,
      rawLine: heading,
      themeOrder: currentThemeOrder,
      include: false,
    };
  }

  const lesson = /^(\d+(?:\.\d+)*)\s+(.+)$/.exec(heading);
  if (lesson && lesson[1]!.includes(".")) {
    const orderPath = lesson[1]!;
    const themeOrder = orderPath.split(".")[0] ?? currentThemeOrder;
    return {
      kind: "lesson",
      label: orderPath,
      title: lesson[2]!.trim(),
      pageStart,
      orderPath,
      level: 3,
      rawLine: `${orderPath} ${lesson[2]!.trim()}`,
      themeOrder,
      include: true,
    };
  }

  return null;
}

function makeOutlineItem(bookId: string, entry: TocEntry & { kind: "theme" | "lesson" }, entries: TocEntry[]): PdfOutlineItem {
  const id =
    entry.kind === "theme"
      ? `struct:${bookId}:theme:${entry.orderPath}`
      : `struct:${bookId}:lesson:${entry.orderPath.replace(/\./g, "-")}`;
  const item: PdfOutlineItem = {
    id,
    kind: entry.kind,
    label: entry.label,
    title: entry.title,
    page_start: entry.pageStart,
    page_end: pageEndFor(entry, entries),
    level: entry.level,
    order_path: entry.orderPath,
    raw_line: entry.rawLine,
  };
  if (entry.kind === "lesson") item.parent_id = `struct:${bookId}:theme:${entry.themeOrder ?? entry.orderPath.split(".")[0]}`;
  return item;
}

function pageEndFor(entry: TocEntry, entries: TocEntry[]): number | undefined {
  const index = entries.indexOf(entry);
  const later = entries.slice(index + 1);
  const next =
    entry.kind === "theme"
      ? later.find((candidate) => candidate.level === 1 || candidate.kind === "theme")
      : later.find((candidate) => candidate.level === 1 || candidate.themeOrder === entry.themeOrder);
  if (!next) return undefined;
  return Math.max(entry.pageStart, next.pageStart - 1);
}

function normalizeTocHeading(value: string): string {
  return value
    .replace(/[.·•…．。]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNumberToken(value: string): number | string {
  const normalized = value.replace(/\s+/g, "");
  if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10);
  return chineseNumber(normalized) ?? normalized;
}

function chineseNumber(value: string): number | null {
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === "十") return 10;
  const tenIndex = value.indexOf("十");
  if (tenIndex >= 0) {
    const left = value.slice(0, tenIndex);
    const right = value.slice(tenIndex + 1);
    const tens = left ? digits[left] : 1;
    const ones = right ? digits[right] : 0;
    return tens === undefined || ones === undefined ? null : tens * 10 + ones;
  }
  return digits[value] ?? null;
}

function writeJson(path: string, payload: RawRecord): void {
  mkdirSync(dirnameFor(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function dirnameFor(path: string): string {
  const normalized = resolve(path);
  return normalized.slice(0, normalized.lastIndexOf(sep)) || ".";
}

function resolveInputPath(path: string, repoRoot: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function toDisplayPath(path: string, repoRoot: string): string {
  const resolved = resolve(path);
  const relativePath = relative(repoRoot, resolved);
  return relativePath.startsWith("..") || isAbsolute(relativePath) ? resolved : relativePath.split(sep).join("/");
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}
