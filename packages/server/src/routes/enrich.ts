import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Hono } from 'hono';
import { DATA_DIR } from '../utils/paths.js';

type EnrichBookSummary = {
  path: string;
  filename: string;
  subject?: string;
  stage?: string;
  grade?: string;
  course?: string;
  publisher?: string;
  volume?: string;
  root_count?: number;
  node_count?: number;
  max_depth?: number;
};

type EnrichIndex = {
  generated_at?: string;
  book_count?: number;
  subject_count?: number;
  node_count?: number;
  books?: EnrichBookSummary[];
};

type RawEnrichNode = {
  title?: string;
  enrichment?: {
    definition?: string;
    content?: string;
    academic_requirements?: string;
    academic_quality?: string;
    [key: string]: unknown;
  };
  child_nodes?: RawEnrichNode[];
  [key: string]: unknown;
};

type EnrichNode = RawEnrichNode & {
  id: string;
  depth: number;
  order_path: string;
  title_path: string[];
  child_count: number;
  child_nodes: EnrichNode[];
};

const ENRICH_DIR = resolve(DATA_DIR, 'enrich');
const ENRICH_INDEX_PATH = resolve(ENRICH_DIR, 'enrich_books_index.json');

let indexCache: EnrichIndex | null = null;

async function loadIndex(): Promise<EnrichIndex> {
  if (indexCache) return indexCache;
  const raw = await readFile(ENRICH_INDEX_PATH, 'utf8');
  const parsed = JSON.parse(raw) as EnrichIndex;
  indexCache = {
    ...parsed,
    books: Array.isArray(parsed.books) ? parsed.books : [],
  };
  return indexCache;
}

function normalizeNode(
  node: RawEnrichNode,
  orderPath: number[],
  titlePath: string[],
): EnrichNode {
  const children = Array.isArray(node.child_nodes) ? node.child_nodes : [];
  const title = String(node.title || '');
  return {
    ...node,
    id: orderPath.join('.'),
    depth: orderPath.length - 1,
    order_path: orderPath.join('.'),
    title_path: titlePath,
    child_count: children.length,
    child_nodes: children.map((child, index) => (
      normalizeNode(child, orderPath.concat(index + 1), titlePath.concat(title).filter(Boolean))
    )),
  };
}

function bookTitle(book: EnrichBookSummary): string {
  return [book.stage, book.grade, book.course, book.publisher, book.volume]
    .filter(Boolean)
    .join(' · ') || book.filename;
}

export function registerEnrichRoutes(app: Hono) {
  app.get('/api/enrich/books', async (c) => {
    try {
      const index = await loadIndex();
      const books = (index.books || []).map((book) => ({
        ...book,
        title: bookTitle(book),
      }));
      return c.json({
        generated_at: index.generated_at,
        book_count: index.book_count ?? books.length,
        subject_count: index.subject_count ?? new Set(books.map((book) => book.subject).filter(Boolean)).size,
        node_count: index.node_count ?? books.reduce((sum, book) => sum + Number(book.node_count || 0), 0),
        books,
      });
    } catch (error) {
      return c.json({ error: (error as Error).message || 'Failed to load enrich index' }, 500);
    }
  });

  app.get('/api/enrich/book', async (c) => {
    try {
      const requestedPath = c.req.query('path');
      if (!requestedPath) return c.json({ error: 'Missing path' }, 400);

      const index = await loadIndex();
      const book = (index.books || []).find((item) => item.path === requestedPath);
      if (!book) return c.json({ error: 'Unknown enrich book path' }, 404);

      const resolved = resolve(DATA_DIR, requestedPath.replace(/^data\//, ''));
      if (!resolved.startsWith(`${ENRICH_DIR}/`)) {
        return c.json({ error: 'Invalid enrich book path' }, 400);
      }

      const raw = await readFile(resolved, 'utf8');
      const parsed = JSON.parse(raw);
      const roots = Array.isArray(parsed) ? parsed as RawEnrichNode[] : [];
      const tree = roots.map((node, index) => normalizeNode(node, [index + 1], []));

      return c.json({
        book: { ...book, title: bookTitle(book) },
        tree,
      });
    } catch (error) {
      return c.json({ error: (error as Error).message || 'Failed to load enrich book' }, 500);
    }
  });
}
