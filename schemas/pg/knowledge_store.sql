-- Open Knowledge Map — World Knowledge Runtime Schema
-- This file is the single runtime schema used by extraction, staging, merge,
-- normalization, QA, and retrieval. The old v2 schema has been retired.

CREATE EXTENSION IF NOT EXISTS vector;

-------------------------------------------------------------------
-- world_datasets
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_datasets (
  dataset_id TEXT PRIMARY KEY,
  dataset_name TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL DEFAULT 'world-v1.2',
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  is_active SMALLINT NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  root_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_world_datasets_single_active
ON world_datasets(is_active)
WHERE is_active = 1;

-------------------------------------------------------------------
-- world_source_artifacts
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_source_artifacts (
  dataset_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  book_id TEXT,
  title TEXT,
  file_path TEXT,
  outline_path TEXT,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (dataset_id, source_id),
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE
);

-------------------------------------------------------------------
-- textbook source structures imported from local generated files
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_textbook_outlines (
  dataset_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  title TEXT,
  source_path TEXT,
  outline_path TEXT,
  outline_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  item_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, book_id),
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_textbook_outlines_updated
ON world_textbook_outlines(dataset_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS world_enrich_library (
  dataset_id TEXT PRIMARY KEY,
  generated_at TEXT,
  book_count INTEGER NOT NULL DEFAULT 0,
  subject_count INTEGER NOT NULL DEFAULT 0,
  node_count INTEGER NOT NULL DEFAULT 0,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_enrich_books (
  dataset_id TEXT NOT NULL,
  path TEXT NOT NULL,
  filename TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT,
  stage TEXT,
  grade TEXT,
  course TEXT,
  publisher TEXT,
  volume TEXT,
  root_count INTEGER NOT NULL DEFAULT 0,
  node_count INTEGER NOT NULL DEFAULT 0,
  max_depth INTEGER NOT NULL DEFAULT 0,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  tree_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, path),
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_enrich_books_subject
ON world_enrich_books(dataset_id, subject, stage, grade);

CREATE TABLE IF NOT EXISTS world_mineru_sources (
  dataset_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unknown', 'success', 'blocked')),
  source_markdown_path TEXT,
  batch_id TEXT,
  zip_url TEXT,
  zip_path TEXT,
  extract_dir TEXT,
  raw_markdown_path TEXT,
  created_by_mineru SMALLINT NOT NULL DEFAULT 0 CHECK (created_by_mineru IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, book_id),
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE
);

ALTER TABLE world_mineru_sources
  DROP COLUMN IF EXISTS manifest_path,
  DROP COLUMN IF EXISTS manifest_json;

CREATE INDEX IF NOT EXISTS idx_world_mineru_sources_updated
ON world_mineru_sources(dataset_id, updated_at DESC);

-------------------------------------------------------------------
-- world_nodes
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_nodes (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'entity',
      'concept',
      'property',
      'process',
      'event',
      'method',
      'rule',
      'representation',
      'resource'
    )
  ),
  subkind TEXT,
  definition TEXT NOT NULL,
  aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  domains_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  knowledge_form_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  learning_mode_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  scope TEXT CHECK (scope IN ('universal', 'domain-specific', 'culture-specific')),
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_ids_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  embedding vector(2560) DEFAULT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  deprecated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_nodes_name
ON world_nodes(dataset_id, name);

CREATE INDEX IF NOT EXISTS idx_world_nodes_kind
ON world_nodes(dataset_id, kind);

CREATE INDEX IF NOT EXISTS idx_world_nodes_subkind
ON world_nodes(dataset_id, subkind);

CREATE INDEX IF NOT EXISTS idx_world_nodes_status
ON world_nodes(dataset_id, status);

-------------------------------------------------------------------
-- world_node_terms
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_node_terms (
  dataset_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  term TEXT NOT NULL,
  term_norm TEXT NOT NULL,
  term_type TEXT NOT NULL CHECK (term_type IN ('canonical', 'alias', 'tag')),
  PRIMARY KEY (dataset_id, node_id, term_norm, term_type),
  FOREIGN KEY (dataset_id, node_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_node_terms_norm
ON world_node_terms(dataset_id, term_norm);

-------------------------------------------------------------------
-- world_edges
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_edges (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (
    type IN (
      'is_a',
      'instance_of',
      'part_of',
      'contains',
      'has_property',
      'uses',
      'produces',
      'depends_on',
      'prerequisite_for',
      'causes',
      'affects',
      'represents',
      'about',
      'same_as',
      'related_to'
    )
  ),
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  directionality TEXT NOT NULL CHECK (directionality IN ('directed', 'undirected')),
  confidence REAL NOT NULL DEFAULT 0.8,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id, from_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id, to_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_edges_from
ON world_edges(dataset_id, from_id);

CREATE INDEX IF NOT EXISTS idx_world_edges_to
ON world_edges(dataset_id, to_id);

CREATE INDEX IF NOT EXISTS idx_world_edges_type
ON world_edges(dataset_id, type);

-------------------------------------------------------------------
-- world_taxonomy_terms
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_taxonomy_terms (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  scheme TEXT NOT NULL CHECK (
    scheme IN (
      'domain',
      'knowledge-form',
      'learning-mode',
      'scope',
      'school-stage',
      'discipline-tree'
    )
  ),
  description TEXT,
  aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_taxonomy_terms_scheme
ON world_taxonomy_terms(dataset_id, scheme);

CREATE INDEX IF NOT EXISTS idx_world_taxonomy_terms_name
ON world_taxonomy_terms(dataset_id, name);

-------------------------------------------------------------------
-- world_taxonomy_edges
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_taxonomy_edges (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  parent_term_id TEXT NOT NULL,
  child_term_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('broader', 'narrower', 'related')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id, parent_term_id) REFERENCES world_taxonomy_terms(dataset_id, id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id, child_term_id) REFERENCES world_taxonomy_terms(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_taxonomy_edges_parent
ON world_taxonomy_edges(dataset_id, parent_term_id);

CREATE INDEX IF NOT EXISTS idx_world_taxonomy_edges_child
ON world_taxonomy_edges(dataset_id, child_term_id);

-------------------------------------------------------------------
-- world_domain_profiles
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_domain_profiles (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  school_stages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  curriculum_roles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id, node_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_domain_profiles_node
ON world_domain_profiles(dataset_id, node_id);

CREATE INDEX IF NOT EXISTS idx_world_domain_profiles_domain
ON world_domain_profiles(dataset_id, domain);

-------------------------------------------------------------------
-- world_mentions
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_mentions (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  anchor_ref TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('node', 'edge', 'taxonomy_term', 'domain_profile')),
  target_id TEXT NOT NULL,
  role TEXT NOT NULL,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence REAL NOT NULL,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_mentions_target
ON world_mentions(dataset_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_world_mentions_source_anchor
ON world_mentions(dataset_id, source_id, anchor_ref);

-------------------------------------------------------------------
-- world_evidence
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_evidence (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  anchor_ref TEXT NOT NULL,
  source_path TEXT,
  page_start INTEGER,
  page_end INTEGER,
  excerpt TEXT NOT NULL,
  locator TEXT NOT NULL,
  modality TEXT,
  extraction_method TEXT NOT NULL,
  normalized_claims_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_evidence_source_anchor
ON world_evidence(dataset_id, source_id, anchor_ref);

-------------------------------------------------------------------
-- world_evidence_links
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_evidence_links (
  dataset_id TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('edge', 'domain_profile', 'mention', 'node_card', 'node_card_section')),
  owner_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  ordinal INTEGER,
  PRIMARY KEY (dataset_id, owner_type, owner_id, evidence_id),
  FOREIGN KEY (dataset_id, evidence_id) REFERENCES world_evidence(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_evidence_links_owner
ON world_evidence_links(dataset_id, owner_type, owner_id);

-------------------------------------------------------------------
-- world_node_cards
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_node_cards (
  dataset_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sections_json JSONB NOT NULL,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, node_id),
  FOREIGN KEY (dataset_id, node_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE
);

-------------------------------------------------------------------
-- world_node_bodies
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_node_bodies (
  dataset_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('markdown')),
  content TEXT NOT NULL,
  media_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_from TEXT NOT NULL CHECK (
    generated_from IN ('manual', 'card_expansion', 'imported_unit', 'model_generation')
  ),
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, node_id),
  FOREIGN KEY (dataset_id, node_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_node_bodies_status
ON world_node_bodies(dataset_id, status);

-------------------------------------------------------------------
-- retrieval_candidates
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retrieval_candidates (
  dataset_id TEXT NOT NULL,
  batch_anchor TEXT NOT NULL,
  query_id TEXT NOT NULL,
  query_text TEXT NOT NULL,
  candidate_node_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score REAL,
  retrieval_method TEXT NOT NULL,
  filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, query_id, candidate_node_id),
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id, candidate_node_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE
);

-------------------------------------------------------------------
-- world_lesson_runs
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_lesson_runs (
  dataset_id TEXT NOT NULL,
  lesson_run_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  batch_anchor TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staged', 'merging', 'merged', 'qa_passed', 'blocked')),
  counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, lesson_run_id),
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_lesson_runs_status
ON world_lesson_runs(dataset_id, status, book_id);

-------------------------------------------------------------------
-- pipeline runtime status
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_pipeline_jobs (
  dataset_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'blocked')),
  current_stage_id TEXT,
  progress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  log_path TEXT,
  command_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT,
  PRIMARY KEY (dataset_id, job_id),
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_pipeline_jobs_updated
ON world_pipeline_jobs(dataset_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS world_pipeline_job_stages (
  dataset_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'blocked', 'skipped')),
  sort_order INTEGER NOT NULL,
  label TEXT NOT NULL,
  progress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, job_id, stage_id),
  FOREIGN KEY (dataset_id, job_id) REFERENCES world_pipeline_jobs(dataset_id, job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_pipeline_job_stages_order
ON world_pipeline_job_stages(dataset_id, job_id, sort_order);

CREATE TABLE IF NOT EXISTS world_pipeline_job_events (
  dataset_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT,
  worker_slot INTEGER,
  lesson_run_id TEXT,
  batch_anchor TEXT,
  detail TEXT,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, job_id, event_id),
  FOREIGN KEY (dataset_id, job_id) REFERENCES world_pipeline_jobs(dataset_id, job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_pipeline_job_events_recent
ON world_pipeline_job_events(dataset_id, job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS world_pipeline_worker_states (
  dataset_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  worker_slot INTEGER NOT NULL,
  stage_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'completed', 'failed')),
  lesson_run_id TEXT,
  batch_anchor TEXT,
  error TEXT,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, job_id, worker_slot),
  FOREIGN KEY (dataset_id, job_id) REFERENCES world_pipeline_jobs(dataset_id, job_id) ON DELETE CASCADE
);

-------------------------------------------------------------------
-- staging tables
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_staging_nodes (
  dataset_id TEXT NOT NULL,
  lesson_run_id TEXT NOT NULL,
  raw_node_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  batch_anchor TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  subkind TEXT,
  definition TEXT NOT NULL,
  aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  domains_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  knowledge_form_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  learning_mode_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  scope TEXT,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_ids_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  semantic_key TEXT,
  embedding vector(2560) DEFAULT NULL,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, lesson_run_id, raw_node_id),
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES world_lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_staging_edges (
  dataset_id TEXT NOT NULL,
  lesson_run_id TEXT NOT NULL,
  raw_edge_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  batch_anchor TEXT NOT NULL,
  type TEXT NOT NULL,
  from_raw_node_id TEXT NOT NULL,
  to_raw_node_id TEXT NOT NULL,
  directionality TEXT NOT NULL,
  confidence REAL NOT NULL,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, lesson_run_id, raw_edge_id),
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES world_lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_staging_domain_profiles (
  dataset_id TEXT NOT NULL,
  lesson_run_id TEXT NOT NULL,
  raw_profile_id TEXT NOT NULL,
  raw_node_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  school_stages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  curriculum_roles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, lesson_run_id, raw_profile_id),
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES world_lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_staging_mentions (
  dataset_id TEXT NOT NULL,
  lesson_run_id TEXT NOT NULL,
  raw_mention_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  anchor_ref TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_raw_id TEXT NOT NULL,
  role TEXT NOT NULL,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence REAL NOT NULL,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, lesson_run_id, raw_mention_id),
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES world_lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_staging_evidence (
  dataset_id TEXT NOT NULL,
  lesson_run_id TEXT NOT NULL,
  raw_evidence_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  anchor_ref TEXT NOT NULL,
  source_path TEXT,
  page_start INTEGER,
  page_end INTEGER,
  excerpt TEXT NOT NULL,
  locator TEXT NOT NULL,
  modality TEXT,
  extraction_method TEXT NOT NULL,
  normalized_claims_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, lesson_run_id, raw_evidence_id),
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES world_lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_staging_node_cards (
  dataset_id TEXT NOT NULL,
  lesson_run_id TEXT NOT NULL,
  raw_card_id TEXT NOT NULL,
  raw_node_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sections_json JSONB NOT NULL,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, lesson_run_id, raw_card_id),
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES world_lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

-------------------------------------------------------------------
-- merge bookkeeping
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_merge_runs (
  dataset_id TEXT NOT NULL,
  merge_run_id TEXT NOT NULL,
  selection_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'blocked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, merge_run_id),
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_canonical_node_map (
  dataset_id TEXT NOT NULL,
  merge_run_id TEXT NOT NULL,
  lesson_run_id TEXT NOT NULL,
  raw_node_id TEXT NOT NULL,
  canonical_node_id TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK (resolution IN ('matched', 'created', 'review')),
  similarity REAL NOT NULL,
  rationale_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, merge_run_id, lesson_run_id, raw_node_id),
  FOREIGN KEY (dataset_id, merge_run_id) REFERENCES world_merge_runs(dataset_id, merge_run_id) ON DELETE CASCADE
);
