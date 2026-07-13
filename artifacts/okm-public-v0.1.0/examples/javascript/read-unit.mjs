#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const index = readJson(join(artifactRoot, "data/units/index.json"));
const requestedNodeId = process.argv[2];
const entry = requestedNodeId
  ? index.units.find((item) => item.node_id === requestedNodeId)
  : index.units[0];

if (!entry) {
  process.stderr.write(`Unknown node id '${requestedNodeId}'.\n`);
  process.exit(1);
}

const relativePath = `data/units/${entry.file}`;
const absolutePath = join(artifactRoot, relativePath);
verifyChecksum(artifactRoot, relativePath, absolutePath);
const unit = readJson(absolutePath);

process.stdout.write(`${JSON.stringify({
  node_id: unit.node.id,
  name: unit.node.name,
  kind: unit.node.kind,
  definition: unit.node.definition,
  outgoing_relations: unit.relations.outgoing.length,
  incoming_relations: unit.relations.incoming.length,
  evidence_ids: unit.evidence.map((item) => item.id),
  completeness: unit.completeness,
}, null, 2)}\n`);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function verifyChecksum(root, relativePath, absolutePath) {
  const expectedLine = readFileSync(join(root, "SHA256SUMS"), "utf8")
    .split(/\r?\n/)
    .find((line) => line.endsWith(`  ${relativePath}`));
  if (!expectedLine) throw new Error(`Checksum is missing for ${relativePath}.`);
  const expected = expectedLine.split(/\s+/)[0];
  const actual = createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
  if (actual !== expected) throw new Error(`Checksum mismatch for ${relativePath}.`);
}
