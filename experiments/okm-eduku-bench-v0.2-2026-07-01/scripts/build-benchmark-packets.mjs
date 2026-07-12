#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const experimentDir = resolve(scriptDir, "..");
const repoRoot = resolve(experimentDir, "..", "..");
const fixturesDir = resolve(experimentDir, "fixtures");
const outputDir = resolve(experimentDir, "outputs");

const designPath = resolve(fixturesDir, "benchmark-design.json");
const runtimeCasesPath = resolve(fixturesDir, "runtime-cases.v0.2.jsonl");

main();

function main() {
  mkdirSync(outputDir, { recursive: true });

  const design = normalizeDesign(readJson(designPath));
  const runtimeCases = readJsonl(runtimeCasesPath);
  validateDesign(design);
  validateRuntimeCases(design, runtimeCases);

  const books = new Map(design.books.map((book) => [book.id, book]));
  const packets = design.heldout_sections.map((section) =>
    buildSectionPacket(section, books.get(section.book_id)),
  );
  const envStatus = buildEnvStatus();

  const datasetManifest = {
    benchmark_id: design.benchmark_id,
    version: design.version,
    created_at: new Date().toISOString(),
    top_standard: design.standards?.top_level_conceptual ?? null,
    executable_schema: design.standards?.executable_schema ?? null,
    public_contract: design.standards?.public_contract ?? null,
    pilot_reference: design.pilot_reference,
    books: design.books.map((book) => summarizeBook(book)),
    split: design.split,
    heldout_sections: packets.map((packet) => ({
      id: packet.section_id,
      book_id: packet.book_id,
      subject: packet.subject,
      title: packet.title,
      line_start: packet.line_start,
      line_end: packet.line_end,
      coverage_tags: packet.coverage_tags,
      text_sha256: packet.text_sha256,
      char_count: packet.char_count,
      cleaned_char_count: packet.cleaned_char_count,
      estimated_annotation_units: packet.estimated_annotation_units,
    })),
    runtime_case_count: runtimeCases.length,
    runtime_case_count_by_book: countBy(runtimeCases, "book_id"),
    runtime_case_count_by_task_type: countBy(runtimeCases, "task_type"),
    reproducibility: design.reproducibility,
  };

  const runManifest = {
    benchmark_id: design.benchmark_id,
    run_id: `packet-build-${formatRunDate(new Date())}`,
    status: "packets_built",
    created_at: new Date().toISOString(),
    command: "node scripts/build-benchmark-packets.mjs",
    node_version: process.version,
    random_seed: design.reproducibility?.random_seed ?? null,
    inputs: {
      design_path: relativeToRepo(designPath),
      runtime_cases_path: relativeToRepo(runtimeCasesPath),
      textbook_markdown_paths: design.books.map((book) => book.markdown_path),
    },
    outputs: {
      dataset_manifest: "outputs/dataset-manifest.json",
      annotation_packet: "outputs/annotation-packet.jsonl",
      runtime_cases: "outputs/runtime-cases.jsonl",
      run_manifest: "outputs/run-manifest.json",
      env_status: "outputs/env-status.json",
    },
  };

  writeJson(resolve(outputDir, "dataset-manifest.json"), datasetManifest);
  writeJson(resolve(outputDir, "env-status.json"), envStatus);
  writeJsonl(resolve(outputDir, "annotation-packet.jsonl"), packets);
  writeJsonl(resolve(outputDir, "runtime-cases.jsonl"), runtimeCases);
  writeJson(resolve(outputDir, "run-manifest.json"), runManifest);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        benchmark_id: design.benchmark_id,
        sections: packets.length,
        runtime_cases: runtimeCases.length,
        output_dir: relativeToRepo(outputDir),
      },
      null,
      2,
    ),
  );
}

function buildSectionPacket(section, book) {
  if (!book) {
    throw new Error(`Unknown book_id for section ${section.id}: ${section.book_id}`);
  }

  const markdownPath = resolve(repoRoot, book.markdown_path);
  if (!existsSync(markdownPath)) {
    throw new Error(`Missing markdown file for ${book.id}: ${markdownPath}`);
  }

  const markdown = readFileSync(markdownPath, "utf8");
  const lines = markdown.split(/\r?\n/);
  if (section.line_start < 1 || section.line_end > lines.length || section.line_start > section.line_end) {
    throw new Error(
      `Invalid line range for ${section.id}: ${section.line_start}-${section.line_end}; file has ${lines.length} lines`,
    );
  }

  const rawText = lines.slice(section.line_start - 1, section.line_end).join("\n");
  const cleanedText = cleanMarkdownForAnnotation(rawText);

  return {
    section_id: section.id,
    book_id: section.book_id,
    subject: book.subject,
    title: section.title,
    line_start: section.line_start,
    line_end: section.line_end,
    coverage_tags: section.coverage_tags,
    source_markdown_path: book.markdown_path,
    text_sha256: sha256(rawText),
    cleaned_text_sha256: sha256(cleanedText),
    char_count: rawText.length,
    cleaned_char_count: cleanedText.length,
    estimated_annotation_units: estimateAnnotationUnits(cleanedText),
    text: cleanedText,
    annotation_template: {
      annotator_a: emptyAnnotation(),
      annotator_b: emptyAnnotation(),
      adjudicated: emptyAnnotation(),
    },
  };
}

function emptyAnnotation() {
  return {
    knowledge_objects: [],
    relations: [],
    evidence_spans: [],
    semantic_core: [],
    pedagogical_profile: [],
    notes: "",
  };
}

function summarizeBook(book) {
  const markdownPath = resolve(repoRoot, book.markdown_path);
  const exists = existsSync(markdownPath);
  const text = exists ? readFileSync(markdownPath, "utf8") : "";
  const lines = exists ? text.split(/\r?\n/).length : 0;
  return {
    id: book.id,
    subject: book.subject,
    title: book.title,
    markdown_path: book.markdown_path,
    pdf_path: book.pdf_path,
    markdown_exists: exists,
    line_count: lines,
    sha256: exists ? sha256(text) : null,
  };
}

function buildEnvStatus() {
  const gitCommit = execGit(["rev-parse", "HEAD"]);
  const gitBranch = execGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const gitStatus = execGit(["status", "--short"]);
  return {
    captured_at: new Date().toISOString(),
    platform: platform(),
    arch: arch(),
    os_release: release(),
    node_version: process.version,
    npm_version: execCommand("npm", ["--version"]),
    git: {
      branch: gitBranch,
      commit: gitCommit,
      dirty: Boolean(gitStatus),
      status_short_line_count: gitStatus ? gitStatus.split(/\r?\n/).filter(Boolean).length : 0,
    },
    env: {
      database_url_configured: Boolean(process.env.DATABASE_URL),
      database_url_redacted: process.env.DATABASE_URL ? redactUrl(process.env.DATABASE_URL) : null,
      openai_model: process.env.OPENAI_MODEL ?? null,
      llm_model: process.env.LLM_MODEL ?? null,
      vlm_model: process.env.VLM_MODEL ?? null,
    },
  };
}

function validateDesign(design) {
  const required = ["benchmark_id", "version", "books", "heldout_sections"];
  for (const key of required) {
    if (!design[key]) {
      throw new Error(`benchmark-design.json is missing ${key}`);
    }
  }
  const bookIds = new Set(design.books.map((book) => book.id));
  const sectionIds = new Set();
  for (const section of design.heldout_sections) {
    if (sectionIds.has(section.id)) {
      throw new Error(`Duplicate heldout section id: ${section.id}`);
    }
    sectionIds.add(section.id);
    if (!bookIds.has(section.book_id)) {
      throw new Error(`Heldout section ${section.id} references unknown book ${section.book_id}`);
    }
    if (!Array.isArray(section.coverage_tags) || section.coverage_tags.length === 0) {
      throw new Error(`Heldout section ${section.id} needs at least one coverage tag`);
    }
  }
}

function execGit(args) {
  return execCommand("git", args);
}

function execCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function redactUrl(value) {
  return value.replace(/:\/\/([^:@/]+)(?::([^@/]+))?@/, "://***:***@");
}

function normalizeDesign(rawDesign) {
  const version =
    rawDesign.version ??
    rawDesign.benchmark_id?.match(/v\d+(?:\.\d+)?/)?.[0]?.replace(/^v/, "") ??
    "0.2";
  return {
    ...rawDesign,
    version,
    books: (rawDesign.books ?? []).map((book) => ({
      ...book,
      id: book.id ?? book.book_id,
    })),
    split: rawDesign.split ?? rawDesign.splits ?? null,
    standards: rawDesign.standards ?? {
      top_level_conceptual: rawDesign.top_level_standard ?? null,
      executable_schema: rawDesign.executable_schema ?? null,
      public_contract: rawDesign.public_unit_contract ?? null,
    },
    reproducibility: rawDesign.reproducibility ?? rawDesign.reproducibility_defaults ?? null,
  };
}

function validateRuntimeCases(design, runtimeCases) {
  const sectionIds = new Set(design.heldout_sections.map((section) => section.id));
  const bookIds = new Set(design.books.map((book) => book.id));
  const caseIds = new Set();

  for (const item of runtimeCases) {
    if (!item.id || !item.book_id || !item.question || !Array.isArray(item.gold_section_ids)) {
      throw new Error(`Runtime case is missing required fields: ${JSON.stringify(item)}`);
    }
    if (caseIds.has(item.id)) {
      throw new Error(`Duplicate runtime case id: ${item.id}`);
    }
    caseIds.add(item.id);
    if (!bookIds.has(item.book_id)) {
      throw new Error(`Runtime case ${item.id} references unknown book ${item.book_id}`);
    }
    for (const sectionId of item.gold_section_ids) {
      if (!sectionIds.has(sectionId)) {
        throw new Error(`Runtime case ${item.id} references unknown section ${sectionId}`);
      }
    }
  }
}

function cleanMarkdownForAnnotation(text) {
  return text
    .replace(/<details>[\s\S]*?<\/details>/g, "\n")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "\n")
    .replace(/<img\b[^>]*>/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function estimateAnnotationUnits(text) {
  const headings = (text.match(/^#{1,6}\s+/gm) ?? []).length;
  const formulas = (text.match(/\$[^$]+\$/g) ?? []).length + (text.match(/\$\$[\s\S]*?\$\$/g) ?? []).length;
  const paragraphs = text.split(/\n\s*\n/).filter((part) => part.trim().length > 30).length;
  return {
    headings,
    formulas,
    paragraphs,
  };
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

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const value = row[field] ?? "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function formatRunDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function relativeToRepo(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
}
