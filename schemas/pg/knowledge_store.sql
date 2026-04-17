-- Open Knowledge Map — PostgreSQL schema
-- Migrated from: schemas/sqlite/knowledge_store.sql
-- Requires extensions: vector (pgvector)

CREATE EXTENSION IF NOT EXISTS vector;

-------------------------------------------------------------------
-- datasets
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS datasets (
  dataset_id TEXT PRIMARY KEY,
  version_key TEXT NOT NULL UNIQUE,
  root_path TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL DEFAULT 'v2',
  status TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'active', 'archived')),
  is_active SMALLINT NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  activated_at TEXT,
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_datasets_single_active
ON datasets(is_active)
WHERE is_active = 1;

-------------------------------------------------------------------
-- source_artifacts
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_artifacts (
  dataset_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  book_id TEXT,
  title TEXT,
  file_path TEXT,
  outline_path TEXT,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (dataset_id, source_id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
);

-------------------------------------------------------------------
-- nodes
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodes (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  node_kind TEXT NOT NULL,
  node_layer TEXT NOT NULL,
  node_subkind TEXT,
  definition TEXT NOT NULL,
  aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  learning_modes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  bridge_tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  framework_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  profile_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  card_ref TEXT,
  same_as_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(2560) DEFAULT NULL,
  community_id INTEGER DEFAULT NULL,
  pca_x REAL DEFAULT NULL,
  pca_y REAL DEFAULT NULL,
  status TEXT NOT NULL,
  deprecated_by TEXT,
  created_at TEXT,
  updated_at TEXT,
  notes TEXT,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nodes_name
ON nodes(dataset_id, canonical_name);

CREATE INDEX IF NOT EXISTS idx_nodes_kind_layer
ON nodes(dataset_id, node_kind, node_layer);

CREATE INDEX IF NOT EXISTS idx_nodes_community
ON nodes(dataset_id, community_id);

-------------------------------------------------------------------
-- node_terms
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node_terms (
  dataset_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  term TEXT NOT NULL,
  term_norm TEXT NOT NULL,
  term_type TEXT NOT NULL CHECK (term_type IN ('canonical', 'alias')),
  PRIMARY KEY (dataset_id, node_id, term_norm, term_type),
  FOREIGN KEY (dataset_id, node_id) REFERENCES nodes(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_node_terms_norm
ON node_terms(dataset_id, term_norm);

-------------------------------------------------------------------
-- edges
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edges (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  edge_layer TEXT NOT NULL,
  backbone_expand SMALLINT NOT NULL CHECK (backbone_expand IN (0, 1)),
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  directionality TEXT NOT NULL,
  confidence REAL NOT NULL,
  framework_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  profile_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id, from_id) REFERENCES nodes(dataset_id, id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id, to_id) REFERENCES nodes(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edges_from
ON edges(dataset_id, from_id);

CREATE INDEX IF NOT EXISTS idx_edges_to
ON edges(dataset_id, to_id);

CREATE INDEX IF NOT EXISTS idx_edges_type
ON edges(dataset_id, edge_type);

-------------------------------------------------------------------
-- profiles
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  school_stage TEXT NOT NULL,
  grade_band TEXT NOT NULL,
  context_key TEXT NOT NULL,
  curriculum_role TEXT NOT NULL,
  mastery_level TEXT NOT NULL,
  framework_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  textbook_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  textbook_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  learning_objectives_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  assessment_signals_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  updated_at TEXT,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id, node_id) REFERENCES nodes(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_profiles_node
ON profiles(dataset_id, node_id);

CREATE INDEX IF NOT EXISTS idx_profiles_context
ON profiles(dataset_id, subject, school_stage, grade_band);

CREATE INDEX IF NOT EXISTS idx_profiles_context_key
ON profiles(dataset_id, context_key);

-------------------------------------------------------------------
-- profile_textbooks
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile_textbooks (
  dataset_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  textbook_id TEXT NOT NULL,
  PRIMARY KEY (dataset_id, profile_id, textbook_id),
  FOREIGN KEY (dataset_id, profile_id) REFERENCES profiles(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_profile_textbooks_textbook
ON profile_textbooks(dataset_id, textbook_id);

-------------------------------------------------------------------
-- mentions (+ triggers)
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mentions (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  anchor_ref TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  role TEXT NOT NULL,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence REAL NOT NULL,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mentions_target
ON mentions(dataset_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_mentions_source_anchor
ON mentions(dataset_id, source_id, anchor_ref);

-- Trigger: mentions.source_id must match book_id from anchor_ref
CREATE OR REPLACE FUNCTION trg_mentions_textbook_source_check()
RETURNS TRIGGER AS $$
DECLARE
  v_pos INTEGER;
  v_book_id TEXT;
BEGIN
  IF NEW.source_type = 'textbook' AND NEW.anchor_ref LIKE 'struct:%' THEN
    v_pos := position(':' IN substring(NEW.anchor_ref FROM 8));
    IF v_pos > 0 THEN
      v_book_id := substring(NEW.anchor_ref FROM 8 FOR v_pos - 1);
      IF NEW.source_id != v_book_id THEN
        RAISE EXCEPTION 'mentions.source_id must match textbook book_id from anchor_ref';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mentions_textbook_source_insert
BEFORE INSERT ON mentions
FOR EACH ROW
EXECUTE FUNCTION trg_mentions_textbook_source_check();

CREATE TRIGGER trg_mentions_textbook_source_update
BEFORE UPDATE OF source_type, source_id, anchor_ref ON mentions
FOR EACH ROW
EXECUTE FUNCTION trg_mentions_textbook_source_check();

-------------------------------------------------------------------
-- evidence (+ triggers)
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence (
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
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_evidence_source_anchor
ON evidence(dataset_id, source_id, anchor_ref);

CREATE INDEX IF NOT EXISTS idx_evidence_pages
ON evidence(dataset_id, source_id, page_start, page_end);

-- Trigger: evidence.source_id must match book_id from anchor_ref
CREATE OR REPLACE FUNCTION trg_evidence_textbook_source_check()
RETURNS TRIGGER AS $$
DECLARE
  v_pos INTEGER;
  v_book_id TEXT;
BEGIN
  IF NEW.source_type = 'textbook' AND NEW.anchor_ref LIKE 'struct:%' THEN
    v_pos := position(':' IN substring(NEW.anchor_ref FROM 8));
    IF v_pos > 0 THEN
      v_book_id := substring(NEW.anchor_ref FROM 8 FOR v_pos - 1);
      IF NEW.source_id != v_book_id THEN
        RAISE EXCEPTION 'evidence.source_id must match textbook book_id from anchor_ref';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_evidence_textbook_source_insert
BEFORE INSERT ON evidence
FOR EACH ROW
EXECUTE FUNCTION trg_evidence_textbook_source_check();

CREATE TRIGGER trg_evidence_textbook_source_update
BEFORE UPDATE OF source_type, source_id, anchor_ref ON evidence
FOR EACH ROW
EXECUTE FUNCTION trg_evidence_textbook_source_check();

-------------------------------------------------------------------
-- evidence_links
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence_links (
  dataset_id TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('edge', 'profile', 'mention', 'card', 'card_section', 'relation_proposal')),
  owner_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  ordinal INTEGER,
  PRIMARY KEY (dataset_id, owner_type, owner_id, evidence_id),
  FOREIGN KEY (dataset_id, evidence_id) REFERENCES evidence(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_evidence_links_owner
ON evidence_links(dataset_id, owner_type, owner_id);

CREATE INDEX IF NOT EXISTS idx_evidence_links_evidence
ON evidence_links(dataset_id, evidence_id);

-------------------------------------------------------------------
-- node_cards
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node_cards (
  dataset_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  id TEXT,
  card_layer TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  pattern_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  framework_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  profile_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  mention_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sections_json JSONB NOT NULL,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  updated_at TEXT,
  PRIMARY KEY (dataset_id, node_id),
  FOREIGN KEY (dataset_id, node_id) REFERENCES nodes(dataset_id, id) ON DELETE CASCADE
);

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
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id, candidate_node_id) REFERENCES nodes(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_retrieval_candidates_batch
ON retrieval_candidates(dataset_id, batch_anchor, query_id, rank);

CREATE INDEX IF NOT EXISTS idx_retrieval_candidates_node
ON retrieval_candidates(dataset_id, candidate_node_id);

-------------------------------------------------------------------
-- batch_runtime_records
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batch_runtime_records (
  dataset_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  batch_anchor TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (
    record_type IN (
      'query',
      'node',
      'profile',
      'mention',
      'evidence',
      'node_card',
      'relation_proposal'
    )
  ),
  record_id TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, batch_anchor, record_type, record_id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_batch_runtime_lookup
ON batch_runtime_records(dataset_id, book_id, batch_anchor, record_type);

-------------------------------------------------------------------
-- lesson_runs
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lesson_runs (
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
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lesson_runs_status
ON lesson_runs(dataset_id, status, book_id);

CREATE INDEX IF NOT EXISTS idx_lesson_runs_anchor
ON lesson_runs(dataset_id, book_id, batch_anchor);

-------------------------------------------------------------------
-- staging_nodes
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staging_nodes (
  dataset_id TEXT NOT NULL,
  lesson_run_id TEXT NOT NULL,
  raw_node_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  batch_anchor TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  node_kind TEXT NOT NULL,
  node_layer TEXT NOT NULL,
  node_subkind TEXT,
  definition TEXT NOT NULL,
  aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  learning_modes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  bridge_tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  framework_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  profile_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  same_as_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  semantic_key TEXT,
  embedding vector(2560) DEFAULT NULL,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, lesson_run_id, raw_node_id),
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staging_nodes_anchor
ON staging_nodes(dataset_id, book_id, batch_anchor);

CREATE INDEX IF NOT EXISTS idx_staging_nodes_semantic
ON staging_nodes(dataset_id, node_kind, semantic_key);

-------------------------------------------------------------------
-- staging_edges
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staging_edges (
  dataset_id TEXT NOT NULL,
  lesson_run_id TEXT NOT NULL,
  raw_edge_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  batch_anchor TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  edge_layer TEXT NOT NULL,
  backbone_expand SMALLINT NOT NULL DEFAULT 0 CHECK (backbone_expand IN (0, 1)),
  from_raw_node_id TEXT NOT NULL,
  to_raw_node_id TEXT NOT NULL,
  directionality TEXT NOT NULL,
  confidence REAL NOT NULL,
  framework_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  profile_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, lesson_run_id, raw_edge_id),
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staging_edges_anchor
ON staging_edges(dataset_id, book_id, batch_anchor, edge_type);

-------------------------------------------------------------------
-- staging_profiles
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staging_profiles (
  dataset_id TEXT NOT NULL,
  lesson_run_id TEXT NOT NULL,
  raw_profile_id TEXT NOT NULL,
  raw_node_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  school_stage TEXT NOT NULL,
  grade_band TEXT NOT NULL,
  context_key TEXT NOT NULL,
  curriculum_role TEXT NOT NULL,
  mastery_level TEXT NOT NULL,
  framework_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  textbook_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  textbook_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  learning_objectives_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  assessment_signals_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, lesson_run_id, raw_profile_id),
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staging_profiles_node
ON staging_profiles(dataset_id, lesson_run_id, raw_node_id);

-------------------------------------------------------------------
-- staging_mentions
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staging_mentions (
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
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staging_mentions_anchor
ON staging_mentions(dataset_id, source_id, anchor_ref);

-------------------------------------------------------------------
-- staging_evidence
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staging_evidence (
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
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staging_evidence_anchor
ON staging_evidence(dataset_id, source_id, anchor_ref);

-------------------------------------------------------------------
-- staging_node_cards
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staging_node_cards (
  dataset_id TEXT NOT NULL,
  lesson_run_id TEXT NOT NULL,
  raw_card_id TEXT NOT NULL,
  raw_node_id TEXT NOT NULL,
  card_layer TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  pattern_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  framework_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  profile_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  mention_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sections_json JSONB NOT NULL,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, lesson_run_id, raw_card_id),
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staging_node_cards_node
ON staging_node_cards(dataset_id, lesson_run_id, raw_node_id);

-------------------------------------------------------------------
-- merge_runs
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS merge_runs (
  dataset_id TEXT NOT NULL,
  merge_run_id TEXT NOT NULL,
  selection_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'blocked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, merge_run_id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
);

-------------------------------------------------------------------
-- canonical_node_map
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_node_map (
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
  FOREIGN KEY (dataset_id, merge_run_id) REFERENCES merge_runs(dataset_id, merge_run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canonical_node_map_lookup
ON canonical_node_map(dataset_id, lesson_run_id, raw_node_id);

-------------------------------------------------------------------
-- relation_proposals
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS relation_proposals (
  dataset_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  batch_anchor TEXT NOT NULL,
  source_id TEXT NOT NULL,
  anchor_ref TEXT NOT NULL,
  subject TEXT,
  school_stage TEXT,
  grade_band TEXT,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'accepted', 'review', 'rejected')),
  conflict_type TEXT,
  conflict_with_edge_id TEXT,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (dataset_id, proposal_id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id, from_node_id) REFERENCES nodes(dataset_id, id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id, to_node_id) REFERENCES nodes(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_relation_proposals_batch_status
ON relation_proposals(dataset_id, batch_anchor, status);

CREATE INDEX IF NOT EXISTS idx_relation_proposals_signature
ON relation_proposals(dataset_id, from_node_id, to_node_id, edge_type);

-------------------------------------------------------------------
-- review_queue
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_queue (
  dataset_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('node', 'edge', 'profile', 'relation_proposal')),
  owner_id TEXT NOT NULL,
  batch_anchor TEXT,
  review_type TEXT NOT NULL CHECK (review_type IN ('conflict', 'ambiguity', 'missing_evidence', 'merge_risk', 'schema')),
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
  priority INTEGER NOT NULL DEFAULT 2,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (dataset_id, review_id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_review_queue_status
ON review_queue(dataset_id, status, review_type);

