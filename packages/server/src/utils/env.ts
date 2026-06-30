import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(CURRENT_DIR, '../../../..');

export function loadDotenvIntoProcess(repoRoot = DEFAULT_REPO_ROOT): void {
  const envPath = resolve(repoRoot, '.env');
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;

    const [rawKey, ...rawValueParts] = line.split('=');
    const key = rawKey.trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = unquoteEnvValue(rawValueParts.join('=').trim());
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
