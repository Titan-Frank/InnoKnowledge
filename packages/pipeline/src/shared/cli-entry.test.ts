import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { isMainModule } from "./cli-entry.js";

test("recognizes a Windows CLI entry path", () => {
  const entryPath = resolve("dist/cli/server-pipeline-run.js");
  assert.equal(isMainModule(pathToFileURL(entryPath).href, entryPath, "win32"), true);
});

test("does not treat an imported module as the CLI entry", () => {
  const modulePath = resolve("dist/cli/server-pipeline-run.js");
  const entryPath = resolve("dist/cli/another-command.js");
  assert.equal(isMainModule(pathToFileURL(modulePath).href, entryPath, process.platform), false);
});
