const MAX_ERROR_MESSAGE_LENGTH = 500;
const MAX_OUTPUT_PREVIEW_LENGTH = 50_000;

export function buildJsonRetryUserPayload(
  originalUserPayload: string,
  previousError: Error | null,
): string {
  if (!previousError) return originalUserPayload;
  const sourceError = previousError.cause instanceof Error ? previousError.cause : previousError;
  const errorMessage = sourceError.message.trim().slice(0, MAX_ERROR_MESSAGE_LENGTH);
  return [
    originalUserPayload,
    "",
    "The previous response could not be accepted.",
    `Validation error: ${errorMessage || "invalid JSON output"}`,
    "Retry the task and return exactly one valid JSON object that conforms to the supplied schema.",
    "Use double-quoted property names and strings. Do not use Python/JavaScript object syntax, Markdown fences, comments, or explanatory text.",
  ].join("\n");
}

export function addModelOutputPreview(error: unknown, output: string): Error {
  const sourceError = error instanceof Error ? error : new Error(String(error));
  const trimmedOutput = output.trim();
  const preview = trimmedOutput.slice(0, MAX_OUTPUT_PREVIEW_LENGTH);
  const truncated = trimmedOutput.length > preview.length;
  return new Error([
    sourceError.message,
    `Raw model output${truncated ? " (truncated)" : ""}: ${JSON.stringify(preview)}`,
  ].join("\n"), { cause: sourceError });
}

export function isModelOutputValidationError(error: Error): boolean {
  return error.cause instanceof Error && error.message.includes("Raw model output");
}
