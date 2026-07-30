import assert from "node:assert/strict";
import test from "node:test";

import { parseModelJsonObject } from "./model-json.js";

test("parses plain, fenced, and provider-prefixed JSON objects", () => {
  assert.deepEqual(parseModelJsonObject('{"value":1}'), { value: 1 });
  assert.deepEqual(parseModelJsonObject('```json\n{"value":1}\n```'), { value: 1 });
  assert.deepEqual(parseModelJsonObject('result:\n{"value":1}\nfinished'), { value: 1 });
});

test("repairs redundant opening braces separated by whitespace", () => {
  assert.deepEqual(parseModelJsonObject('{{"value":1}'), { value: 1 });
  assert.deepEqual(parseModelJsonObject('{\n  {"value":1}'), { value: 1 });
  assert.deepEqual(parseModelJsonObject('{\r\n\t{"value":1}\r\n}'), { value: 1 });
});

test("unwraps a JSON object returned as a JSON string", () => {
  assert.deepEqual(parseModelJsonObject(JSON.stringify('{"value":1}')), { value: 1 });
});

test("still rejects arrays and irreparable output", () => {
  assert.throws(() => parseModelJsonObject("[1,2]"), /not an object/);
  assert.throws(() => parseModelJsonObject("{broken"), /Model output must be a JSON object/);
});
