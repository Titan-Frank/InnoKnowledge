type JsonRecord = Record<string, unknown>;

export function parseModelJsonObject(text: string): JsonRecord {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  const enqueue = (value: string): void => {
    const candidate = value.trim();
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
  };

  enqueue(text);
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced) enqueue(fenced[1] ?? "");
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) enqueue(trimmed.slice(firstBrace, lastBrace + 1));

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (/^\{\s*\{/.test(candidate)) {
      enqueue(candidate.slice(1));
      if (/\}\s*\}$/.test(candidate)) {
        enqueue(candidate.slice(1, candidate.lastIndexOf("}")));
      }
    }
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRecord(parsed)) return parsed;
      if (typeof parsed === "string") {
        enqueue(parsed);
        continue;
      }
      errors.push("JSON value is not an object.");
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  throw new Error(`Model output must be a JSON object: ${[...new Set(errors)].join("; ")}`);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
