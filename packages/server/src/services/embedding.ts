/**
 * TypeScript embedding client for the Qwen3-Embedding-4B API.
 *
 * Uses an explicitly configured OpenAI-compatible embedding endpoint.
 * Returns `null` on any failure so the caller can fall back to text-only search.
 */

import { loadDotenvIntoProcess } from '../utils/env.js';

loadDotenvIntoProcess();

const EMBEDDING_URL = process.env.EMBEDDING_URL?.trim() ?? '';

const DEFAULT_EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? 'Qwen/Qwen3-Embedding-4B';

export const EMBEDDING_DIMENSION = 1024;

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Embed a single query string. Returns the vector or `null` on failure.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  const vectors = await embedTextBatch([text]);
  return vectors[0] ?? null;
}

export async function embedTextBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey || !EMBEDDING_URL) return texts.map(() => []);

  const body = JSON.stringify({
    model: DEFAULT_EMBEDDING_MODEL,
    input: texts,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const resp = await fetch(EMBEDDING_URL, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * (2 ** attempt));
          continue;
        }
        return texts.map(() => []);
      }

      return parseEmbeddingResponse(await resp.json(), texts.length);
    } catch {
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (2 ** attempt));
        continue;
      }
      return texts.map(() => []);
    }
  }

  return texts.map(() => []);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEmbeddingResponse(body: unknown, inputCount: number): number[][] {
  const data = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  const indexed = new Map<number, number[]>();
  for (const item of data) {
    if (!isRecord(item)) continue;
    const index = typeof item.index === 'number' && Number.isInteger(item.index) ? item.index : 0;
    const rawVector = Array.isArray(item.embedding) ? item.embedding : [];
    const vector = rawVector.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (vector.length > EMBEDDING_DIMENSION) indexed.set(index, vector.slice(0, EMBEDDING_DIMENSION));
    else if (vector.length === EMBEDDING_DIMENSION) indexed.set(index, vector);
  }
  return Array.from({ length: inputCount }, (_, index) => indexed.get(index) ?? []);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
