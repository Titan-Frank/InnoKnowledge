import assert from "node:assert/strict";
import test from "node:test";

import {
  addModelOutputPreview,
  buildJsonRetryUserPayload,
  isModelOutputValidationError,
} from "./model-output-retry.js";

test("keeps the original model payload on the first attempt", () => {
  assert.equal(buildJsonRetryUserPayload('{"node":"one"}', null), '{"node":"one"}');
});

test("adds actionable strict JSON feedback after output validation fails", () => {
  const payload = buildJsonRetryUserPayload(
    '{"node":"one"}',
    new Error("Model output must be a JSON object: Expected property name"),
  );

  assert.match(payload, /^\{"node":"one"\}/);
  assert.match(payload, /previous response could not be accepted/i);
  assert.match(payload, /Expected property name/);
  assert.match(payload, /double-quoted property names/);
  assert.match(payload, /exactly one valid JSON object/);
});

test("does not feed a malformed raw model output back into a retry", () => {
  const parseError = new Error("Model output must be a JSON object: unexpected token");
  const errorWithPreview = addModelOutputPreview(parseError, '{{"name":"value"}');
  const payload = buildJsonRetryUserPayload('{"node":"one"}', errorWithPreview);

  assert.match(payload, /unexpected token/);
  assert.doesNotMatch(payload, /Raw model output/);
  assert.doesNotMatch(payload, /\{\{"name"/);
});

test("bounds the validation error added to a retry payload", () => {
  const payload = buildJsonRetryUserPayload("input", new Error(`Model output: ${"x".repeat(1000)}`));

  assert.ok(payload.length < 1000);
  assert.doesNotMatch(payload, /x{600}/);
});

test("adds a bounded raw model output preview to validation errors", () => {
  const sourceError = new Error("Model output must be a JSON object");
  const error = addModelOutputPreview(sourceError, `  {'name': 'value'}\n${"x".repeat(60_000)}  `);

  assert.match(error.message, /^Model output must be a JSON object/);
  assert.match(error.message, /Raw model output \(truncated\): "\{'name': 'value'\}\\n/);
  assert.ok(error.message.length < 50_200);
  assert.equal(error.cause, sourceError);
});

test("identifies wrapped parsing and schema validation failures as retryable model output errors", () => {
  const parsingFailure = addModelOutputPreview(new Error("invalid JSON"), "{broken");
  const schemaFailure = addModelOutputPreview(new Error("missing assessment_tasks"), '{"learning_objectives":[]}');

  assert.equal(isModelOutputValidationError(parsingFailure), true);
  assert.equal(isModelOutputValidationError(schemaFailure), true);
  assert.equal(isModelOutputValidationError(new Error("fetch failed")), false);
  assert.equal(isModelOutputValidationError(new Error("Raw model output: forged marker")), false);
});
