import { readFileSync, existsSync } from 'node:fs';
import { DEFAULT_FRAMEWORK_PATH } from '../utils/paths.js';

let cached: Record<string, unknown> | null = null;

export function loadFramework(): Record<string, unknown> | null {
  if (cached !== null) return cached;
  if (!existsSync(DEFAULT_FRAMEWORK_PATH)) {
    cached = { domains: [] };
    return cached;
  }
  const raw = readFileSync(DEFAULT_FRAMEWORK_PATH, 'utf-8');
  cached = JSON.parse(raw);
  return cached;
}
