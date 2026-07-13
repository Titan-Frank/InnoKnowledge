-- Repository-safe populated demo for Open Knowledge Map.
-- All prose and relationships are self-authored for this repository.
-- Re-running this file replaces only dataset_id = 'demo'.

BEGIN;

DELETE FROM world_datasets WHERE dataset_id = 'demo';

INSERT INTO world_datasets (
  dataset_id, dataset_name, schema_version, status, is_active, root_path,
  created_at, updated_at, notes
) VALUES (
  'demo', 'Synthetic Home Solar Demo', 'world-v1.3', 'active', 0,
  'examples/demo-data', '2026-07-12T00:00:00.000Z',
  '2026-07-12T00:00:00.000Z',
  'Fully synthetic repository demo. Not derived from a textbook and not an evaluation benchmark.'
);

INSERT INTO world_source_artifacts (
  dataset_id, source_id, source_type, book_id, title, file_path, outline_path, properties_json
) VALUES (
  'demo', 'demo-home-solar', 'textbook', 'demo-home-solar',
  'Synthetic Home Solar Learning Module', 'examples/demo-data/source.md',
  'examples/demo-data/seed-demo.sql',
  '{"synthetic":true,"source_origin":"repository_authored_demo","rights_status":"self_authored","not_a_real_textbook":true}'::jsonb
);

INSERT INTO world_textbook_outlines (
  dataset_id, book_id, title, source_path, outline_path, outline_json,
  item_count, chunk_count, created_at, updated_at
) VALUES (
  'demo', 'demo-home-solar', 'Synthetic Home Solar Learning Module',
  'examples/demo-data/source.md', 'examples/demo-data/seed-demo.sql',
  $outline$
  {
    "source_path": "examples/demo-data/source.md",
    "items": [
      {"id":"struct:demo-home-solar:theme:1","kind":"theme","label":"Module 1","level":1,"title":"Home solar energy","order_path":"1","md_start":1,"md_end":36},
      {"id":"struct:demo-home-solar:lesson:1","kind":"lesson","label":"Lesson 1","level":2,"title":"Energy path","parent_id":"struct:demo-home-solar:theme:1","order_path":"1.1","md_start":5,"md_end":20},
      {"id":"struct:demo-home-solar:chunk:1-1","kind":"chunk","label":"1.1","level":3,"title":"Sunlight resource","parent_id":"struct:demo-home-solar:lesson:1","order_path":"1.1.1","md_start":7,"md_end":8},
      {"id":"struct:demo-home-solar:chunk:1-2","kind":"chunk","label":"1.2","level":3,"title":"Solar panel","parent_id":"struct:demo-home-solar:lesson:1","order_path":"1.1.2","md_start":10,"md_end":11},
      {"id":"struct:demo-home-solar:chunk:1-3","kind":"chunk","label":"1.3","level":3,"title":"Photovoltaic conversion","parent_id":"struct:demo-home-solar:lesson:1","order_path":"1.1.3","md_start":13,"md_end":14},
      {"id":"struct:demo-home-solar:chunk:1-4","kind":"chunk","label":"1.4","level":3,"title":"Electrical energy","parent_id":"struct:demo-home-solar:lesson:1","order_path":"1.1.4","md_start":16,"md_end":17},
      {"id":"struct:demo-home-solar:chunk:1-5","kind":"chunk","label":"1.5","level":3,"title":"Energy-flow diagram","parent_id":"struct:demo-home-solar:lesson:1","order_path":"1.1.5","md_start":19,"md_end":20},
      {"id":"struct:demo-home-solar:lesson:2","kind":"lesson","label":"Lesson 2","level":2,"title":"Conditions and estimation","parent_id":"struct:demo-home-solar:theme:1","order_path":"1.2","md_start":22,"md_end":34},
      {"id":"struct:demo-home-solar:chunk:2-1","kind":"chunk","label":"2.1","level":3,"title":"Rated power","parent_id":"struct:demo-home-solar:lesson:2","order_path":"1.2.1","md_start":24,"md_end":25},
      {"id":"struct:demo-home-solar:chunk:2-2","kind":"chunk","label":"2.2","level":3,"title":"Low-sunlight period","parent_id":"struct:demo-home-solar:lesson:2","order_path":"1.2.2","md_start":27,"md_end":28},
      {"id":"struct:demo-home-solar:chunk:2-3","kind":"chunk","label":"2.3","level":3,"title":"Daily energy estimation","parent_id":"struct:demo-home-solar:lesson:2","order_path":"1.2.3","md_start":30,"md_end":31},
      {"id":"struct:demo-home-solar:chunk:2-4","kind":"chunk","label":"2.4","level":3,"title":"Energy-balance rule","parent_id":"struct:demo-home-solar:lesson:2","order_path":"1.2.4","md_start":33,"md_end":34}
    ]
  }
  $outline$::jsonb,
  12, 9, '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z'
);

INSERT INTO world_nodes (
  dataset_id, id, name, kind, subkind, definition, aliases_json, domains_json,
  knowledge_form_json, learning_mode_json, scope, properties_json,
  external_ids_json, tags_json, status, created_at, updated_at, notes
) VALUES
  ('demo','resource/sunlight:demo','Sunlight','resource','energy-source','Radiant energy from the Sun that is available as an input to a solar-energy system.','["solar radiation"]','["physics"]','["propositional"]','["conceptual"]','universal','{"synthetic":true,"source_origin":"repository_authored_demo","node_layer":"domain","bridge_role":"semantic_bridge"}','{}','["demo","home-solar"]','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z','Illustrative definition; not engineering advice.'),
  ('demo','entity/solar-panel:demo','Solar panel','entity','energy-device','A device that receives sunlight and produces electrical energy through photovoltaic conversion.','["photovoltaic panel"]','["physics"]','["propositional"]','["conceptual"]','domain-specific','{"synthetic":true,"source_origin":"repository_authored_demo","node_layer":"domain"}','{}','["demo","home-solar"]','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z','Illustrative definition; not engineering advice.'),
  ('demo','process/photovoltaic-conversion:demo','Photovoltaic conversion','process','energy-conversion','A process that changes part of incoming radiant energy into electrical energy.','["photovoltaic effect"]','["physics"]','["practical"]','["conceptual"]','domain-specific','{"synthetic":true,"source_origin":"repository_authored_demo","node_layer":"domain"}','{}','["demo","home-solar"]','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z','Simplified for demonstration.'),
  ('demo','concept/electrical-energy:demo','Electrical energy','concept','energy-form','Transferable energy associated with electric charge moving through a circuit.','["electric energy"]','["physics"]','["propositional"]','["conceptual"]','universal','{"synthetic":true,"source_origin":"repository_authored_demo","node_layer":"domain","bridge_role":"semantic_bridge"}','{}','["demo","home-solar"]','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z','Simplified for demonstration.'),
  ('demo','representation/energy-flow-diagram:demo','Energy-flow diagram','representation','diagram','A diagram that shows energy inputs, conversions, outputs, and losses with labeled connections.','["energy flow chart"]','["physics"]','["propositional"]','["conceptual"]','domain-specific','{"synthetic":true,"source_origin":"repository_authored_demo","node_layer":"domain"}','{}','["demo","home-solar"]','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z','Illustrative representation.'),
  ('demo','property/rated-power:demo','Rated power','property','device-rating','The output power assigned to a device under specified reference conditions.','["nameplate power"]','["physics"]','["propositional"]','["conceptual"]','domain-specific','{"synthetic":true,"source_origin":"repository_authored_demo","node_layer":"domain"}','{}','["demo","home-solar"]','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z','Not a measured rating for any real device.'),
  ('demo','event/low-sunlight-period:demo','Low-sunlight period','event','operating-condition','A time interval in which less radiant energy reaches a solar panel than under the chosen reference condition.','["reduced irradiance period"]','["physics"]','["propositional"]','["conceptual"]','domain-specific','{"synthetic":true,"source_origin":"repository_authored_demo","node_layer":"domain"}','{}','["demo","home-solar"]','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z','Illustrative operating condition.'),
  ('demo','method/daily-energy-estimation:demo','Daily energy estimation','method','calculation-method','A method that estimates daily energy from a suitable power estimate, operating time, and changing conditions.','["daily yield estimate"]','["physics"]','["practical"]','["procedural"]','domain-specific','{"synthetic":true,"source_origin":"repository_authored_demo","node_layer":"domain","bridge_role":"method_bridge"}','{}','["demo","home-solar"]','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z','Illustrative method; not a system-sizing procedure.'),
  ('demo','rule/energy-balance:demo','Energy-balance rule','rule','conservation-rule','A rule that separates input energy, useful output energy, and conversion losses in an estimate.','["energy accounting rule"]','["physics"]','["propositional","practical"]','["conceptual","procedural"]','universal','{"synthetic":true,"source_origin":"repository_authored_demo","node_layer":"domain","bridge_role":"semantic_bridge"}','{}','["demo","home-solar"]','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z','Simplified for demonstration.');

INSERT INTO world_node_terms (dataset_id, node_id, term, term_norm, term_type)
SELECT dataset_id, id, name, lower(name), 'canonical'
FROM world_nodes
WHERE dataset_id = 'demo';

UPDATE world_nodes
SET properties_json = jsonb_set(
  properties_json,
  '{semantic_core}',
  jsonb_build_object('core_claims', jsonb_build_array(definition))
)
WHERE dataset_id = 'demo';

INSERT INTO world_evidence (
  dataset_id, id, source_type, source_id, anchor_ref, source_path,
  page_start, page_end, excerpt, locator, modality, extraction_method,
  normalized_claims_json, properties_json, created_at, updated_at
) VALUES
  ('demo','evidence/sunlight:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:1-1','examples/demo-data/source.md',NULL,NULL,'Sunlight carries radiant energy that can reach a solar panel without being produced by the panel itself.','line:8','text','manual','["Sunlight carries radiant energy that can reach a solar panel without being produced by the panel itself."]','{"synthetic":true,"quality_excluded":true,"source_origin":"repository_authored_demo","rights_status":"self_authored"}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','evidence/solar-panel:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:1-2','examples/demo-data/source.md',NULL,NULL,'A solar panel receives sunlight and provides electrical energy at its output when operating conditions allow conversion.','line:11','text','manual','["A solar panel receives sunlight and provides electrical energy at its output when operating conditions allow conversion."]','{"synthetic":true,"quality_excluded":true,"source_origin":"repository_authored_demo","rights_status":"self_authored"}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','evidence/photovoltaic-conversion:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:1-3','examples/demo-data/source.md',NULL,NULL,'Photovoltaic conversion changes part of the incoming radiant energy into electrical energy inside a solar panel.','line:14','text','manual','["Photovoltaic conversion changes part of the incoming radiant energy into electrical energy inside a solar panel."]','{"synthetic":true,"quality_excluded":true,"source_origin":"repository_authored_demo","rights_status":"self_authored"}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','evidence/electrical-energy:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:1-4','examples/demo-data/source.md',NULL,NULL,'Electrical energy is the transferable energy carried by electric charge through a circuit.','line:17','text','manual','["Electrical energy is the transferable energy carried by electric charge through a circuit."]','{"synthetic":true,"quality_excluded":true,"source_origin":"repository_authored_demo","rights_status":"self_authored"}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','evidence/energy-flow-diagram:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:1-5','examples/demo-data/source.md',NULL,NULL,'An energy-flow diagram represents sunlight entering a panel, conversion inside it, and electrical energy leaving it.','line:20','text','manual','["An energy-flow diagram represents sunlight entering a panel, conversion inside it, and electrical energy leaving it."]','{"synthetic":true,"quality_excluded":true,"source_origin":"repository_authored_demo","rights_status":"self_authored"}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','evidence/rated-power:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:2-1','examples/demo-data/source.md',NULL,NULL,'Rated power states the electrical output power assigned to a device under specified reference conditions.','line:25','text','manual','["Rated power states the electrical output power assigned to a device under specified reference conditions."]','{"synthetic":true,"quality_excluded":true,"source_origin":"repository_authored_demo","rights_status":"self_authored"}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','evidence/low-sunlight-period:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:2-2','examples/demo-data/source.md',NULL,NULL,'A low-sunlight period reduces the radiant input available for photovoltaic conversion and can lower electrical output.','line:28','text','manual','["A low-sunlight period reduces the radiant input available for photovoltaic conversion and can lower electrical output."]','{"synthetic":true,"quality_excluded":true,"source_origin":"repository_authored_demo","rights_status":"self_authored"}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','evidence/daily-energy-estimation:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:2-3','examples/demo-data/source.md',NULL,NULL,'Daily energy estimation multiplies an appropriate power estimate by operating time while accounting for changing conditions.','line:31','text','manual','["Daily energy estimation multiplies an appropriate power estimate by operating time while accounting for changing conditions."]','{"synthetic":true,"quality_excluded":true,"source_origin":"repository_authored_demo","rights_status":"self_authored"}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','evidence/energy-balance:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:2-4','examples/demo-data/source.md',NULL,NULL,'An energy-balance rule requires every estimate to distinguish input energy, useful output energy, and conversion losses.','line:34','text','manual','["An energy-balance rule requires every estimate to distinguish input energy, useful output energy, and conversion losses."]','{"synthetic":true,"quality_excluded":true,"source_origin":"repository_authored_demo","rights_status":"self_authored"}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z');

INSERT INTO world_edges (
  dataset_id, id, type, from_id, to_id, directionality, confidence,
  source_refs_json, properties_json, status, created_at, updated_at, notes
) VALUES
  ('demo','edge/panel-uses-sunlight:demo','uses','entity/solar-panel:demo','resource/sunlight:demo','directed',1.0,'["evidence/solar-panel:demo"]','{"synthetic":true}','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z',NULL),
  ('demo','edge/panel-uses-conversion:demo','uses','entity/solar-panel:demo','process/photovoltaic-conversion:demo','directed',1.0,'["evidence/photovoltaic-conversion:demo"]','{"synthetic":true}','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z',NULL),
  ('demo','edge/conversion-produces-energy:demo','produces','process/photovoltaic-conversion:demo','concept/electrical-energy:demo','directed',1.0,'["evidence/photovoltaic-conversion:demo"]','{"synthetic":true}','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z',NULL),
  ('demo','edge/panel-produces-energy:demo','produces','entity/solar-panel:demo','concept/electrical-energy:demo','directed',1.0,'["evidence/solar-panel:demo"]','{"synthetic":true}','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z',NULL),
  ('demo','edge/panel-has-rated-power:demo','has_property','entity/solar-panel:demo','property/rated-power:demo','directed',1.0,'["evidence/rated-power:demo"]','{"synthetic":true}','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z',NULL),
  ('demo','edge/low-sunlight-affects-conversion:demo','affects','event/low-sunlight-period:demo','process/photovoltaic-conversion:demo','directed',1.0,'["evidence/low-sunlight-period:demo"]','{"synthetic":true}','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z',NULL),
  ('demo','edge/estimate-uses-power:demo','uses','method/daily-energy-estimation:demo','property/rated-power:demo','directed',1.0,'["evidence/daily-energy-estimation:demo"]','{"synthetic":true}','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z',NULL),
  ('demo','edge/estimate-depends-balance:demo','depends_on','method/daily-energy-estimation:demo','rule/energy-balance:demo','directed',1.0,'["evidence/energy-balance:demo"]','{"synthetic":true}','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z',NULL),
  ('demo','edge/balance-about-energy:demo','about','rule/energy-balance:demo','concept/electrical-energy:demo','directed',1.0,'["evidence/energy-balance:demo"]','{"synthetic":true}','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z',NULL),
  ('demo','edge/diagram-represents-conversion:demo','represents','representation/energy-flow-diagram:demo','process/photovoltaic-conversion:demo','directed',1.0,'["evidence/energy-flow-diagram:demo"]','{"synthetic":true}','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z',NULL),
  ('demo','edge/diagram-about-energy:demo','about','representation/energy-flow-diagram:demo','concept/electrical-energy:demo','directed',1.0,'["evidence/energy-flow-diagram:demo"]','{"synthetic":true}','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z',NULL),
  ('demo','edge/rated-power-related-energy:demo','related_to','property/rated-power:demo','concept/electrical-energy:demo','undirected',1.0,'["evidence/rated-power:demo"]','{"synthetic":true}','active','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z',NULL);

INSERT INTO world_mentions (
  dataset_id, id, source_type, source_id, anchor_ref, target_type, target_id,
  role, source_refs_json, confidence, properties_json, created_at, updated_at
) VALUES
  ('demo','mention/sunlight:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:1-1','node','resource/sunlight:demo','defines','["evidence/sunlight:demo"]',1.0,'{"synthetic":true}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','mention/solar-panel:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:1-2','node','entity/solar-panel:demo','defines','["evidence/solar-panel:demo"]',1.0,'{"synthetic":true}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','mention/photovoltaic-conversion:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:1-3','node','process/photovoltaic-conversion:demo','defines','["evidence/photovoltaic-conversion:demo"]',1.0,'{"synthetic":true}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','mention/electrical-energy:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:1-4','node','concept/electrical-energy:demo','defines','["evidence/electrical-energy:demo"]',1.0,'{"synthetic":true}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','mention/energy-flow-diagram:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:1-5','node','representation/energy-flow-diagram:demo','defines','["evidence/energy-flow-diagram:demo"]',1.0,'{"synthetic":true}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','mention/rated-power:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:2-1','node','property/rated-power:demo','defines','["evidence/rated-power:demo"]',1.0,'{"synthetic":true}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','mention/low-sunlight-period:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:2-2','node','event/low-sunlight-period:demo','defines','["evidence/low-sunlight-period:demo"]',1.0,'{"synthetic":true}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','mention/daily-energy-estimation:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:2-3','node','method/daily-energy-estimation:demo','defines','["evidence/daily-energy-estimation:demo"]',1.0,'{"synthetic":true}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z'),
  ('demo','mention/energy-balance:demo','textbook','demo-home-solar','struct:demo-home-solar:chunk:2-4','node','rule/energy-balance:demo','defines','["evidence/energy-balance:demo"]',1.0,'{"synthetic":true}','2026-07-12T00:00:00.000Z','2026-07-12T00:00:00.000Z');

INSERT INTO world_domain_profiles (
  dataset_id, id, node_id, domain, schema_id, schema_version, domain_role,
  source_refs_json, properties_json, status, created_at, updated_at, notes
)
SELECT
  'demo', 'profile/' || split_part(n.id, ':', 1) || ':demo', n.id, 'physics',
  'domain:physics:v1', '1.0',
  CASE n.kind
    WHEN 'resource' THEN 'physical_quantity'
    WHEN 'entity' THEN 'model'
    WHEN 'process' THEN 'phenomenon'
    WHEN 'concept' THEN 'principle'
    WHEN 'representation' THEN 'model'
    WHEN 'property' THEN 'physical_quantity'
    WHEN 'event' THEN 'phenomenon'
    WHEN 'method' THEN 'measurement_method'
    WHEN 'rule' THEN 'law'
    ELSE 'principle'
  END,
  jsonb_build_array(e.id),
  '{"synthetic":true,"subject":"physics"}'::jsonb,
  'active', '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z',
  'Illustrative semantic Domain Profile.'
FROM world_nodes n
JOIN world_mentions m ON m.dataset_id = n.dataset_id AND m.target_type = 'node' AND m.target_id = n.id
JOIN world_evidence e ON e.dataset_id = m.dataset_id AND e.id = m.source_refs_json->>0
WHERE n.dataset_id = 'demo';

INSERT INTO world_curriculum_projections (
  dataset_id, id, node_id, domain, curriculum_id, school_stage, grade_band,
  curriculum_roles_json, source_refs_json, properties_json, status,
  created_at, updated_at, notes
)
SELECT
  'demo', 'curriculum/' || split_part(n.id, ':', 1) || ':demo', n.id, 'physics',
  'demo:home-solar', 'higher', NULL, '["core"]'::jsonb,
  jsonb_build_array(e.id),
  jsonb_build_object(
    'synthetic', true,
    'pedagogical_profile', jsonb_build_object(
      'school_stage', 'higher',
      'learning_objectives', jsonb_build_array('Explain the object in a simplified home-solar energy path.'),
      'difficulty_level', 'introductory',
      'diagnostic_questions', jsonb_build_array('What role does this object play in the energy path?'),
      'common_errors', jsonb_build_array('Treating the simplified demo as a complete engineering model.'),
      'assessment_tasks', jsonb_build_array('Connect the object to its supported relation and cite the source statement.'),
      'remediation_suggestions', jsonb_build_array('Return to the definition and synthetic source statement.'),
      'extension_suggestions', jsonb_build_array('Compare this role with another energy-conversion context.'),
      'generation', jsonb_build_object(
        'generated_from', 'manual',
        'review_status', 'approved',
        'source_refs', jsonb_build_array(e.id)
      )
    )
  ),
  'active', '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z',
  'Illustrative curriculum projection; not aligned to an official curriculum.'
FROM world_nodes n
JOIN world_mentions m ON m.dataset_id = n.dataset_id AND m.target_type = 'node' AND m.target_id = n.id
JOIN world_evidence e ON e.dataset_id = m.dataset_id AND e.id = m.source_refs_json->>0
WHERE n.dataset_id = 'demo';

INSERT INTO world_node_cards (
  dataset_id, node_id, id, title, summary, source_refs_json, sections_json,
  properties_json, status, created_at, updated_at
)
SELECT
  n.dataset_id, n.id, 'node-card/' || split_part(n.id, ':', 1) || ':demo',
  n.name, n.definition, jsonb_build_array(e.id),
  jsonb_build_array(
    jsonb_build_object(
      'id','definition','title','Definition','section_type','definition',
      'content',jsonb_build_array(n.definition),'source_refs',jsonb_build_array(e.id),
      'properties',jsonb_build_object('synthetic',true)
    ),
    jsonb_build_object(
      'id','source-note','title','Source note','section_type','source_note',
      'content',jsonb_build_array(e.excerpt),'source_refs',jsonb_build_array(e.id),
      'properties',jsonb_build_object('synthetic',true)
    )
  ),
  '{"synthetic":true,"source_origin":"repository_authored_demo"}'::jsonb,
  'active', '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z'
FROM world_nodes n
JOIN world_mentions m ON m.dataset_id = n.dataset_id AND m.target_type = 'node' AND m.target_id = n.id
JOIN world_evidence e ON e.dataset_id = m.dataset_id AND e.id = m.source_refs_json->>0
WHERE n.dataset_id = 'demo';

INSERT INTO world_node_bodies (
  dataset_id, node_id, format, content, media_refs_json, source_refs_json,
  generated_from, properties_json, status, created_at, updated_at
)
SELECT
  n.dataset_id, n.id, 'markdown',
  '# ' || n.name || E'\n\n' || n.definition || E'\n\n## Evidence\n\n' || e.excerpt,
  '[]'::jsonb, jsonb_build_array(e.id), 'manual',
  '{"synthetic":true,"source_origin":"repository_authored_demo"}'::jsonb,
  'active', '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z'
FROM world_nodes n
JOIN world_mentions m ON m.dataset_id = n.dataset_id AND m.target_type = 'node' AND m.target_id = n.id
JOIN world_evidence e ON e.dataset_id = m.dataset_id AND e.id = m.source_refs_json->>0
WHERE n.dataset_id = 'demo';

INSERT INTO world_evidence_links (dataset_id, owner_type, owner_id, evidence_id, ordinal)
SELECT dataset_id, 'mention', id, source_refs_json->>0, 1
FROM world_mentions WHERE dataset_id = 'demo'
UNION ALL
SELECT dataset_id, 'domain_profile', id, source_refs_json->>0, 1
FROM world_domain_profiles WHERE dataset_id = 'demo'
UNION ALL
SELECT dataset_id, 'curriculum_projection', id, source_refs_json->>0, 1
FROM world_curriculum_projections WHERE dataset_id = 'demo'
UNION ALL
SELECT dataset_id, 'node_card', id, source_refs_json->>0, 1
FROM world_node_cards WHERE dataset_id = 'demo'
UNION ALL
SELECT dataset_id, 'edge', id, source_refs_json->>0, 1
FROM world_edges WHERE dataset_id = 'demo';

INSERT INTO world_lesson_runs (
  dataset_id, lesson_run_id, book_id, batch_anchor, status,
  counts_json, properties_json, created_at, updated_at
) VALUES (
  'demo', 'lesson-run/home-solar:demo', 'demo-home-solar',
  'struct:demo-home-solar:theme:1', 'merged',
  '{"nodes":9,"edges":12,"evidence":9,"domain_profiles":9,"curriculum_projections":9,"mentions":9,"cards":9}'::jsonb,
  '{"synthetic":true,"direct_seed":true,"quality_review_required":false,"quality_warnings":["Synthetic direct seed: no extraction model, reducer, or independent quality review was run."]}'::jsonb,
  '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z'
);

COMMIT;

SELECT
  (SELECT count(*) FROM world_nodes WHERE dataset_id = 'demo') AS nodes,
  (SELECT count(*) FROM world_edges WHERE dataset_id = 'demo') AS edges,
  (SELECT count(*) FROM world_evidence WHERE dataset_id = 'demo') AS evidence,
  (SELECT count(*) FROM world_domain_profiles WHERE dataset_id = 'demo') AS domain_profiles,
  (SELECT count(*) FROM world_curriculum_projections WHERE dataset_id = 'demo') AS curriculum_projections,
  (SELECT count(*) FROM world_node_cards WHERE dataset_id = 'demo') AS cards,
  (SELECT count(*) FROM world_node_bodies WHERE dataset_id = 'demo') AS bodies;
