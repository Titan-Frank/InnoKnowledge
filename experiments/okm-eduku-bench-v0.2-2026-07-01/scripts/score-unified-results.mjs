#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const experimentDir = resolve(scriptDir, "..");
const fixturesDir = resolve(experimentDir, "fixtures");
const outputDir = resolve(experimentDir, "outputs");
const constructionDir = resolve(outputDir, "construction");
const runtimeDir = resolve(outputDir, "runtime");
const expertScoresPath = resolve(outputDir, "expert-scores.csv");

const scoreFields = [
  "accuracy",
  "evidence_traceability",
  "stage_alignment",
  "prerequisite_coverage",
  "misconception_diagnosis",
  "diagnostic_question_quality",
  "teacher_editability",
];

main();

function main() {
  mkdirSync(outputDir, { recursive: true });
  const design = readJson(resolve(fixturesDir, "benchmark-design.json"));
  const runtimeCases = readJsonl(resolve(fixturesDir, "runtime-cases.v0.2.jsonl"));
  const constructionOutputs = readJsonOutputs(constructionDir);
  const runtimeOutputs = readJsonOutputs(runtimeDir);
  const expertRows = existsSync(expertScoresPath) ? readCsv(expertScoresPath) : [];

  const constructionSummary = summarizeConstruction(constructionOutputs);
  const runtimeSummary = summarizeRuntime(runtimeOutputs, runtimeCases);
  const expertSummary = summarizeExpertScores(expertRows);

  const status = {
    benchmark_id: design.benchmark_id,
    generated_at: new Date().toISOString(),
    status:
      constructionOutputs.length || runtimeOutputs.length || expertRows.length
        ? "scored_available_inputs"
        : "pending_inputs",
    inputs: {
      construction_files: constructionOutputs.map((item) => item.__file),
      runtime_files: runtimeOutputs.map((item) => item.__file),
      expert_scores_present: expertRows.length > 0,
    },
    required_next_inputs: {
      construction: constructionOutputs.length
        ? []
        : ["outputs/construction/*.json using schemas/construction-output.schema.json"],
      runtime: runtimeOutputs.length ? [] : ["outputs/runtime/*.json using schemas/runtime-output.schema.json"],
      expert: expertRows.length ? [] : ["outputs/expert-scores.csv after blind review"],
    },
    construction_summary: constructionSummary,
    runtime_summary: runtimeSummary,
    expert_summary: expertSummary,
  };

  writeJson(resolve(outputDir, "scoring-status.json"), status);
  writeFileSync(resolve(outputDir, "experiment-report.md"), renderReport(status));

  console.log(
    JSON.stringify(
      {
        status: status.status,
        construction_files: constructionOutputs.length,
        runtime_files: runtimeOutputs.length,
        expert_rows: expertRows.length,
      },
      null,
      2,
    ),
  );
}

function summarizeConstruction(outputs) {
  if (outputs.length === 0) {
    return {
      status: "pending_inputs",
      note: "No construction outputs were found.",
    };
  }

  return outputs.map((output) => {
    const nodes = output.nodes ?? [];
    const edges = output.edges ?? [];
    const evidenceLinks = output.evidence_links ?? [];
    const semanticCore = output.semantic_core ?? [];
    const pedagogicalProfile = output.pedagogical_profile ?? [];
    const nodeNames = new Set();
    let duplicateNames = 0;
    for (const node of nodes) {
      const key = normalize(node.name);
      if (!key) {
        continue;
      }
      if (nodeNames.has(key)) {
        duplicateNames += 1;
      } else {
        nodeNames.add(key);
      }
    }
    const validNodeIds = new Set(nodes.map((node) => node.id).filter(Boolean));
    const danglingEdges = edges.filter(
      (edge) => !validNodeIds.has(edge.source_id) || !validNodeIds.has(edge.target_id),
    ).length;
    const schemaIssues = validateConstructionShape(output);

    return {
      method: output.method ?? basename(output.__file, ".json"),
      status: output.status ?? "unknown",
      file: output.__file,
      node_count: nodes.length,
      edge_count: edges.length,
      evidence_link_count: evidenceLinks.length,
      semantic_core_count: semanticCore.length,
      pedagogical_profile_count: pedagogicalProfile.length,
      duplicate_name_count: duplicateNames,
      duplicate_name_rate: ratio(duplicateNames, Math.max(nodes.length, 1)),
      dangling_edge_count: danglingEdges,
      schema_issue_count: schemaIssues.length,
      schema_issues: schemaIssues.slice(0, 20),
      gold_dependent_metrics: "pending_adjudicated_gold",
    };
  });
}

function summarizeRuntime(outputs, runtimeCases) {
  if (outputs.length === 0) {
    return {
      status: "pending_inputs",
      note: "No runtime outputs were found.",
    };
  }
  const casesById = new Map(runtimeCases.map((item) => [item.id, item]));

  return outputs.map((output) => {
    const results = output.results ?? [];
    const termCoverages = [];
    const citationPrecisions = [];
    const evidenceRecalls = [];
    let unsupportedClaimCount = 0;
    const latencies = [];

    for (const result of results) {
      const item = casesById.get(result.case_id);
      const answer = result.answer ?? "";
      if (item?.expected_terms?.length) {
        termCoverages.push(termCoverage(answer, item.expected_terms));
      }
      const citations = result.citations ?? [];
      if (citations.length) {
        citationPrecisions.push(
          ratio(
            citations.filter((citation) => citation.mapped_textbook_evidence_id || citation.section_id).length,
            citations.length,
          ),
        );
      }
      const retrievedEvidence = result.retrieved_evidence ?? [];
      if (item?.gold_section_ids?.length) {
        const retrievedSectionIds = new Set(
          retrievedEvidence.map((evidence) => evidence.section_id).filter(Boolean),
        );
        evidenceRecalls.push(
          ratio(
            item.gold_section_ids.filter((sectionId) => retrievedSectionIds.has(sectionId)).length,
            item.gold_section_ids.length,
          ),
        );
      }
      unsupportedClaimCount += (result.unsupported_claims ?? []).length;
      const latency = result.cost?.latency_ms;
      if (typeof latency === "number") {
        latencies.push(latency);
      }
    }

    const schemaIssues = validateRuntimeShape(output);
    return {
      method: output.method ?? basename(output.__file, ".json"),
      status: output.status ?? "unknown",
      file: output.__file,
      case_count: results.length,
      answer_expected_term_coverage_mean: mean(termCoverages),
      citation_mapping_precision_mean: mean(citationPrecisions),
      gold_section_evidence_recall_mean: mean(evidenceRecalls),
      unsupported_claim_count: unsupportedClaimCount,
      latency_ms_mean: mean(latencies),
      schema_issue_count: schemaIssues.length,
      schema_issues: schemaIssues.slice(0, 20),
      answer_correctness: "pending_human_or_gold_judgment",
    };
  });
}

function summarizeExpertScores(rows) {
  const completed = rows.filter((row) => scoreFields.every((field) => parseLikert(row[field]) !== null));
  if (completed.length === 0) {
    return {
      status: "pending_scores",
      note: "No complete expert score rows were found.",
    };
  }

  const byMethod = groupBy(completed, "method_code");
  const methodSummaries = {};
  for (const [methodCode, methodRows] of Object.entries(byMethod)) {
    const totalScores = methodRows.map((row) => rowTotal(row));
    methodSummaries[methodCode] = {
      row_count: methodRows.length,
      total_score_mean: mean(totalScores),
      total_score_ci95_bootstrap: bootstrapCi(totalScores),
      preferred_count: methodRows.filter((row) => row.preferred === "yes").length,
      field_means: Object.fromEntries(
        scoreFields.map((field) => [field, mean(methodRows.map((row) => parseLikert(row[field])).filter(Boolean))]),
      ),
    };
  }

  return {
    status: "computed",
    completed_rows: completed.length,
    method_summaries: methodSummaries,
    pairwise_wilcoxon: computeWilcoxonForTopPair(completed),
  };
}

function validateConstructionShape(output) {
  const issues = [];
  if (!output.method) issues.push("missing method");
  if (!output.status) issues.push("missing status");
  if (!Array.isArray(output.nodes)) issues.push("nodes must be an array");
  if (!Array.isArray(output.edges)) issues.push("edges must be an array");
  for (const [index, node] of (output.nodes ?? []).entries()) {
    if (!node.id) issues.push(`nodes[${index}] missing id`);
    if (!node.name) issues.push(`nodes[${index}] missing name`);
  }
  for (const [index, edge] of (output.edges ?? []).entries()) {
    if (!edge.source_id) issues.push(`edges[${index}] missing source_id`);
    if (!edge.target_id) issues.push(`edges[${index}] missing target_id`);
    if (!edge.type) issues.push(`edges[${index}] missing type`);
  }
  return issues;
}

function validateRuntimeShape(output) {
  const issues = [];
  if (!output.method) issues.push("missing method");
  if (!output.status) issues.push("missing status");
  if (!Array.isArray(output.results)) issues.push("results must be an array");
  for (const [index, result] of (output.results ?? []).entries()) {
    if (!result.case_id) issues.push(`results[${index}] missing case_id`);
    if (typeof result.answer !== "string") issues.push(`results[${index}] answer must be a string`);
  }
  return issues;
}

function computeWilcoxonForTopPair(rows) {
  const byMethod = groupBy(rows, "method_code");
  const methods = Object.entries(byMethod)
    .map(([methodCode, methodRows]) => ({
      methodCode,
      mean: mean(methodRows.map(rowTotal)),
    }))
    .sort((a, b) => b.mean - a.mean);

  if (methods.length < 2) {
    return {
      status: "need_at_least_two_methods",
    };
  }

  const [first, second] = methods;
  const firstByPair = scoreByReviewPair(byMethod[first.methodCode]);
  const secondByPair = scoreByReviewPair(byMethod[second.methodCode]);
  const differences = [];
  for (const [pairKey, firstScore] of firstByPair.entries()) {
    if (secondByPair.has(pairKey)) {
      differences.push(firstScore - secondByPair.get(pairKey));
    }
  }

  if (differences.length < 5) {
    return {
      status: "insufficient_pairs",
      method_a: first.methodCode,
      method_b: second.methodCode,
      paired_n: differences.length,
    };
  }

  return {
    status: "computed",
    method_a: first.methodCode,
    method_b: second.methodCode,
    ...wilcoxonSignedRank(differences),
  };
}

function scoreByReviewPair(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.reviewer_id}:${row.case_id}`, rowTotal(row));
  }
  return map;
}

function wilcoxonSignedRank(differences) {
  const nonZero = differences
    .filter((value) => value !== 0)
    .map((value) => ({ sign: Math.sign(value), abs: Math.abs(value) }))
    .sort((a, b) => a.abs - b.abs);

  const ranked = [];
  let index = 0;
  while (index < nonZero.length) {
    let end = index + 1;
    while (end < nonZero.length && nonZero[end].abs === nonZero[index].abs) {
      end += 1;
    }
    const rank = (index + 1 + end) / 2;
    for (let cursor = index; cursor < end; cursor += 1) {
      ranked.push({ ...nonZero[cursor], rank });
    }
    index = end;
  }

  const wPlus = ranked.filter((item) => item.sign > 0).reduce((sum, item) => sum + item.rank, 0);
  const wMinus = ranked.filter((item) => item.sign < 0).reduce((sum, item) => sum + item.rank, 0);
  const n = ranked.length;
  const expected = (n * (n + 1)) / 4;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24;
  const z = variance > 0 ? (wPlus - expected) / Math.sqrt(variance) : 0;
  const pTwoSidedNormalApprox = 2 * (1 - normalCdf(Math.abs(z)));

  return {
    paired_n: n,
    w_plus: round(wPlus),
    w_minus: round(wMinus),
    z_normal_approx: round(z),
    p_two_sided_normal_approx: round(pTwoSidedNormalApprox),
    note: "Use this as a quick check; final paper statistics should be regenerated in the analysis notebook.",
  };
}

function readJsonOutputs(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const path = resolve(dir, file);
      return {
        ...readJson(path),
        __file: path,
      };
    });
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

function readCsv(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return [];
  }
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(header.map((field, index) => [field, values[index] ?? ""]));
  });
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function renderReport(status) {
  return `# ${status.benchmark_id} Scoring Status

Generated at: ${status.generated_at}

Status: ${status.status}

## Inputs

- Construction files: ${status.inputs.construction_files.length}
- Runtime files: ${status.inputs.runtime_files.length}
- Expert scores present: ${status.inputs.expert_scores_present}

## Construction

\`\`\`json
${JSON.stringify(status.construction_summary, null, 2)}
\`\`\`

## Retrieval And Generation

\`\`\`json
${JSON.stringify(status.runtime_summary, null, 2)}
\`\`\`

## Expert Evaluation

\`\`\`json
${JSON.stringify(status.expert_summary, null, 2)}
\`\`\`
`;
}

function termCoverage(answer, expectedTerms) {
  const normalizedAnswer = normalize(answer);
  const covered = expectedTerms.filter((term) => normalizedAnswer.includes(normalize(term))).length;
  return ratio(covered, expectedTerms.length);
}

function rowTotal(row) {
  return scoreFields.reduce((sum, field) => sum + (parseLikert(row[field]) ?? 0), 0);
}

function parseLikert(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
}

function bootstrapCi(values, iterations = 1000) {
  const clean = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (clean.length === 0) {
    return null;
  }
  const means = [];
  let seed = 123456789;
  for (let i = 0; i < iterations; i += 1) {
    let sum = 0;
    for (let j = 0; j < clean.length; j += 1) {
      seed = lcg(seed);
      const index = Math.floor((seed / 0x100000000) * clean.length);
      sum += clean[index];
    }
    means.push(sum / clean.length);
  }
  means.sort((a, b) => a - b);
  return {
    low: round(means[Math.floor(iterations * 0.025)]),
    high: round(means[Math.floor(iterations * 0.975)]),
  };
}

function lcg(seed) {
  return (1664525 * seed + 1013904223) >>> 0;
}

function normalCdf(value) {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

function erf(value) {
  const sign = value >= 0 ? 1 : -1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
  return sign * y;
}

function groupBy(rows, field) {
  const groups = {};
  for (const row of rows) {
    const key = row[field] ?? "unknown";
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(row);
  }
  return groups;
}

function mean(values) {
  const clean = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (clean.length === 0) {
    return null;
  }
  return round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function ratio(numerator, denominator) {
  return denominator ? round(numerator / denominator) : null;
}

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
}

function round(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
