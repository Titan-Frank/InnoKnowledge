#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = resolve(repoRoot, process.argv[2] ?? "artifacts/okm-public-v0.1.0");
const viewerDist = join(repoRoot, "packages/viewer/dist");
const artifactViewer = join(artifactDir, "viewer");

if (!existsSync(join(artifactDir, "manifest.json"))) {
  throw new Error(`Public artifact manifest is missing: ${relative(repoRoot, artifactDir)}`);
}

execFileSync("npm", ["run", "build", "-w", "packages/viewer"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    VITE_PUBLIC_ARTIFACT_BASE: "..",
  },
  stdio: "inherit",
});

rmSync(artifactViewer, { recursive: true, force: true });
mkdirSync(artifactViewer, { recursive: true });
cpSync(viewerDist, artifactViewer, { recursive: true });
writeChecksums(artifactDir);

process.stdout.write(`${JSON.stringify({
  status: "success",
  artifact: relative(repoRoot, artifactDir),
  viewer: relative(repoRoot, artifactViewer),
}, null, 2)}\n`);

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
