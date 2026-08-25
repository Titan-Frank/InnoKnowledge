export const DATASET_ADVISORY_LOCK_SQL = 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))';
export const PIPELINE_MUTATION_ADVISORY_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended('__okm_pipeline_mutation__', 0))";
