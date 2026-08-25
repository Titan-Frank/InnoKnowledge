import assert from "node:assert/strict";
import test from "node:test";

import { DATASET_ADVISORY_LOCK_SQL } from "./dataset-transaction.js";
import { startPostgresPipelineJob } from "./pipeline-progress.js";

function sqlText(strings: TemplateStringsArray): string {
  return strings.join("$value").replace(/\s+/g, " ").trim();
}

test("direct pipeline job starts acquire the shared dataset lock before recording the job", async () => {
  const calls: Array<{ kind: "query" | "unsafe"; sql: string; values: unknown[] }> = [];
  const transaction = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ kind: "query", sql: sqlText(strings), values });
      return Promise.resolve([]);
    },
    {
      unsafe: async (sql: string, values: unknown[] = []) => {
        calls.push({ kind: "unsafe" as const, sql, values });
        return [];
      },
      json: (value: unknown) => value,
    },
  );
  const sql = {
    begin: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
  } as unknown as Parameters<typeof startPostgresPipelineJob>[0];

  await startPostgresPipelineJob(sql, {
    datasetId: "main",
    jobId: "job-1",
    bookId: "book-1",
    logPath: "/tmp/job-1.log",
  }, "2026-08-25T00:00:00.000Z");

  assert.deepEqual(calls[0], {
    kind: "unsafe",
    sql: DATASET_ADVISORY_LOCK_SQL,
    values: ["main"],
  });
  assert.equal(calls[1]?.kind, "query");
  assert.match(calls[1]?.sql ?? "", /^INSERT INTO world_pipeline_jobs/);
});
