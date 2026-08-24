import assert from 'node:assert/strict';
import test from 'node:test';
import type { Sql } from './connection.js';
import { loadNodes } from './queries.js';

test('loadNodes uses embedding aliases internally without exposing them in bundle nodes', async () => {
  const sql = (() => Promise.resolve([{
    id: 'node:one',
    dataset_id: 'main',
    name: 'One',
    kind: 'concept',
    subkind: null,
    aliases_json: [],
    domains_json: [],
    knowledge_form_json: [],
    learning_mode_json: [],
    properties_json: {},
    external_ids_json: {},
    tags_json: [],
    embedding: '[1,0]',
    embedding_text: '[1,0]',
    status: 'active',
  }])) as unknown as Sql;

  const [node] = await loadNodes(sql, 'main');

  assert.equal(node.community_id, 0);
  assert.equal(Object.hasOwn(node, 'embedding'), false);
  assert.equal(Object.hasOwn(node, 'embedding_text'), false);
});
