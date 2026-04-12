import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const __dirname = dirname(fileURLToPath(import.meta.url));
// From src/utils/ or dist/utils/, go up 4 levels to reach repo root
export const REPO_ROOT = resolve(__dirname, '../../../..');

export const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://okm:okm@localhost:5432/knowledge';
export const DEFAULT_FRAMEWORK_PATH = resolve(
  REPO_ROOT,
  'data/frameworks/junior-chemistry-framework.json',
);
export const DEFAULT_PATTERNS_PATH = resolve(
  REPO_ROOT,
  'data/patterns/unified-knowledge-patterns.v2.json',
);
export const OUTLINES_DIR = resolve(REPO_ROOT, 'data/outlines');
export const VIEWER_DIST_DIR = resolve(REPO_ROOT, 'packages/viewer/dist');
