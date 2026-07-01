import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadDotenvIntoProcess } from './env.js';

export const __dirname = dirname(fileURLToPath(import.meta.url));
// From src/utils/ or dist/utils/, go up 4 levels to reach repo root
export const REPO_ROOT = resolve(__dirname, '../../../..');

loadDotenvIntoProcess(REPO_ROOT);

export const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://okm:okm@localhost:5432/knowledge';

// Allow env-var overrides for containerized deployment
export const DATA_DIR = process.env.OKM_DATA_DIR || resolve(REPO_ROOT, 'data');
export const VIEWER_DIST_DIR = process.env.OKM_VIEWER_DIST || resolve(REPO_ROOT, 'packages/viewer/dist');

export const DEFAULT_FRAMEWORK_PATH = resolve(
  DATA_DIR,
  'frameworks/junior-chemistry-framework.json',
);
export const DEFAULT_PATTERNS_PATH = resolve(
  DATA_DIR,
  'patterns/unified-knowledge-patterns.v2.json',
);
export const OUTLINES_DIR = resolve(DATA_DIR, 'outlines');
