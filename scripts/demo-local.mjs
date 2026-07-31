#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const demoDbName = process.env.DEMO_DB_NAME || "okm_demo";
const demoDatabaseUrl = `postgresql://okm:okm@127.0.0.1:5432/${demoDbName}`;
const demoHost = process.env.DEMO_HOST || "127.0.0.1";
const demoPort = process.env.DEMO_PORT || "8765";
const mode = process.argv[2] || "serve";
const dockerCommand = process.platform === "win32" ? "docker.exe" : "docker";

if (!/^[A-Za-z0-9_]+$/.test(demoDbName)) {
  fail("DEMO_DB_NAME may contain only letters, numbers, and underscores.");
}

if (mode !== "serve" && mode !== "serve-existing" && mode !== "seed-only") {
  fail("Usage: node scripts/demo-local.mjs [serve|serve-existing|seed-only]");
}

try {
  await main();
} catch (error) {
  reportError(error);
}

async function main() {
  if (!tryRun(dockerCommand, ["compose", "version"], { silent: true })) {
    fail("Docker with the Compose plugin is required for the local demo.");
  }

  console.log("Starting the repository PostgreSQL service...");
  run(dockerCommand, ["compose", "up", "-d", "postgres"]);

  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (tryRun(
      dockerCommand,
      ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "okm", "-d", "knowledge"],
      { silent: true },
    )) {
      ready = true;
      break;
    }
    await sleep(2_000);
  }

  if (!ready) {
    fail("PostgreSQL did not become ready within 60 seconds.");
  }

  const databaseExists = run(
    dockerCommand,
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "okm",
      "-d",
      "postgres",
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname = '${demoDbName}'`,
    ],
    { capture: true },
  ).trim() === "1";

  if (!databaseExists) {
    if (mode === "serve-existing") {
      fail(
        `Demo database '${demoDbName}' does not exist. Run 'npm run demo' once to initialize it.`,
      );
    }
    console.log(`Creating isolated demo database ${demoDbName}...`);
    run(
      dockerCommand,
      ["compose", "exec", "-T", "postgres", "createdb", "-U", "okm", demoDbName],
    );
  }

  if (mode === "serve-existing") {
    console.log(`Reusing existing demo database ${demoDbName}; schema and seed steps are skipped.`);
  } else {
    console.log(`Applying world-v1.2 schema to ${demoDbName}...`);
    runSqlFile("schemas/pg/knowledge_store.sql");

    console.log("Loading the repository-safe synthetic graph...");
    runSqlFile("examples/demo-data/seed-demo.sql");

    console.log(`Demo dataset loaded into ${demoDatabaseUrl}.`);
  }

  if (mode === "seed-only") {
    return;
  }

  console.log(`Building and opening the viewer at http://${demoHost}:${demoPort}/viewer/`);
  runNpm(["run", "build"]);
  await runServer([
    "--host",
    demoHost,
    "--port",
    demoPort,
    "--db",
    demoDatabaseUrl,
  ]);
}

function runSqlFile(relativePath) {
  run(
    dockerCommand,
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "okm",
      "-d",
      demoDbName,
    ],
    { input: readFileSync(join(repoRoot, relativePath)) },
  );
}

function runNpm(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    run(process.execPath, [npmExecPath, ...args]);
    return;
  }

  if (process.platform === "win32") {
    run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`]);
    return;
  }

  run("npm", args);
}

function runServer(args) {
  return new Promise((resolveServer, rejectServer) => {
    const serverPath = join(repoRoot, "packages/server/dist/index.js");
    const child = spawn(process.execPath, [serverPath, ...args], {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    let receivedSignal;

    const relaySignal = (signal) => {
      receivedSignal = signal;
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    };
    const relayInterrupt = () => relaySignal("SIGINT");
    const relayTermination = () => relaySignal("SIGTERM");
    process.once("SIGINT", relayInterrupt);
    process.once("SIGTERM", relayTermination);

    const cleanup = () => {
      process.removeListener("SIGINT", relayInterrupt);
      process.removeListener("SIGTERM", relayTermination);
    };

    child.once("error", (error) => {
      cleanup();
      rejectServer(error);
    });
    child.once("close", (code, signal) => {
      cleanup();
      const finalSignal = receivedSignal || signal;
      if (finalSignal) {
        rejectServer(commandError(process.execPath, [serverPath, ...args], null, finalSignal));
      } else if (code !== 0) {
        rejectServer(commandError(process.execPath, [serverPath, ...args], code));
      } else {
        resolveServer();
      }
    });
  });
}

function tryRun(command, args, options) {
  try {
    run(command, args, options);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  const { capture = false, input, shell = false, silent = false } = options;
  const stdio = capture
    ? ["ignore", "pipe", "pipe"]
    : silent
      ? "ignore"
      : input
        ? ["pipe", "inherit", "inherit"]
        : "inherit";
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: capture ? "utf8" : undefined,
    input,
    shell,
    stdio,
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const details = capture && result.stderr ? `\n${result.stderr.trim()}` : "";
    throw commandError(command, args, result.status, result.signal, details);
  }

  return capture ? result.stdout : "";
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function commandError(command, args, exitCode, signal, details = "") {
  const outcome = signal ? `signal ${signal}` : `exit code ${exitCode}`;
  const error = new Error(
    `Command failed with ${outcome}: ${command} ${args.join(" ")}${details}`,
  );
  error.exitCode = exitCode;
  error.signal = signal;
  return error;
}

function reportError(error) {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  if (!normalizedError.signal) {
    console.error(normalizedError.message);
  }
  const signalNumber = normalizedError.signal
    ? osConstants.signals[normalizedError.signal]
    : undefined;
  process.exitCode = normalizedError.exitCode ?? (signalNumber ? 128 + signalNumber : 1);
}
