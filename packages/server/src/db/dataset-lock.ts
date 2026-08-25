import type { Sql } from './connection.js';

export const DATASET_ADVISORY_LOCK_SQL = 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))';
export const PIPELINE_MUTATION_ADVISORY_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended('__okm_pipeline_mutation__', 0))";
export const PIPELINE_MUTATION_SESSION_LOCK_SQL = "SELECT pg_advisory_lock(hashtextextended('__okm_pipeline_mutation__', 0))";
export const PIPELINE_MUTATION_SESSION_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtextextended('__okm_pipeline_mutation__', 0))";

export async function withPipelineMutationSessionLock<T>(sql: Sql, operation: () => Promise<T>): Promise<T> {
  const connection = await sql.reserve();
  let acquired = false;
  try {
    await connection.unsafe(PIPELINE_MUTATION_SESSION_LOCK_SQL);
    acquired = true;
    return await operation();
  } finally {
    try {
      if (acquired) await connection.unsafe(PIPELINE_MUTATION_SESSION_UNLOCK_SQL);
    } finally {
      connection.release();
    }
  }
}
