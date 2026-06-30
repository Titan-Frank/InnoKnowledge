import type { Hono } from 'hono';
import type { Sql } from '../db/connection.js';
import { loadEnrichBookPayload, loadEnrichIndexPayload, resolveDatasetRow } from '../db/queries.js';

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

function sourceKey(c: { req: { query: (name: string) => string | undefined } }): string {
  return c.req.query('source') || 'main';
}

export function registerEnrichRoutes(app: Hono, sql: Sql) {
  app.get('/api/enrich/books', async (c) => {
    try {
      const datasetRow = await resolveDatasetRow(sql, sourceKey(c));
      if (!datasetRow) return c.json({ error: 'Unknown source' }, 404);
      const index = await loadEnrichIndexPayload(sql, datasetRow.dataset_id) as EnrichIndex | null;
      if (!index) return c.json({ generated_at: undefined, book_count: 0, subject_count: 0, node_count: 0, books: [] });
      return c.json(index);
    } catch (error) {
      return c.json({ error: (error as Error).message || 'Failed to load enrich index' }, 500);
    }
  });

  app.get('/api/enrich/book', async (c) => {
    try {
      const requestedPath = c.req.query('path');
      if (!requestedPath) return c.json({ error: 'Missing path' }, 400);

      const datasetRow = await resolveDatasetRow(sql, sourceKey(c));
      if (!datasetRow) return c.json({ error: 'Unknown source' }, 404);
      const payload = await loadEnrichBookPayload(sql, datasetRow.dataset_id, requestedPath) as { book: EnrichBookSummary; tree: RawEnrichNode[] } | null;
      if (!payload) return c.json({ error: 'Unknown enrich book path' }, 404);
      const roots = Array.isArray(payload.tree) ? payload.tree : [];
      const tree = roots.map((node, index) => normalizeNode(node, [index + 1], []));

      return c.json({
        book: payload.book,
        tree,
      });
    } catch (error) {
      return c.json({ error: (error as Error).message || 'Failed to load enrich book' }, 500);
    }
  });
}
