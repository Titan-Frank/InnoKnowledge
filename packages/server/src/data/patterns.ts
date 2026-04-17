import { readFileSync, existsSync } from 'node:fs';
import { DEFAULT_PATTERNS_PATH } from '../utils/paths.js';

let cached: Record<string, unknown> | null = null;

export function loadPatterns(): Record<string, unknown> | null {
  if (cached !== null) return cached;
  if (!existsSync(DEFAULT_PATTERNS_PATH)) {
    cached = { patterns: [] };
    return cached;
  }
  const raw = readFileSync(DEFAULT_PATTERNS_PATH, 'utf-8');
  cached = JSON.parse(raw);
  return cached;
}
