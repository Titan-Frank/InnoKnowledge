-- World Knowledge Schema V1.2 — PostgreSQL draft
-- Purpose: a minimal, domain-agnostic storage layer for unified world knowledge.
-- Design goal: simple enough for K12 now, extensible enough for broader world knowledge later.

-------------------------------------------------------------------
-- world_datasets
-------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_datasets (
  dataset_id TEXT PRIMARY KEY,
  dataset_name TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL DEFAULT 'world-v1.2',
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT
);

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
  scope TEXT CHECK (
    scope IN (
      'universal',
      'domain-specific',
      'culture-specific'
    )
  ),
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_ids_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
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
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'deprecated')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
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
