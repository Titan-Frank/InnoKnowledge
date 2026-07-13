-- Open Knowledge Map — AI-Native Multidisciplinary Knowledge Runtime Schema
-- This file is the single runtime schema used by extraction, staging, merge,
-- normalization, QA, and retrieval. The old v2 schema has been retired.

CREATE EXTENSION IF NOT EXISTS vector;

-------------------------------------------------------------------
-- world_datasets
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_datasets (
  dataset_id TEXT PRIMARY KEY,
  dataset_name TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL DEFAULT 'world-v1.3',
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  is_active SMALLINT NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  root_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT
);

UPDATE world_datasets
SET schema_version = 'world-v1.3', updated_at = COALESCE(updated_at, created_at)
WHERE schema_version = 'world-v1.2';

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
-- governed source policies
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_source_policies (
  source_type TEXT PRIMARY KEY,
  display_name_zh TEXT NOT NULL,
  relation_evidence_allowed SMALLINT NOT NULL DEFAULT 0 CHECK (relation_evidence_allowed IN (0, 1)),
  requires_explicit_review SMALLINT NOT NULL DEFAULT 1 CHECK (requires_explicit_review IN (0, 1)),
  trust_tier INTEGER NOT NULL DEFAULT 1 CHECK (trust_tier BETWEEN 0 AND 3),
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('active', 'deprecated')),
  updated_at TEXT NOT NULL,
  CHECK (jsonb_typeof(properties_json) = 'object')
);

INSERT INTO world_source_policies (
  source_type, display_name_zh, relation_evidence_allowed,
  requires_explicit_review, trust_tier, properties_json, status, updated_at
) VALUES
  ('textbook', '教材', 1, 0, 2, '{}'::jsonb, 'active', '2026-07-13T00:00:00.000Z'),
  ('academic_paper', '学术论文', 1, 0, 3, '{}'::jsonb, 'active', '2026-07-13T00:00:00.000Z'),
  ('encyclopedia', '百科资料', 1, 1, 1, '{}'::jsonb, 'active', '2026-07-13T00:00:00.000Z'),
  ('curriculum_standard', '课程标准', 1, 0, 3, '{}'::jsonb, 'active', '2026-07-13T00:00:00.000Z'),
  ('structured_database', '结构化数据库', 1, 0, 3, '{}'::jsonb, 'active', '2026-07-13T00:00:00.000Z'),
  ('expert_note', '专家知识', 1, 1, 2, '{}'::jsonb, 'active', '2026-07-13T00:00:00.000Z')
ON CONFLICT (source_type) DO UPDATE SET
  display_name_zh = EXCLUDED.display_name_zh,
  relation_evidence_allowed = EXCLUDED.relation_evidence_allowed,
  requires_explicit_review = EXCLUDED.requires_explicit_review,
  trust_tier = EXCLUDED.trust_tier,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at;

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
  embedding vector(1024) DEFAULT NULL,
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'world_nodes'::regclass
      AND attname = 'embedding'
      AND NOT attisdropped
      AND format_type(atttypid, atttypmod) <> 'vector(1024)'
  ) THEN
    ALTER TABLE world_nodes
      ALTER COLUMN embedding TYPE vector(1024) USING NULL;
  END IF;
END $$;

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
      'formalizes',
      'applies_to',
      'analogous_to',
      'models',
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

-- CREATE TABLE IF NOT EXISTS does not replace constraints on an existing
-- world-v1.2 database, so the executable relation vocabulary is migrated
-- explicitly. same_as is retained only so historical rows can be deprecated.
ALTER TABLE world_edges
  DROP CONSTRAINT IF EXISTS world_edges_type_check,
  DROP CONSTRAINT IF EXISTS world_edges_same_as_legacy_check;

ALTER TABLE world_edges
  ADD CONSTRAINT world_edges_type_check CHECK (
    type IN (
      'is_a', 'instance_of', 'part_of', 'contains', 'has_property',
      'uses', 'produces', 'depends_on', 'prerequisite_for', 'causes',
      'affects', 'represents', 'formalizes', 'applies_to', 'analogous_to',
      'models', 'about', 'same_as', 'related_to'
    )
  );

UPDATE world_edges
SET
  status = 'deprecated',
  properties_json = COALESCE(properties_json, '{}'::jsonb)
    || jsonb_build_object('legacy_relation', TRUE, 'replacement', 'canonical_node_merge'),
  notes = concat_ws(E'\n', NULLIF(notes, ''), 'world-v1.3：same_as 已停用，请改用节点身份归一。'),
  updated_at = GREATEST(updated_at, '2026-07-13T00:00:00.000Z')
WHERE type = 'same_as' AND status <> 'deprecated';

ALTER TABLE world_edges
  ADD CONSTRAINT world_edges_same_as_legacy_check CHECK (
    type <> 'same_as' OR status = 'deprecated'
  );

CREATE OR REPLACE FUNCTION world_reject_new_same_as_edge()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.type = 'same_as'
    AND (TG_OP = 'INSERT' OR OLD.type IS DISTINCT FROM NEW.type)
  THEN
    RAISE EXCEPTION 'world-v1.3 不允许新建 same_as 关系；请执行节点身份归一';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_world_reject_new_same_as_edge ON world_edges;
CREATE TRIGGER trg_world_reject_new_same_as_edge
BEFORE INSERT OR UPDATE OF type ON world_edges
FOR EACH ROW EXECUTE FUNCTION world_reject_new_same_as_edge();

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
-- governed domain schemas
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_domain_schemas (
  schema_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  display_name_zh TEXT NOT NULL,
  roles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('active', 'deprecated')),
  updated_at TEXT NOT NULL,
  CHECK (jsonb_typeof(roles_json) = 'array'),
  CHECK (jsonb_typeof(properties_json) = 'object')
);

INSERT INTO world_domain_schemas (
  schema_id, domain, schema_version, display_name_zh,
  roles_json, properties_json, status, updated_at
) VALUES
  ('domain:general:v1', 'general', '1.0', '通用学科模式',
    '["knowledge_object","principle","method","representation","resource"]'::jsonb,
    '{}'::jsonb, 'active', '2026-07-13T00:00:00.000Z'),
  ('domain:mathematics:v1', 'mathematics', '1.0', '数学学科模式',
    '["definition","theorem","proof_technique","mathematical_model","problem_solving_method","formal_representation"]'::jsonb,
    '{}'::jsonb, 'active', '2026-07-13T00:00:00.000Z'),
  ('domain:physics:v1', 'physics', '1.0', '物理学科模式',
    '["law","principle","model","phenomenon","experiment","measurement_method","physical_quantity"]'::jsonb,
    '{}'::jsonb, 'active', '2026-07-13T00:00:00.000Z'),
  ('domain:computer-science:v1', 'computer-science', '1.0', '计算机科学学科模式',
    '["algorithm","data_structure","computational_model","system","programming_construct","method","theory"]'::jsonb,
    '{}'::jsonb, 'active', '2026-07-13T00:00:00.000Z'),
  ('domain:chemistry:v1', 'chemistry', '1.0', '化学学科模式',
    '["substance","reaction","law","model","principle","experiment","analysis_method","chemical_property"]'::jsonb,
    '{}'::jsonb, 'active', '2026-07-13T00:00:00.000Z'),
  ('domain:biology:v1', 'biology', '1.0', '生物学科模式',
    '["structure","process","mechanism","theory","model","experiment","classification","organism"]'::jsonb,
    '{}'::jsonb, 'active', '2026-07-13T00:00:00.000Z')
ON CONFLICT (schema_id) DO UPDATE SET
  domain = EXCLUDED.domain,
  schema_version = EXCLUDED.schema_version,
  display_name_zh = EXCLUDED.display_name_zh,
  roles_json = EXCLUDED.roles_json,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at;

-------------------------------------------------------------------
-- world_domain_profiles: domain semantics only
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_domain_profiles (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  schema_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  domain_role TEXT NOT NULL,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id, node_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE,
  FOREIGN KEY (schema_id) REFERENCES world_domain_schemas(schema_id)
);

ALTER TABLE world_domain_profiles
  ADD COLUMN IF NOT EXISTS schema_id TEXT,
  ADD COLUMN IF NOT EXISTS schema_version TEXT,
  ADD COLUMN IF NOT EXISTS domain_role TEXT;

UPDATE world_domain_profiles AS profile
SET
  schema_id = schema.schema_id,
  schema_version = schema.schema_version,
  domain_role = COALESCE(NULLIF(profile.properties_json ->> 'domain_role', ''), schema.roles_json ->> 0, 'knowledge_object')
FROM world_domain_schemas AS schema
WHERE schema.domain = CASE
    WHEN EXISTS (SELECT 1 FROM world_domain_schemas known WHERE known.domain = profile.domain)
      THEN profile.domain
    ELSE 'general'
  END
  AND (profile.schema_id IS NULL OR profile.schema_version IS NULL OR profile.domain_role IS NULL);

ALTER TABLE world_domain_profiles
  ALTER COLUMN schema_id SET NOT NULL,
  ALTER COLUMN schema_version SET NOT NULL,
  ALTER COLUMN domain_role SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'world_domain_profiles'::regclass
      AND conname = 'world_domain_profiles_schema_id_fkey'
  ) THEN
    ALTER TABLE world_domain_profiles
      ADD CONSTRAINT world_domain_profiles_schema_id_fkey
      FOREIGN KEY (schema_id) REFERENCES world_domain_schemas(schema_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_world_domain_profiles_node
ON world_domain_profiles(dataset_id, node_id);

CREATE INDEX IF NOT EXISTS idx_world_domain_profiles_domain
ON world_domain_profiles(dataset_id, domain);

CREATE INDEX IF NOT EXISTS idx_world_domain_profiles_schema_role
ON world_domain_profiles(dataset_id, schema_id, domain_role);

-------------------------------------------------------------------
-- world_curriculum_projections: teaching and curriculum context
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_curriculum_projections (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  curriculum_id TEXT NOT NULL,
  school_stage TEXT NOT NULL CHECK (school_stage IN ('primary', 'junior-secondary', 'senior-secondary', 'higher')),
  grade_band TEXT,
  curriculum_roles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id, node_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(curriculum_roles_json) = 'array'),
  CHECK (jsonb_typeof(source_refs_json) = 'array'),
  CHECK (jsonb_typeof(properties_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_world_curriculum_projections_node
ON world_curriculum_projections(dataset_id, node_id);

CREATE INDEX IF NOT EXISTS idx_world_curriculum_projections_context
ON world_curriculum_projections(dataset_id, domain, curriculum_id, school_stage, grade_band);

-- Migrate world-v1.2 teaching fields before removing them from domain profiles.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'world_domain_profiles'::regclass
      AND attname = 'school_stages_json' AND NOT attisdropped
  ) THEN
    EXECUTE $migration$
      INSERT INTO world_curriculum_projections (
        dataset_id, id, node_id, domain, curriculum_id, school_stage, grade_band,
        curriculum_roles_json, source_refs_json, properties_json, status,
        created_at, updated_at, notes
      )
      SELECT
        profile.dataset_id,
        'curriculum-projection:legacy-' || substr(md5(
          profile.dataset_id || '|' || profile.node_id || '|' || profile.domain || '|' || stage.school_stage
        ), 1, 20),
        profile.node_id,
        profile.domain,
        COALESCE(NULLIF(profile.properties_json ->> 'curriculum_id', ''), 'legacy:school-stage'),
        stage.school_stage,
        NULLIF(profile.properties_json ->> 'grade_band', ''),
        COALESCE(profile.curriculum_roles_json, '[]'::jsonb),
        COALESCE(profile.source_refs_json, '[]'::jsonb),
        CASE
          WHEN COALESCE(profile.properties_json -> 'pedagogical_profiles_by_stage' -> stage.school_stage,
                        profile.properties_json -> 'pedagogical_profile') IS NULL
            THEN '{}'::jsonb
          ELSE jsonb_build_object(
            'pedagogical_profile',
            COALESCE(profile.properties_json -> 'pedagogical_profiles_by_stage' -> stage.school_stage,
                     profile.properties_json -> 'pedagogical_profile')
          )
        END,
        profile.status,
        profile.created_at,
        profile.updated_at,
        concat_ws(E'\n', NULLIF(profile.notes, ''), '由 world-v1.2 领域画像中的教学字段迁移。')
      FROM world_domain_profiles AS profile
      CROSS JOIN LATERAL (
        SELECT DISTINCT value AS school_stage
        FROM (
          SELECT jsonb_array_elements_text(COALESCE(profile.school_stages_json, '[]'::jsonb)) AS value
          UNION ALL
          SELECT jsonb_object_keys(COALESCE(profile.properties_json -> 'pedagogical_profiles_by_stage', '{}'::jsonb)) AS value
        ) AS stages
        WHERE value IN ('primary', 'junior-secondary', 'senior-secondary', 'higher')
      ) AS stage
      ON CONFLICT (dataset_id, id) DO UPDATE SET
        curriculum_roles_json = EXCLUDED.curriculum_roles_json,
        source_refs_json = EXCLUDED.source_refs_json,
        properties_json = EXCLUDED.properties_json,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at
    $migration$;

    UPDATE world_domain_profiles
    SET properties_json = properties_json
      - 'schema_id'
      - 'schema_version'
      - 'domain_role'
      - 'school_stage'
      - 'school_stages'
      - 'curriculum_roles'
      - 'curriculum_id'
      - 'grade_band'
      - 'pedagogical_profile'
      - 'pedagogical_profiles_by_stage';

    ALTER TABLE world_domain_profiles
      DROP COLUMN school_stages_json,
      DROP COLUMN curriculum_roles_json;
  END IF;
END $$;

-------------------------------------------------------------------
-- world_mentions
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_mentions (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  anchor_ref TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('node', 'edge', 'taxonomy_term', 'domain_profile', 'curriculum_projection')),
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

ALTER TABLE world_mentions
  DROP CONSTRAINT IF EXISTS world_mentions_target_type_check;
ALTER TABLE world_mentions
  ADD CONSTRAINT world_mentions_target_type_check CHECK (
    target_type IN ('node', 'edge', 'taxonomy_term', 'domain_profile', 'curriculum_projection')
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
  owner_type TEXT NOT NULL CHECK (owner_type IN ('edge', 'domain_profile', 'curriculum_projection', 'mention', 'node_card', 'node_card_section')),
  owner_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  ordinal INTEGER,
  PRIMARY KEY (dataset_id, owner_type, owner_id, evidence_id),
  FOREIGN KEY (dataset_id, evidence_id) REFERENCES world_evidence(dataset_id, id) ON DELETE CASCADE
);

ALTER TABLE world_evidence_links
  DROP CONSTRAINT IF EXISTS world_evidence_links_owner_type_check;
ALTER TABLE world_evidence_links
  ADD CONSTRAINT world_evidence_links_owner_type_check CHECK (
    owner_type IN ('edge', 'domain_profile', 'curriculum_projection', 'mention', 'node_card', 'node_card_section')
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
-- world_unit_embeddings
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_unit_embeddings (
  dataset_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  embedding vector(1024) NOT NULL,
  content_hash TEXT NOT NULL,
  retrieval_text TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, node_id),
  FOREIGN KEY (dataset_id, node_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_unit_embeddings_model
ON world_unit_embeddings(dataset_id, embedding_model);

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
  embedding vector(1024) DEFAULT NULL,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, lesson_run_id, raw_node_id),
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES world_lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'world_staging_nodes'::regclass
      AND attname = 'embedding'
      AND NOT attisdropped
      AND format_type(atttypid, atttypmod) <> 'vector(1024)'
  ) THEN
    ALTER TABLE world_staging_nodes
      ALTER COLUMN embedding TYPE vector(1024) USING NULL;
  END IF;
END $$;

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
  schema_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  domain_role TEXT NOT NULL,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, lesson_run_id, raw_profile_id),
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES world_lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE
);

ALTER TABLE world_staging_domain_profiles
  ADD COLUMN IF NOT EXISTS schema_id TEXT,
  ADD COLUMN IF NOT EXISTS schema_version TEXT,
  ADD COLUMN IF NOT EXISTS domain_role TEXT;

UPDATE world_staging_domain_profiles AS profile
SET
  schema_id = schema.schema_id,
  schema_version = schema.schema_version,
  domain_role = COALESCE(NULLIF(profile.properties_json ->> 'domain_role', ''), schema.roles_json ->> 0, 'knowledge_object')
FROM world_domain_schemas AS schema
WHERE schema.domain = CASE
    WHEN EXISTS (SELECT 1 FROM world_domain_schemas known WHERE known.domain = profile.domain)
      THEN profile.domain
    ELSE 'general'
  END
  AND (profile.schema_id IS NULL OR profile.schema_version IS NULL OR profile.domain_role IS NULL);

ALTER TABLE world_staging_domain_profiles
  ALTER COLUMN schema_id SET NOT NULL,
  ALTER COLUMN schema_version SET NOT NULL,
  ALTER COLUMN domain_role SET NOT NULL;

CREATE TABLE IF NOT EXISTS world_staging_curriculum_projections (
  dataset_id TEXT NOT NULL,
  lesson_run_id TEXT NOT NULL,
  raw_projection_id TEXT NOT NULL,
  raw_node_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  curriculum_id TEXT NOT NULL,
  school_stage TEXT NOT NULL,
  grade_band TEXT,
  curriculum_roles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (dataset_id, lesson_run_id, raw_projection_id),
  FOREIGN KEY (dataset_id, lesson_run_id) REFERENCES world_lesson_runs(dataset_id, lesson_run_id) ON DELETE CASCADE,
  CHECK (school_stage IN ('primary', 'junior-secondary', 'senior-secondary', 'higher')),
  CHECK (jsonb_typeof(curriculum_roles_json) = 'array'),
  CHECK (jsonb_typeof(source_refs_json) = 'array'),
  CHECK (jsonb_typeof(properties_json) = 'object')
);

-- Preserve staged world-v1.2 teaching context before removing the mixed fields.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'world_staging_domain_profiles'::regclass
      AND attname = 'school_stages_json' AND NOT attisdropped
  ) THEN
    EXECUTE $migration$
      INSERT INTO world_staging_curriculum_projections (
        dataset_id, lesson_run_id, raw_projection_id, raw_node_id, domain,
        curriculum_id, school_stage, grade_band, curriculum_roles_json,
        source_refs_json, properties_json, status, created_at, updated_at, notes
      )
      SELECT
        profile.dataset_id,
        profile.lesson_run_id,
        profile.raw_profile_id || ':curriculum:' || stage.school_stage,
        profile.raw_node_id,
        profile.domain,
        COALESCE(NULLIF(profile.properties_json ->> 'curriculum_id', ''), 'legacy:school-stage'),
        stage.school_stage,
        NULLIF(profile.properties_json ->> 'grade_band', ''),
        COALESCE(profile.curriculum_roles_json, '[]'::jsonb),
        COALESCE(profile.source_refs_json, '[]'::jsonb),
        CASE
          WHEN COALESCE(profile.properties_json -> 'pedagogical_profiles_by_stage' -> stage.school_stage,
                        profile.properties_json -> 'pedagogical_profile') IS NULL
            THEN '{}'::jsonb
          ELSE jsonb_build_object(
            'pedagogical_profile',
            COALESCE(profile.properties_json -> 'pedagogical_profiles_by_stage' -> stage.school_stage,
                     profile.properties_json -> 'pedagogical_profile')
          )
        END,
        profile.status,
        profile.created_at,
        profile.updated_at,
        concat_ws(E'\n', NULLIF(profile.notes, ''), '由 world-v1.2 暂存领域画像中的教学字段迁移。')
      FROM world_staging_domain_profiles AS profile
      CROSS JOIN LATERAL (
        SELECT DISTINCT value AS school_stage
        FROM (
          SELECT jsonb_array_elements_text(COALESCE(profile.school_stages_json, '[]'::jsonb)) AS value
          UNION ALL
          SELECT jsonb_object_keys(COALESCE(profile.properties_json -> 'pedagogical_profiles_by_stage', '{}'::jsonb)) AS value
        ) AS stages
        WHERE value IN ('primary', 'junior-secondary', 'senior-secondary', 'higher')
      ) AS stage
      ON CONFLICT (dataset_id, lesson_run_id, raw_projection_id) DO UPDATE SET
        curriculum_roles_json = EXCLUDED.curriculum_roles_json,
        source_refs_json = EXCLUDED.source_refs_json,
        properties_json = EXCLUDED.properties_json,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at
    $migration$;

    UPDATE world_staging_domain_profiles
    SET properties_json = properties_json
      - 'schema_id'
      - 'schema_version'
      - 'domain_role'
      - 'school_stage'
      - 'school_stages'
      - 'curriculum_roles'
      - 'curriculum_id'
      - 'grade_band'
      - 'pedagogical_profile'
      - 'pedagogical_profiles_by_stage';

    ALTER TABLE world_staging_domain_profiles
      DROP COLUMN school_stages_json,
      DROP COLUMN curriculum_roles_json;
  END IF;
END $$;

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

-------------------------------------------------------------------
-- governed interdisciplinary discovery
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_interdisciplinary_runs (
  dataset_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  domains_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'blocked')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  notes TEXT,
  PRIMARY KEY (dataset_id, run_id),
  CHECK (jsonb_typeof(domains_json) = 'array'),
  CHECK (jsonb_typeof(config_json) = 'object'),
  CHECK (jsonb_typeof(stats_json) = 'object'),
  FOREIGN KEY (dataset_id) REFERENCES world_datasets(dataset_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_interdisciplinary_runs_created
ON world_interdisciplinary_runs(dataset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS world_interdisciplinary_candidates (
  dataset_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  candidate_kind TEXT NOT NULL CHECK (candidate_kind IN ('node_alignment', 'relation', 'bridge_path')),
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  bridge_node_id TEXT,
  proposed_edge_type TEXT CHECK (
    proposed_edge_type IS NULL OR proposed_edge_type IN (
      'is_a', 'instance_of', 'part_of', 'contains', 'has_property',
      'uses', 'produces', 'depends_on', 'prerequisite_for', 'causes',
      'affects', 'represents', 'formalizes', 'applies_to', 'analogous_to',
      'models', 'about', 'related_to'
    )
  ),
  directionality TEXT CHECK (directionality IS NULL OR directionality IN ('directed', 'undirected')),
  proposed_path_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source_domains_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_domains_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  reviewer TEXT,
  review_notes TEXT,
  reviewed_at TEXT,
  applied_edge_id TEXT,
  applied_edge_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, candidate_id),
  CHECK (from_node_id <> to_node_id),
  CHECK (jsonb_typeof(source_domains_json) = 'array'),
  CHECK (jsonb_typeof(target_domains_json) = 'array'),
  CHECK (jsonb_typeof(evidence_refs_json) = 'array'),
  CHECK (jsonb_typeof(rationale_json) = 'object'),
  CHECK (jsonb_typeof(proposed_path_json) = 'array'),
  CHECK (jsonb_typeof(applied_edge_ids_json) = 'array'),
  CHECK (
    (candidate_kind = 'node_alignment' AND proposed_edge_type IS NULL AND directionality IS NULL AND bridge_node_id IS NULL)
    OR (candidate_kind = 'relation' AND proposed_edge_type IS NOT NULL AND directionality IS NOT NULL AND bridge_node_id IS NULL)
    OR (
      candidate_kind = 'bridge_path'
      AND proposed_edge_type IS NULL
      AND directionality IS NULL
      AND bridge_node_id IS NOT NULL
      AND jsonb_array_length(proposed_path_json) = 2
    )
  ),
  CHECK (status = 'pending' OR reviewed_at IS NOT NULL),
  CHECK (
    status NOT IN ('approved', 'applied')
    OR candidate_kind NOT IN ('relation', 'bridge_path')
    OR CASE
      WHEN jsonb_typeof(evidence_refs_json) = 'array' THEN jsonb_array_length(evidence_refs_json) > 0
      ELSE FALSE
    END
  ),
  CHECK (
    status != 'applied'
    OR candidate_kind = 'node_alignment'
    OR (candidate_kind = 'relation' AND applied_edge_id IS NOT NULL)
    OR (candidate_kind = 'bridge_path' AND jsonb_array_length(applied_edge_ids_json) = 2)
  ),
  FOREIGN KEY (dataset_id, run_id) REFERENCES world_interdisciplinary_runs(dataset_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id, from_node_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id, to_node_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id, bridge_node_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE
);

ALTER TABLE world_interdisciplinary_candidates
  ADD COLUMN IF NOT EXISTS bridge_node_id TEXT,
  ADD COLUMN IF NOT EXISTS proposed_path_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS applied_edge_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Replace every anonymous world-v1.2 candidate check with named world-v1.3
-- checks. This keeps repeated schema application deterministic.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'world_interdisciplinary_candidates'::regclass
      AND contype = 'c'
  LOOP
    EXECUTE format(
      'ALTER TABLE world_interdisciplinary_candidates DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END $$;

ALTER TABLE world_interdisciplinary_candidates
  ADD CONSTRAINT world_interdisciplinary_candidate_kind_check
    CHECK (candidate_kind IN ('node_alignment', 'relation', 'bridge_path')),
  ADD CONSTRAINT world_interdisciplinary_candidate_edge_type_check
    CHECK (
      proposed_edge_type IS NULL OR proposed_edge_type IN (
        'is_a', 'instance_of', 'part_of', 'contains', 'has_property',
        'uses', 'produces', 'depends_on', 'prerequisite_for', 'causes',
        'affects', 'represents', 'formalizes', 'applies_to', 'analogous_to',
        'models', 'about', 'related_to'
      )
    ),
  ADD CONSTRAINT world_interdisciplinary_candidate_directionality_check
    CHECK (directionality IS NULL OR directionality IN ('directed', 'undirected')),
  ADD CONSTRAINT world_interdisciplinary_candidate_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1),
  ADD CONSTRAINT world_interdisciplinary_candidate_nodes_check
    CHECK (from_node_id <> to_node_id AND bridge_node_id IS DISTINCT FROM from_node_id AND bridge_node_id IS DISTINCT FROM to_node_id),
  ADD CONSTRAINT world_interdisciplinary_candidate_json_check
    CHECK (
      jsonb_typeof(source_domains_json) = 'array'
      AND jsonb_typeof(target_domains_json) = 'array'
      AND jsonb_typeof(evidence_refs_json) = 'array'
      AND jsonb_typeof(rationale_json) = 'object'
      AND jsonb_typeof(proposed_path_json) = 'array'
      AND jsonb_typeof(applied_edge_ids_json) = 'array'
    ),
  ADD CONSTRAINT world_interdisciplinary_candidate_shape_check
    CHECK (
      (candidate_kind = 'node_alignment' AND proposed_edge_type IS NULL AND directionality IS NULL AND bridge_node_id IS NULL)
      OR (candidate_kind = 'relation' AND proposed_edge_type IS NOT NULL AND directionality IS NOT NULL AND bridge_node_id IS NULL)
      OR (
        candidate_kind = 'bridge_path'
        AND proposed_edge_type IS NULL
        AND directionality IS NULL
        AND bridge_node_id IS NOT NULL
        AND jsonb_array_length(proposed_path_json) = 2
      )
    ),
  ADD CONSTRAINT world_interdisciplinary_candidate_review_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'applied') AND (status = 'pending' OR reviewed_at IS NOT NULL)),
  ADD CONSTRAINT world_interdisciplinary_candidate_evidence_check
    CHECK (
      status NOT IN ('approved', 'applied')
      OR candidate_kind NOT IN ('relation', 'bridge_path')
      OR jsonb_array_length(evidence_refs_json) > 0
    ),
  ADD CONSTRAINT world_interdisciplinary_candidate_application_check
    CHECK (
      status != 'applied'
      OR candidate_kind = 'node_alignment'
      OR (candidate_kind = 'relation' AND applied_edge_id IS NOT NULL)
      OR (candidate_kind = 'bridge_path' AND jsonb_array_length(applied_edge_ids_json) = 2)
    );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'world_interdisciplinary_candidates'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE '%bridge_node_id%'
  ) THEN
    ALTER TABLE world_interdisciplinary_candidates
      ADD CONSTRAINT world_interdisciplinary_bridge_node_fkey
      FOREIGN KEY (dataset_id, bridge_node_id)
      REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_world_interdisciplinary_candidates_status
ON world_interdisciplinary_candidates(dataset_id, status, candidate_kind, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_world_interdisciplinary_candidates_nodes
ON world_interdisciplinary_candidates(dataset_id, from_node_id, to_node_id);

CREATE INDEX IF NOT EXISTS idx_world_interdisciplinary_candidates_bridge
ON world_interdisciplinary_candidates(dataset_id, bridge_node_id)
WHERE bridge_node_id IS NOT NULL;

-------------------------------------------------------------------
-- Derived cross-domain relation view; canonical edges remain in world_edges.
-------------------------------------------------------------------
CREATE OR REPLACE VIEW world_cross_domain_edges AS
SELECT DISTINCT edge.*
FROM world_edges AS edge
JOIN world_domain_profiles AS source_profile
  ON source_profile.dataset_id = edge.dataset_id
 AND source_profile.node_id = edge.from_id
 AND source_profile.status <> 'deprecated'
JOIN world_domain_profiles AS target_profile
  ON target_profile.dataset_id = edge.dataset_id
 AND target_profile.node_id = edge.to_id
 AND target_profile.status <> 'deprecated'
WHERE edge.status <> 'deprecated'
  AND source_profile.domain <> target_profile.domain;
