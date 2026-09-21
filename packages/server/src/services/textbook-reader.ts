import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  TextbookReaderBlock,
  TextbookReaderBookSummary,
  TextbookReaderEvidenceMatch,
  TextbookReaderInlineSegment,
  TextbookReaderPageResponse,
} from '@okm/types';

type RawRecord = Record<string, unknown>;

export type ReaderEvidence = {
  id: string;
  excerpt: string;
  locator: string;
  page_start: number | null;
  page_end: number | null;
  properties: RawRecord;
};

export type TextbookReaderSourceMapping = {
  book_id: string;
  source_markdown_path?: string | null;
  raw_markdown_path?: string | null;
  extract_dir?: string | null;
  source_pdf_path?: string | null;
};

export type LoadTextbookReaderInput = {
  repoRoot: string;
  dataRoot?: string;
  datasetId: string;
  bookId: string;
  sourcePaths?: string[];
  pdfPath?: string | null;
  requestedPage?: number;
  evidence?: ReaderEvidence | null;
};

type ParsedBook = {
  sourceFormat: 'content_list_v2' | 'content_list';
  pages: TextbookReaderBlock[][];
};

type ParsedBookCacheEntry = {
  mtimeMs: number;
  size: number;
  book: ParsedBook;
};

const parsedBookCache = new Map<string, ParsedBookCacheEntry>();

const IMAGE_PATH_PATTERN = /(?:^|[\s("'])([^\s)"']*images\/[^\s)"']+\.(?:png|jpe?g|webp|gif|bmp|svg))/i;

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (!isRecord(value)) return [];
  if (typeof value.content === 'string') return value.content.trim() ? [value.content.trim()] : [];
  return Object.values(value).flatMap(strings);
}

function inlineText(value: unknown): string {
  return strings(value).join('').replace(/\s+/g, ' ').trim();
}

function inlineSegments(value: unknown): TextbookReaderInlineSegment[] {
  if (typeof value === 'string') {
    return value ? [{ kind: 'text', value }] : [];
  }
  if (Array.isArray(value)) return value.flatMap(inlineSegments);
  if (!isRecord(value)) return [];
  const kind = String(value.type ?? '').toLowerCase() === 'equation_inline' ? 'math' : 'text';
  if (typeof value.content === 'string') {
    return value.content ? [{ kind, value: value.content }] : [];
  }
  if (Array.isArray(value.content)) return inlineSegments(value.content);
  return [];
}

function cleanHtmlText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

function bbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const values = value.map(Number);
  if (!values.every(Number.isFinite)) return null;
  return values.map((coordinate) => Math.max(0, Math.min(1000, coordinate))) as [number, number, number, number];
}

function relativeAssetPath(repoRoot: string, dataRoot: string, jsonPath: string, value: unknown): string | null {
  const asset = String(value ?? '').trim().replace(/\\/g, '/');
  if (!asset) return null;
  if (/^https?:/i.test(asset)) return asset;
  const resolved = path.isAbsolute(asset) ? path.resolve(asset) : path.resolve(path.dirname(jsonPath), asset);
  const relativeToData = path.relative(path.resolve(dataRoot), resolved);
  if (relativeToData && !relativeToData.startsWith('..') && !path.isAbsolute(relativeToData)) {
    return `data/${relativeToData.split(path.sep).join('/')}`;
  }
  const relative = path.relative(path.resolve(repoRoot), resolved);
  if (!relative) return null;
  if (relative.startsWith('..') || path.isAbsolute(relative)) return resolved;
  return relative.split(path.sep).join('/');
}

function normalizedBlock(
  raw: RawRecord,
  jsonPath: string,
  repoRoot: string,
  dataRoot: string,
  pageIndex: number,
  orderIndex: number,
): TextbookReaderBlock {
  const content = isRecord(raw.content) ? raw.content : raw;
  const type = String(raw.type ?? 'paragraph').trim() || 'paragraph';
  const caption = inlineText(
    content.image_caption
    ?? content.chart_caption
    ?? content.table_caption
    ?? raw.image_caption
    ?? raw.chart_caption
    ?? raw.table_caption,
  );
  const footnote = inlineText(
    content.image_footnote
    ?? content.chart_footnote
    ?? content.table_footnote
    ?? content.page_footnote_content
    ?? raw.image_footnote
    ?? raw.chart_footnote
    ?? raw.table_footnote,
  );
  const imageSource = isRecord(content.image_source) ? content.image_source.path : raw.img_path;
  const rawListItems = content.list_items ?? raw.list_items;
  const listItemSegments = Array.isArray(rawListItems)
    ? rawListItems.map((item: unknown) => {
      const record = isRecord(item) ? item : {};
      return inlineSegments(record.item_content ?? item);
    })
    : [];
  const listItems = listItemSegments.map((segments) => segments.map((segment) => segment.value).join('').trim());
  const math = String(content.math_content ?? raw.math_content ?? '').trim() || null;
  const html = String(content.html ?? raw.table_body ?? '').trim() || null;
  const segmentSource = content.title_content
    ?? content.paragraph_content
    ?? content.page_header_content
    ?? content.page_footer_content
    ?? content.page_number_content
    ?? content.page_footnote_content
    ?? (typeof content.content === 'string' || Array.isArray(content.content) ? content.content : undefined)
    ?? raw.text
    ?? (typeof raw.content === 'string' ? raw.content : undefined);
  const segments = inlineSegments(segmentSource);
  const textCandidates: unknown[] = [
    content.title_content,
    content.paragraph_content,
    content.page_header_content,
    content.page_footer_content,
    content.page_number_content,
    content.page_footnote_content,
    content.content,
    raw.text,
    typeof raw.content === 'string' ? raw.content : undefined,
  ];
  const text = textCandidates.map(inlineText).find(Boolean)
    || listItems.join('\n')
    || math
    || cleanHtmlText(html)
    || caption;
  const titleLevel = Number(content.level ?? raw.text_level);

  return {
    id: `ocr:${pageIndex}:${orderIndex}`,
    page_index: pageIndex,
    order_index: orderIndex,
    type,
    sub_type: String(raw.sub_type ?? '').trim() || null,
    bbox: bbox(raw.bbox),
    text,
    title_level: Number.isFinite(titleLevel) ? Math.max(1, Math.min(6, titleLevel)) : null,
    math,
    html,
    image_path: relativeAssetPath(repoRoot, dataRoot, jsonPath, imageSource),
    caption,
    footnote,
    list_items: listItems,
    segments,
    list_item_segments: listItemSegments,
  };
}

async function findReaderJson(root: string, depth = 0): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true });
  const v2 = entries.find((entry) => entry.isFile() && /_content_list_v2\.json$/i.test(entry.name));
  if (v2) return path.join(root, v2.name);
  const flat = entries.find((entry) => entry.isFile() && /_content_list(?!_v2)\.json$/i.test(entry.name));
  if (flat) return path.join(root, flat.name);
  if (depth >= 4) return null;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === 'images') continue;
    const found = await findReaderJson(path.join(root, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

async function findReaderPdf(root: string, bookId: string, depth = 0): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const exact = entries.find((entry) => entry.isFile() && entry.name === `${bookId}.pdf`);
  if (exact) return path.join(root, exact.name);
  const pdf = entries.find((entry) => entry.isFile() && /\.pdf$/i.test(entry.name));
  if (pdf) return path.join(root, pdf.name);
  if (depth >= 2) return null;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === 'images') continue;
    const found = await findReaderPdf(path.join(root, entry.name), bookId, depth + 1);
    if (found) return found;
  }
  return null;
}

export async function resolveTextbookReaderPdf(input: LoadTextbookReaderInput): Promise<string | null> {
  const dataRoot = path.resolve(input.dataRoot ?? path.resolve(input.repoRoot, 'data'));
  const mineruRoot = path.resolve(dataRoot, 'mineru');
  const bookRoot = path.resolve(mineruRoot, input.bookId);
  const candidates = [input.pdfPath ?? '', bookRoot, ...(input.sourcePaths ?? [])];
  for (const candidate of candidates) {
    if (!candidate || /^https?:/i.test(candidate)) continue;
    const resolved = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : candidate.replace(/\\/g, '/').startsWith('data/')
        ? path.resolve(dataRoot, candidate.replace(/\\/g, '/').slice('data/'.length))
        : path.resolve(input.repoRoot, candidate);
    const info = await stat(resolved).catch(() => null);
    if (info?.isFile() && /\.pdf$/i.test(resolved)) return resolved;
    let directory = info?.isDirectory() ? resolved : info?.isFile() ? path.dirname(resolved) : null;
    for (let level = 0; directory && level <= 2; level += 1) {
      const found = await findReaderPdf(directory, input.bookId, 0);
      if (found) return found;
      const parent = path.dirname(directory);
      directory = parent === directory ? null : parent;
    }
  }
  return null;
}

async function sourceDirectory(input: LoadTextbookReaderInput): Promise<string> {
  const dataRoot = path.resolve(input.dataRoot ?? path.resolve(input.repoRoot, 'data'));
  const candidates = [
    ...(input.sourcePaths ?? []),
    path.join(dataRoot, 'mineru', input.bookId),
  ];
  for (const candidate of candidates) {
    if (!candidate || /^https?:/i.test(candidate)) continue;
    const resolved = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : candidate.replace(/\\/g, '/').startsWith('data/')
        ? path.resolve(dataRoot, candidate.replace(/\\/g, '/').slice('data/'.length))
        : path.resolve(input.repoRoot, candidate);
    const info = await stat(resolved).catch(() => null);
    const directory = info?.isDirectory() ? resolved : info?.isFile() ? path.dirname(resolved) : null;
    if (directory && await findReaderJson(directory)) return directory;
  }
  throw new Error(`OCR content-list JSON was not found for textbook '${input.bookId}'.`);
}

function mineruCatalogRootName(dataRoot: string, value: string | null | undefined): string | null {
  const sourcePath = String(value ?? '').trim();
  if (!sourcePath || /^https?:/i.test(sourcePath)) return null;
  const mineruRoot = path.resolve(dataRoot, 'mineru');
  const resolved = path.isAbsolute(sourcePath)
    ? path.resolve(sourcePath)
    : sourcePath.replace(/\\/g, '/').startsWith('data/')
      ? path.resolve(dataRoot, sourcePath.replace(/\\/g, '/').slice('data/'.length))
      : path.resolve(path.dirname(dataRoot), sourcePath);
  const relative = path.relative(mineruRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep)[0] || null;
}

export async function listTextbookReaderBooks(
  dataRoot: string,
  sourceMappings: TextbookReaderSourceMapping[] = [],
): Promise<TextbookReaderBookSummary[]> {
  const mineruRoot = path.resolve(dataRoot, 'mineru');
  const roots = await readdir(mineruRoot, { withFileTypes: true }).catch(() => []);
  const books: TextbookReaderBookSummary[] = [];
  for (const entry of roots) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const jsonPath = await findReaderJson(path.join(mineruRoot, entry.name)).catch(() => null);
    if (!jsonPath) continue;
    try {
      const parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as unknown;
      const sourceFormat = /_v2\.json$/i.test(jsonPath) ? 'content_list_v2' : 'content_list';
      const pageCount = sourceFormat === 'content_list_v2'
        ? Array.isArray(parsed) ? parsed.length : 0
        : Array.isArray(parsed)
          ? parsed.filter(isRecord).reduce((max, row) => Math.max(max, (Number(row.page_idx) || 0) + 1), 0)
          : 0;
      if (pageCount > 0) {
        books.push({
          book_id: entry.name,
          title: entry.name,
          page_count: pageCount,
          source_format: sourceFormat,
          pdf_available: Boolean(await findReaderPdf(path.join(mineruRoot, entry.name), entry.name)),
        });
      }
    } catch {
      // Invalid bundles stay out of the reader catalog; the pipeline inspection surface reports details.
    }
  }
  const catalogNames = new Set(books.map((book) => book.book_id));
  const canonicalByRoot = new Map<string, string>();
  const legacyRoots = new Set<string>();
  for (const source of sourceMappings) {
    const roots = [source.raw_markdown_path, source.extract_dir, source.source_markdown_path]
      .map((value) => mineruCatalogRootName(dataRoot, value))
      .filter((value): value is string => typeof value === 'string' && catalogNames.has(value));
    const preferredRoot = roots[0];
    if (!preferredRoot || !source.book_id) continue;
    canonicalByRoot.set(preferredRoot, source.book_id);
    for (const root of roots.slice(1)) {
      if (root !== preferredRoot) legacyRoots.add(root);
    }
  }
  const catalogBooks = books
    .filter((book) => !legacyRoots.has(book.book_id) || canonicalByRoot.has(book.book_id))
    .map((book) => ({ ...book, book_id: canonicalByRoot.get(book.book_id) ?? book.book_id }));
  const catalogIds = new Set(catalogBooks.map((book) => book.book_id));
  for (const source of sourceMappings) {
    if (!source.book_id || catalogIds.has(source.book_id)) continue;
    const candidates = [source.extract_dir, source.raw_markdown_path, source.source_markdown_path]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
    let jsonPath: string | null = null;
    for (const candidate of candidates) {
      const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(path.dirname(dataRoot), candidate);
      const info = await stat(resolved).catch(() => null);
      const directory = info?.isDirectory() ? resolved : info?.isFile() ? path.dirname(resolved) : null;
      if (!directory) continue;
      jsonPath = await findReaderJson(directory).catch(() => null);
      if (jsonPath) break;
    }
    if (!jsonPath) continue;
    try {
      const parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as unknown;
      const sourceFormat = /_v2\.json$/i.test(jsonPath) ? 'content_list_v2' as const : 'content_list' as const;
      const pageCount = sourceFormat === 'content_list_v2'
        ? Array.isArray(parsed) ? parsed.length : 0
        : Array.isArray(parsed)
          ? parsed.filter(isRecord).reduce((max, row) => Math.max(max, (Number(row.page_idx) || 0) + 1), 0)
          : 0;
      if (pageCount <= 0) continue;
      catalogBooks.push({
        book_id: source.book_id,
        title: path.basename(jsonPath).replace(/_content_list(?:_v2)?\.json$/i, '') || source.book_id,
        page_count: pageCount,
        source_format: sourceFormat,
        pdf_available: Boolean(await resolveTextbookReaderPdf({
          repoRoot: path.dirname(dataRoot),
          dataRoot,
          datasetId: '',
          bookId: source.book_id,
          sourcePaths: candidates,
          pdfPath: source.source_pdf_path,
        })),
      });
      catalogIds.add(source.book_id);
    } catch {
      // Invalid external bundles are reported by the pipeline inspection surface.
    }
  }
  return catalogBooks.sort((left, right) => left.title.localeCompare(right.title, 'zh-CN', { numeric: true }));
}

async function parseBook(input: LoadTextbookReaderInput): Promise<ParsedBook> {
  const directory = await sourceDirectory(input);
  const dataRoot = path.resolve(input.dataRoot ?? path.resolve(input.repoRoot, 'data'));
  const jsonPath = await findReaderJson(directory);
  if (!jsonPath) throw new Error(`OCR content-list JSON was not found for textbook '${input.bookId}'.`);
  const jsonStat = await stat(jsonPath);
  const cached = parsedBookCache.get(jsonPath);
  if (cached?.mtimeMs === jsonStat.mtimeMs && cached.size === jsonStat.size) return cached.book;
  const parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as unknown;
  const sourceFormat = /_v2\.json$/i.test(jsonPath) ? 'content_list_v2' : 'content_list';

  if (sourceFormat === 'content_list_v2') {
    if (!Array.isArray(parsed) || !parsed.every(Array.isArray)) throw new Error('Invalid content_list_v2 JSON.');
    const book: ParsedBook = {
      sourceFormat,
      pages: parsed.map((page, pageIndex) => page
        .filter(isRecord)
        .map((raw, orderIndex) => normalizedBlock(raw, jsonPath, input.repoRoot, dataRoot, pageIndex, orderIndex))),
    };
    parsedBookCache.set(jsonPath, { mtimeMs: jsonStat.mtimeMs, size: jsonStat.size, book });
    return book;
  }

  if (!Array.isArray(parsed)) throw new Error('Invalid content_list JSON.');
  const records = parsed.filter(isRecord);
  const maxPage = records.reduce((max, raw) => Math.max(max, Number(raw.page_idx) || 0), 0);
  const pages = Array.from({ length: maxPage + 1 }, () => [] as TextbookReaderBlock[]);
  records.forEach((raw) => {
    const pageIndex = Math.max(0, Math.trunc(Number(raw.page_idx) || 0));
    pages[pageIndex]?.push(normalizedBlock(raw, jsonPath, input.repoRoot, dataRoot, pageIndex, pages[pageIndex].length));
  });
  const book: ParsedBook = { sourceFormat, pages };
  parsedBookCache.set(jsonPath, { mtimeMs: jsonStat.mtimeMs, size: jsonStat.size, book });
  return book;
}

function normalizedSearchText(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .toLocaleLowerCase();
}

function evidenceAssetName(evidence: ReaderEvidence): string {
  const candidates = [
    evidence.properties.path,
    evidence.properties.image_path,
    evidence.properties.src,
    evidence.locator,
    evidence.excerpt,
  ];
  for (const candidate of candidates) {
    const match = IMAGE_PATH_PATTERN.exec(String(candidate ?? ''));
    if (match?.[1]) return path.posix.basename(match[1].replace(/\\/g, '/')).toLocaleLowerCase();
  }
  return '';
}

function matchEvidence(pages: TextbookReaderBlock[][], evidence: ReaderEvidence): TextbookReaderEvidenceMatch {
  const assetName = evidenceAssetName(evidence);
  if (assetName) {
    for (const [pageIndex, blocks] of pages.entries()) {
      const matches = blocks.filter((block) => block.image_path && path.posix.basename(block.image_path).toLocaleLowerCase() === assetName);
      if (matches.length) {
        return { evidence_id: evidence.id, page_index: pageIndex, block_ids: matches.map((block) => block.id), kind: 'asset', confidence: 1, excerpt: evidence.excerpt };
      }
    }
  }

  const query = normalizedSearchText(evidence.excerpt);
  if (query.length >= 6) {
    let best: { pageIndex: number; block: TextbookReaderBlock; score: number } | null = null;
    for (const [pageIndex, blocks] of pages.entries()) {
      for (const block of blocks) {
        const candidate = normalizedSearchText([block.text, block.caption, block.footnote].filter(Boolean).join(' '));
        if (candidate.length < 4) continue;
        const contains = candidate.includes(query) || query.includes(candidate);
        const prefixLength = Math.min(64, query.length);
        const prefixMatch = prefixLength >= 12 && candidate.includes(query.slice(0, prefixLength));
        if (!contains && !prefixMatch) continue;
        const score = contains ? Math.min(0.99, Math.min(query.length, candidate.length) / Math.max(query.length, candidate.length) + 0.5) : 0.72;
        if (!best || score > best.score) best = { pageIndex, block, score };
      }
    }
    if (best) {
      return { evidence_id: evidence.id, page_index: best.pageIndex, block_ids: [best.block.id], kind: 'text', confidence: Number(best.score.toFixed(2)), excerpt: evidence.excerpt };
    }
  }

  const page = evidence.page_start == null ? null : Math.max(0, Math.trunc(evidence.page_start) - 1);
  if (page != null && pages[page]) {
    return { evidence_id: evidence.id, page_index: page, block_ids: [], kind: 'page', confidence: 0.35, excerpt: evidence.excerpt };
  }
  return { evidence_id: evidence.id, page_index: null, block_ids: [], kind: 'none', confidence: 0, excerpt: evidence.excerpt };
}

export function matchReaderEvidenceBlocks(
  blocks: TextbookReaderBlock[],
  evidence: ReaderEvidence,
): string[] {
  return matchEvidence([blocks], { ...evidence, page_start: null, page_end: null }).block_ids;
}

export async function loadTextbookReaderPage(input: LoadTextbookReaderInput): Promise<TextbookReaderPageResponse> {
  const book = await parseBook(input);
  const pdfAvailable = Boolean(await resolveTextbookReaderPdf(input));
  if (book.pages.length === 0) throw new Error(`OCR content-list JSON has no pages for textbook '${input.bookId}'.`);
  const evidenceMatch = input.evidence ? matchEvidence(book.pages, input.evidence) : null;
  const pageIndex = Math.max(0, Math.min(
    book.pages.length - 1,
    input.requestedPage ?? evidenceMatch?.page_index ?? 0,
  ));
  const blocks = book.pages[pageIndex] ?? [];
  return {
    dataset_id: input.datasetId,
    book_id: input.bookId,
    page_count: book.pages.length,
    page_index: pageIndex,
    page_number: pageIndex + 1,
    block_count: blocks.length,
    image_count: blocks.filter((block) => Boolean(block.image_path)).length,
    coordinate_space: 1000,
    source_format: book.sourceFormat,
    pdf_available: pdfAvailable,
    blocks,
    evidence_match: evidenceMatch,
    related_units: [],
  };
}
