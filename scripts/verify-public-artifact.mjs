#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = resolve(repoRoot, process.argv[2] ?? "artifacts/okm-public-v0.1.0");
const requiredTopLevel = [
  "node", "relations", "domain_profiles", "mentions", "evidence",
  "media", "source_fragments", "card", "body", "completeness",
];
const validStages = new Set(["primary", "junior-secondary", "senior-secondary", "higher"]);

verifyChecksums();
const manifest = readJson("manifest.json");
const graph = readJson(manifest.files.graph);
const index = readJson(manifest.files.unit_index);

assert(index.count === index.units.length, "Unit index count does not match its entries.");
assert(index.count === Number(manifest.counts.nodes), "Unit count does not match manifest node count.");
assert(graph.nodes.length === Number(manifest.counts.nodes), "Graph node count does not match manifest.");
assert(graph.edges.length === Number(manifest.counts.edges), "Graph edge count does not match manifest.");

const nodeIds = new Set(graph.nodes.map((node) => String(node.id)));
assert(nodeIds.size === graph.nodes.length, "Graph contains duplicate node identifiers.");
for (const edge of graph.edges) {
  assert(nodeIds.has(String(edge.from_id ?? edge.from)), `Missing edge source '${edge.id}'.`);
  assert(nodeIds.has(String(edge.to_id ?? edge.to)), `Missing edge target '${edge.id}'.`);
}

for (const entry of index.units) {
  const unit = readJson(`data/units/${entry.file}`);
  const serializedUnit = JSON.stringify(unit);
  assert(String(unit.node?.id) === String(entry.node_id), `Unit index mismatch for '${entry.node_id}'.`);
  for (const key of requiredTopLevel) assert(Object.hasOwn(unit, key), `ApiUnit '${entry.node_id}' is missing '${key}'.`);
  assert(Array.isArray(unit.relations?.outgoing), `ApiUnit '${entry.node_id}' has invalid outgoing relations.`);
  assert(Array.isArray(unit.relations?.incoming), `ApiUnit '${entry.node_id}' has invalid incoming relations.`);
  assert(Number(unit.completeness?.score) >= 0 && Number(unit.completeness?.score) <= 100, `ApiUnit '${entry.node_id}' has invalid completeness score.`);
  for (const profile of unit.domain_profiles ?? []) {
    for (const stage of profile.school_stages ?? []) {
      assert(validStages.has(String(stage)), `ApiUnit '${entry.node_id}' has invalid school stage '${stage}'.`);
    }
  }
  assert(!serializedUnit.includes("/Users/"), `ApiUnit '${entry.node_id}' exposes a macOS user path.`);
  assert(!serializedUnit.includes("%2FUsers"), `ApiUnit '${entry.node_id}' exposes an encoded macOS user path.`);
  assert(!serializedUnit.includes("/home/"), `ApiUnit '${entry.node_id}' exposes a Linux home path.`);
  assert(!serializedUnit.includes("/api/source/"), `ApiUnit '${entry.node_id}' still depends on a live source API.`);
}

const serialized = JSON.stringify({ manifest, graph, index });
assert(!serialized.includes("/Users/"), "Artifact exposes a macOS user path.");
assert(!serialized.includes("/home/"), "Artifact exposes a Linux home path.");
assert(!serialized.includes("/api/source/"), "Artifact still depends on a live source API.");

process.stdout.write(`${JSON.stringify({
  status: "success",
  artifact: artifactRoot,
  nodes: graph.nodes.length,
  edges: graph.edges.length,
  units: index.units.length,
}, null, 2)}\n`);

function readJson(relativePath) {
  const path = join(artifactRoot, relativePath);
  assert(existsSync(path), `Missing artifact file '${relativePath}'.`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function verifyChecksums() {
  const checksumPath = join(artifactRoot, "SHA256SUMS");
  assert(existsSync(checksumPath), "Missing SHA256SUMS.");
  for (const line of readFileSync(checksumPath, "utf8").split(/\r?\n/).filter(Boolean)) {
    const [expected, relativePath] = line.split(/\s{2}/, 2);
    const path = join(artifactRoot, relativePath);
    assert(existsSync(path), `Checksum target '${relativePath}' is missing.`);
    const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
    assert(actual === expected, `Checksum mismatch for '${relativePath}'.`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
