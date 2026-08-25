import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { databaseUrlFromArgs, forwardTerminationSignals } from "./with-pipeline-mutation-lock.js";

test("pipeline mutation wrapper resolves an explicit database URL before the environment", () => {
  assert.equal(databaseUrlFromArgs(["--db", "postgresql://explicit", "--dataset-id", "main"], { DATABASE_URL: "postgresql://env" }), "postgresql://explicit");
  assert.equal(databaseUrlFromArgs(["--db=postgresql://equals"], {}), "postgresql://equals");
  assert.equal(databaseUrlFromArgs([], { DATABASE_URL: "postgresql://env" }), "postgresql://env");
});

test("pipeline mutation wrapper forwards termination and can remove its handlers", () => {
  const source = new EventEmitter();
  const signals: NodeJS.Signals[] = [];
  const remove = forwardTerminationSignals({
    kill: (signal) => {
      if (typeof signal === "string") signals.push(signal);
      return true;
    },
  }, source);

  source.emit("SIGTERM");
  source.emit("SIGINT");
  assert.deepEqual(signals, ["SIGTERM", "SIGINT"]);
  remove();
  source.emit("SIGTERM");
  assert.deepEqual(signals, ["SIGTERM", "SIGINT"]);
});
