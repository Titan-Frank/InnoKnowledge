#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const experimentDir = resolve(scriptDir, "..");
const fixturesDir = resolve(experimentDir, "fixtures");
const outputDir = resolve(experimentDir, "outputs");
const runtimeDir = resolve(outputDir, "runtime");
const scoreHeader =
  "reviewer_id,case_id,method_code,accuracy,evidence_traceability,stage_alignment,prerequisite_coverage,misconception_diagnosis,diagnostic_question_quality,teacher_editability,preferred,notes";

main();

function main() {
  mkdirSync(outputDir, { recursive: true });

  const cases = readJsonl(resolve(fixturesDir, "runtime-cases.v0.2.jsonl"));
  const runtimeOutputs = readRuntimeOutputs();
  if (runtimeOutputs.length === 0) {
    writeFileSync(resolve(outputDir, "expert-scores.csv"), `${scoreHeader}\n`);
    writeJson(resolve(outputDir, "expert-review-status.json"), {
      status: "pending_runtime_outputs",
      message: "Add runtime result files to outputs/runtime/*.json, then rerun this script.",
      expected_runtime_schema: "schemas/runtime-output.schema.json",
      score_sheet: "outputs/expert-scores.csv",
    });
    console.log(JSON.stringify({ status: "pending_runtime_outputs", runtime_outputs: 0 }, null, 2));
    return;
  }

  const methods = runtimeOutputs.map((output) => output.method);
  const methodCodes = buildMethodCodes(methods);
  const caseById = new Map(cases.map((item) => [item.id, item]));
  const rows = [];

  for (const output of runtimeOutputs) {
    const methodCode = methodCodes[output.method];
    for (const result of output.results ?? []) {
      const item = caseById.get(result.case_id);
      if (!item) {
        continue;
      }
      rows.push({
        review_item_id: stableId(`${result.case_id}:${methodCode}`),
        case_id: result.case_id,
        method_code: methodCode,
        task_type: item.task_type,
        book_id: item.book_id,
        question: item.question,
        answer: result.answer ?? "",
        citations: result.citations ?? [],
        unsupported_claims: result.unsupported_claims ?? [],
      });
    }
  }

  const shuffledRows = deterministicShuffle(rows, "okm-eduku-expert-review-v0.2");
  const scoreRows = shuffledRows.map((row) =>
    [
      "",
      row.case_id,
      row.method_code,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ].join(","),
  );

  writeJsonl(resolve(outputDir, "expert-review-sheet.jsonl"), shuffledRows);
  writeJson(resolve(outputDir, "expert-review-key.json"), {
    status: "generated",
    generated_at: new Date().toISOString(),
    method_codes: Object.fromEntries(Object.entries(methodCodes).map(([method, code]) => [code, method])),
  });
  writeFileSync(resolve(outputDir, "expert-scores.csv"), `${scoreHeader}\n${scoreRows.join("\n")}\n`);
  writeJson(resolve(outputDir, "expert-review-status.json"), {
    status: "ok",
    review_items: shuffledRows.length,
    methods: runtimeOutputs.length,
    score_sheet: "outputs/expert-scores.csv",
    blinded_sheet: "outputs/expert-review-sheet.jsonl",
    key_file: "outputs/expert-review-key.json",
  });

  console.log(JSON.stringify({ status: "ok", review_items: shuffledRows.length }, null, 2));
}

function readRuntimeOutputs() {
  if (!existsSync(runtimeDir)) {
    return [];
  }
  return readdirSync(runtimeDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const path = resolve(runtimeDir, file);
      const output = readJson(path);
      if (!output.method) {
        output.method = basename(file, ".json");
      }
      return output;
    })
    .filter((output) => Array.isArray(output.results));
}

function buildMethodCodes(methods) {
  const sorted = [...new Set(methods)].sort();
  const entries = sorted.map((method, index) => [method, `M${String(index + 1).padStart(2, "0")}`]);
  return Object.fromEntries(entries);
}

function deterministicShuffle(rows, seed) {
  return rows
    .map((row) => ({
      row,
      key: stableId(`${seed}:${row.review_item_id}`),
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((item) => item.row);
}

function stableId(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error.message}`);
      }
    });
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function writeJsonl(path, rows) {
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}
