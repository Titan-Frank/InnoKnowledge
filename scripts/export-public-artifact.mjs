#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const databaseUrl = args.get("db") ?? process.env.DATABASE_URL ?? "postgresql://okm:okm@127.0.0.1:5432/knowledge";
const datasetId = args.get("dataset-id") ?? "main";
const artifactVersion = args.get("artifact-version") ?? "v0.1.0";
const outputDir = resolve(repoRoot, args.get("output") ?? `artifacts/okm-public-${artifactVersion}`);
const allowUnreviewed = args.has("allow-unreviewed");
const includeMedia = args.has("include-media");

const connectionModule = resolve(repoRoot, "packages/server/dist/db/connection.js");
const queryModule = resolve(repoRoot, "packages/server/dist/db/queries.js");
if (!existsSync(connectionModule) || !existsSync(queryModule)) {
  throw new Error("Server build output is missing. Run npm run build -w packages/server before exporting.");
}

const { createPool, closePool } = await import(connectionModule);
const { buildBundlePayload, loadUnit, resolveDatasetRow } = await import(queryModule);
const sql = createPool(databaseUrl);

try {
  const dataset = await resolveDatasetRow(sql, datasetId);
  if (!dataset) throw new Error(`Dataset '${datasetId}' was not found.`);

  const [datasetMetadata] = await sql`
    SELECT dataset_id, dataset_name, schema_version, status, is_active, root_path,
           created_at, updated_at, notes
    FROM world_datasets
    WHERE dataset_id = ${dataset.dataset_id}
  `;
  const sourceRows = await sql`
    SELECT dataset_id, source_id, source_type, book_id, title, file_path,
           outline_path, properties_json
    FROM world_source_artifacts
    WHERE dataset_id = ${dataset.dataset_id}
    ORDER BY source_type, source_id
  `;
  const sourceRights = sourceRows.map((row) => String(row.properties_json?.rights_status ?? ""));
  const clearedStatuses = new Set(["self_authored", "public_domain", "open_license", "permission_granted"]);
  const sourcesCleared = sourceRows.length > 0 && sourceRights.every((status) => clearedStatuses.has(status));
  if (!sourcesCleared && !allowUnreviewed) {
    throw new Error(
      `Dataset '${datasetId}' lacks complete public-source rights metadata. ` +
      "Use a cleared dataset or pass --allow-unreviewed for a non-public candidate export.",
    );
  }

  const bundle = await buildBundlePayload(sql, dataset.dataset_id, null, null);
  const nodes = bundle.nodes
    .filter((node) => node.status !== "deprecated")
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const activeNodeIds = new Set(nodes.map((node) => String(node.id)));
  const edges = bundle.edges
    .filter((edge) => edge.status !== "deprecated")
    .filter((edge) => activeNodeIds.has(String(edge.from_id ?? edge.from)) && activeNodeIds.has(String(edge.to_id ?? edge.to)))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const profiles = bundle.profiles
    .filter((profile) => profile.status !== "deprecated" && activeNodeIds.has(String(profile.node_id)))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));

  rmSync(join(outputDir, "data"), { recursive: true, force: true });
  mkdirSync(join(outputDir, "data", "units"), { recursive: true });

  const unitIndex = [];
  const exportedEvidenceIds = new Set();
  const exportedMentionIds = new Set();
  const exportedProfileIds = new Set();
  let exportedCards = 0;
  let exportedBodies = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const nodeId = String(node.id);
    const loadedUnit = await loadUnit(sql, dataset.dataset_id, nodeId, dataset.dataset_id);
    const unit = loadedUnit && !includeMedia ? { ...loadedUnit, media: [] } : loadedUnit;
    if (!unit) throw new Error(`ApiUnit export failed for '${nodeId}'.`);
    for (const item of unit.evidence) exportedEvidenceIds.add(String(item.id));
    for (const item of unit.mentions) exportedMentionIds.add(String(item.id));
    for (const item of unit.domain_profiles) exportedProfileIds.add(String(item.id));
    if (unit.card) exportedCards += 1;
    if (unit.body) exportedBodies += 1;
    const file = `unit-${String(index + 1).padStart(6, "0")}.json`;
    writeJson(join(outputDir, "data", "units", file), unit);
    unitIndex.push({
      node_id: nodeId,
      name: String(unit.node.name ?? node.canonical_name ?? nodeId),
      kind: String(unit.node.kind ?? node.node_kind ?? "concept"),
      file,
    });
  }

  const countRows = await sql`
    SELECT
      (SELECT count(*)::int FROM world_nodes WHERE dataset_id = ${dataset.dataset_id} AND status != 'deprecated') AS nodes,
      (SELECT count(*)::int FROM world_edges WHERE dataset_id = ${dataset.dataset_id} AND status != 'deprecated') AS edges,
      (SELECT count(*)::int FROM world_evidence WHERE dataset_id = ${dataset.dataset_id}) AS evidence,
      (SELECT count(*)::int FROM world_mentions WHERE dataset_id = ${dataset.dataset_id}) AS mentions,
      (SELECT count(*)::int FROM world_domain_profiles WHERE dataset_id = ${dataset.dataset_id} AND status != 'deprecated') AS domain_profiles,
      (SELECT count(*)::int FROM world_node_cards WHERE dataset_id = ${dataset.dataset_id} AND status != 'deprecated') AS cards,
      (SELECT count(*)::int FROM world_node_bodies WHERE dataset_id = ${dataset.dataset_id} AND status != 'deprecated') AS bodies
  `;
  const sourceDatabaseCounts = countRows[0];
  const counts = {
    nodes: nodes.length,
    edges: edges.length,
    evidence: exportedEvidenceIds.size,
    mentions: exportedMentionIds.size,
    domain_profiles: exportedProfileIds.size,
    cards: exportedCards,
    bodies: exportedBodies,
  };

  writeJson(join(outputDir, "data", "graph.json"), {
    artifact_version: artifactVersion,
    dataset: datasetMetadata,
    source: bundle.source,
    counts,
    nodes,
    edges,
    profiles,
  });
  writeJson(join(outputDir, "data", "units", "index.json"), {
    artifact_version: artifactVersion,
    dataset_id: dataset.dataset_id,
    count: unitIndex.length,
    units: unitIndex,
  });

  const hasRootLicense = existsSync(join(repoRoot, "LICENSE")) || existsSync(join(repoRoot, "LICENSE.md"));
  const manifest = {
    artifact_id: "okm-public-artifact",
    artifact_version: artifactVersion,
    generated_at: new Date().toISOString(),
    generated_from_commit: currentCommit(),
    generated_from_dirty_worktree: hasDirtyWorktree(),
    contracts: {
      conceptual_standard: "ai-nks-v0.1",
      executable_schema: String(datasetMetadata.schema_version ?? "world-v1.2"),
      public_contract: "ApiUnit-v0.1",
      api_unit_schema: "schemas/api-unit.schema.json",
    },
    source_database: {
      dataset_id: dataset.dataset_id,
      dataset_name: datasetMetadata.dataset_name,
      root_path: datasetMetadata.root_path,
      database_counts: sourceDatabaseCounts,
      sources: sourceRows,
    },
    selection: {
      nodes: "status != deprecated",
      edges: "status != deprecated and both endpoints exported",
      units: "one current ApiUnit per exported node",
      media: includeMedia ? "metadata exported; no binary source assets copied" : "omitted from static artifact",
    },
    counts,
    rights: {
      source_clearance: sourcesCleared ? "cleared-by-source-metadata" : "review-required",
      source_rights_statuses: [...new Set(sourceRights)].sort(),
      repository_license: hasRootLicense ? "see-root-license" : "not-selected",
      redistribution: !sourcesCleared
        ? "not-cleared-for-public-redistribution"
        : hasRootLicense
          ? "subject-to-root-license"
          : "license-pending",
      publication_status: sourcesCleared ? "source-cleared" : "candidate-rights-review-required",
      evaluation_status: "candidate-snapshot-not-a-benchmark",
    },
    files: {
      graph: "data/graph.json",
      unit_index: "data/units/index.json",
      checksum_list: "SHA256SUMS",
      viewer: "viewer/index.html",
      javascript_example: "examples/javascript/read-unit.mjs",
      python_example: "examples/python/read_unit.py",
    },
  };
  writeJson(join(outputDir, "manifest.json"), manifest);
  writeFileSync(join(outputDir, "index.html"), `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <meta http-equiv="refresh" content="0; url=viewer/" />
    <title>Open Knowledge Map</title>
  </head>
  <body>
    <p><a href="viewer/">打开 Open Knowledge Map 只读成果查看器</a></p>
  </body>
</html>
`, "utf8");
  writeChecksums(outputDir);

  process.stdout.write(
    `${JSON.stringify({ status: "success", output: relative(repoRoot, outputDir), dataset_id: dataset.dataset_id, counts }, null, 2)}\n`,
  );
} finally {
  await closePool(sql);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) throw new Error(`Unexpected argument '${raw}'.`);
    const name = raw.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      values.set(name, "true");
    } else {
      values.set(name, next);
      index += 1;
    }
  }
  return values;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(stableValue(sanitizeValue(value)), null, 2)}\n`, "utf8");
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]));
  }
  if (typeof value !== "string") return value;
  const withoutLiveAssets = value
    .replace(/!\[[^\]]*\]\(\/api\/source\/[^)]+\)/g, "[source image omitted from static artifact]")
    .replace(/\/api\/source\/[^\s\"'<>)]*/g, "[live-asset-not-included]")
    .replaceAll(repoRoot, ".");
  if (!isAbsolute(withoutLiveAssets)) return withoutLiveAssets;
  const normalizedRoot = repoRoot.endsWith(sep) ? repoRoot : `${repoRoot}${sep}`;
  if (withoutLiveAssets === repoRoot) return ".";
  if (withoutLiveAssets.startsWith(normalizedRoot)) return relative(repoRoot, withoutLiveAssets).replaceAll("\\", "/");
  return "[external-path-redacted]";
}

function currentCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function hasDirtyWorktree() {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim().length > 0;
  } catch {
    return true;
  }
}

function walkFiles(root, current = root) {
  const files = [];
  for (const name of readdirSync(current).sort()) {
    const path = join(current, name);
    if (statSync(path).isDirectory()) files.push(...walkFiles(root, path));
    else files.push(path);
  }
  return files;
}

function writeChecksums(root) {
  const entries = walkFiles(root)
    .filter((path) => relative(root, path) !== "SHA256SUMS")
    .map((path) => {
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      return `${digest}  ${relative(root, path).replaceAll("\\", "/")}`;
    });
  writeFileSync(join(root, "SHA256SUMS"), `${entries.join("\n")}\n`, "utf8");
}
