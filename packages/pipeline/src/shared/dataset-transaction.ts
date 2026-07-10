import type { SqlStatement } from "../staging/staging-sql.js";

export type TransactionSqlExecutor = (statement: SqlStatement) => Promise<void> | void;

export const DATASET_TRANSACTION_BEGIN_SQL = "BEGIN";
export const DATASET_ADVISORY_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))";

export function buildDatasetAdvisoryLockStatement(datasetId: string): SqlStatement {
  return {
    name: "lock-dataset-transaction",
    sql: DATASET_ADVISORY_LOCK_SQL,
    params: [datasetId],
  };
}

export function isTransactionControlSql(sql: string): boolean {
  return /^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim());
}

export async function rollbackTransaction(
  execute: TransactionSqlExecutor,
  rollbackStatement: SqlStatement,
  error: unknown,
  label: string,
): Promise<never> {
  try {
    await execute(rollbackStatement);
  } catch (rollbackError) {
    throw new Error(
      `${label} transaction failed: ${errorMessage(error)}; rollback also failed: ${errorMessage(rollbackError)}`,
      { cause: error },
    );
  }
  throw error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
