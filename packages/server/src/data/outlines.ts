import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUTLINES_DIR } from '../utils/paths.js';

const cache = new Map<string, Record<string, unknown> | null>();

export function loadOutline(bookId: string): Record<string, unknown> | null {
  const cached = cache.get(bookId);
  if (cached !== undefined) return cached;

  const path = resolve(OUTLINES_DIR, `${bookId}.outline.json`);
  if (!existsSync(path)) {
    cache.set(bookId, null);
    return null;
  }

  const raw = readFileSync(path, 'utf-8');
  const data = JSON.parse(raw) as Record<string, unknown>;
  cache.set(bookId, data);
  return data;
}
