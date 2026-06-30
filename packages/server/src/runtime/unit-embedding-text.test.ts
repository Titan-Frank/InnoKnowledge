import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiUnit } from '@okm/types';
import { composeApiUnitEmbeddingText, hashApiUnitEmbeddingText } from './unit-embedding-text.js';

test('composeApiUnitEmbeddingText includes definition, card, body, and evidence', () => {
  const unit = {
    node: {
      name: '光子',
      kind: 'concept',
      definition: '空间传播的光能量的最小不连续单元。',
      aliases: ['光量子'],
      domains: ['physics'],
      properties: { semantic_core: { core_claims: ['光具有粒子性'] } },
    },
    card: {
      title: '光子',
      summary: '光子的知识卡片摘要',
      sections: [{ title: '定义', content: '每一份光能量称为一个光子。' }],
    },
    body: { content: '光子体现了光的粒子性。' },
    evidence: [{ id: 'e1', locator: 'p.1', excerpt: '爱因斯坦指出光能量是不连续的。' }],
  } as unknown as ApiUnit;

  const text = composeApiUnitEmbeddingText(unit);
  assert.match(text, /空间传播的光能量/);
  assert.match(text, /光子的知识卡片摘要/);
  assert.match(text, /光子体现了光的粒子性/);
  assert.match(text, /evidence_id: e1/);
  assert.equal(hashApiUnitEmbeddingText(text), hashApiUnitEmbeddingText(text));
});
