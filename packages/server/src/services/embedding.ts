/**
 * TypeScript embedding client for the Qwen3-Embedding-4B API.
 *
 * Mirrors the Python `scripts/embedding_client.py` defaults but uses
 * Node.js built-in `fetch`. Returns `null` on any failure so the
 * caller can fall back to text-only search.
 */

const DEFAULT_EMBEDDING_URL =
  process.env.EMBEDDING_URL ??
  'https://heckb8bcaq88cko9mooamhkbceqq9ecc.openapi-sj.sii.edu.cn/v1/embeddings';

const DEFAULT_EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? 'Qwen/Qwen3-Embedding-4B';

const EMBEDDING_DIMENSION = 2560;

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Embed a single query string. Returns the vector or `null` on failure.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) return null;

  const body = JSON.stringify({
    model: DEFAULT_EMBEDDING_MODEL,
    input: [text],
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const resp = await fetch(DEFAULT_EMBEDDING_URL, {
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
        return null;
      }

      const json = (await resp.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };

      const vec = json.data?.[0]?.embedding;
      if (!vec || !Array.isArray(vec) || vec.length === 0) return null;

      // Truncate if API returns more dimensions than expected (MRL-compatible)
      if (vec.length > EMBEDDING_DIMENSION) return vec.slice(0, EMBEDDING_DIMENSION);
      if (vec.length < EMBEDDING_DIMENSION) return null; // unexpected

      return vec;
    } catch {
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (2 ** attempt));
        continue;
      }
      return null;
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
