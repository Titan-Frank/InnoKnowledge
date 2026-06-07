-- World Knowledge Taxonomy + Domain Profile — PostgreSQL draft

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
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
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
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
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
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id, node_id) REFERENCES world_nodes(dataset_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_domain_profiles_node
ON world_domain_profiles(dataset_id, node_id);

CREATE INDEX IF NOT EXISTS idx_world_domain_profiles_domain
ON world_domain_profiles(dataset_id, domain);
