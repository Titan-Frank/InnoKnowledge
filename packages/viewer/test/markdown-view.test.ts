import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownView } from '../src/components/MarkdownView.tsx';

test('keeps a citation after a one-line display formula outside the formula block', () => {
  const evidenceId = 'evidence:auto-2e56bc0e60ad';
  const html = renderToStaticMarkup(createElement(MarkdownView, {
    content: `## 公式表达\n$$\\Phi = B S$$ \`[${evidenceId}]\`\n\n## 适用条件\n磁场必须为匀强磁场。`,
    renderEvidenceRef: (id) => createElement('span', { key: id, 'data-evidence-id': id }, '[证据]'),
  }));

  assert.match(html, /<h4[^>]*>公式表达<\/h4>/);
  assert.match(html, new RegExp(`data-evidence-id=\"${evidenceId}\"`));
  assert.match(html, /<h4[^>]*>适用条件<\/h4>/);
  assert.equal(html.includes('$$'), false);
  assert.equal(html.includes('`[evidence:'), false);
});

test('keeps a citation after a multi-line display formula outside the formula block', () => {
  const evidenceId = 'evidence:auto-10b1cd9c87dd';
  const html = renderToStaticMarkup(createElement(MarkdownView, {
    content: `$$\n1 \\mathrm{Wb} = 1 \\mathrm{T}\\cdot\\mathrm{m}^{2}\n$$ [${evidenceId}]\n\n后续正文。`,
    renderEvidenceRef: (id) => createElement('span', { key: id, 'data-evidence-id': id }, '[证据]'),
  }));

  assert.match(html, new RegExp(`data-evidence-id=\"${evidenceId}\"`));
  assert.match(html, /后续正文。/);
  assert.equal(html.includes('$$'), false);
});
