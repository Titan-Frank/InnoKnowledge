import assert from "node:assert/strict";
import test from "node:test";

import {
  PIPELINE_MUTATION_SESSION_LOCK_SQL,
  PIPELINE_MUTATION_SESSION_UNLOCK_SQL,
  withPipelineMutationSessionLock,
} from "./dataset-transaction.js";

test("standalone pipeline mutations hold the global maintenance lock for the full operation", async () => {
  const calls: string[] = [];
  const connection = {
    unsafe: async (query: string) => {
      calls.push(query === PIPELINE_MUTATION_SESSION_LOCK_SQL ? "lock" : query === PIPELINE_MUTATION_SESSION_UNLOCK_SQL ? "unlock" : query);
      return [];
    },
    release: () => { calls.push("release"); },
  };
  const sql = {
    reserve: async () => connection,
  } as unknown as Parameters<typeof withPipelineMutationSessionLock>[0];

  const result = await withPipelineMutationSessionLock(sql, async () => {
    calls.push("operation");
    return "done";
  });

  assert.equal(result, "done");
  assert.deepEqual(calls, ["lock", "operation", "unlock", "release"]);
});

test("standalone pipeline mutations release the maintenance lock after failure", async () => {
  const calls: string[] = [];
  const connection = {
    unsafe: async (query: string) => {
      calls.push(query === PIPELINE_MUTATION_SESSION_LOCK_SQL ? "lock" : "unlock");
      return [];
    },
    release: () => { calls.push("release"); },
  };
  const sql = {
    reserve: async () => connection,
  } as unknown as Parameters<typeof withPipelineMutationSessionLock>[0];

  await assert.rejects(
    withPipelineMutationSessionLock(sql, async () => {
      calls.push("operation");
      throw new Error("failed");
    }),
    /failed/,
  );
  assert.deepEqual(calls, ["lock", "operation", "unlock", "release"]);
});
