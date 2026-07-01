import { createHash } from 'node:crypto';
import type { ApiEvidence, ApiNodeCard, ApiUnit } from '@okm/types';

const MAX_BODY_CHARS = 5000;
const MAX_EVIDENCE_ITEMS = 12;
const MAX_EVIDENCE_CHARS = 900;
const MAX_SECTION_CHARS = 1200;

export function composeApiUnitEmbeddingText(unit: ApiUnit): string {
  const node = unit.node;
  const parts: string[] = [
    `name: ${node.name}`,
    `kind: ${node.kind}`,
    node.definition ? `definition: ${node.definition}` : '',
    arrayText('aliases', node.aliases),
    arrayText('domains', node.domains),
    semanticCoreText(node.properties?.semantic_core),
    cardText(unit.card),
    unit.body?.content ? `body:\n${truncate(unit.body.content, MAX_BODY_CHARS)}` : '',
    evidenceText(unit.evidence),
  ];

  return normalizeWhitespace(parts.filter(Boolean).join('\n\n'));
}

export function hashApiUnitEmbeddingText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function cardText(card: ApiNodeCard | null): string {
  if (!card) return '';
  const sections = Array.isArray(card.sections)
    ? card.sections
      .slice(0, 8)
      .map((section) => [
        section.title ? `section: ${section.title}` : '',
        truncate(stringifyContent(section.content), MAX_SECTION_CHARS),
      ].filter(Boolean).join('\n'))
      .filter(Boolean)
      .join('\n')
    : '';
  return [
    card.title ? `card_title: ${card.title}` : '',
    card.summary ? `card_summary: ${card.summary}` : '',
    sections ? `card_sections:\n${sections}` : '',
  ].filter(Boolean).join('\n');
}

function evidenceText(evidence: ApiEvidence[]): string {
  const rows = evidence
    .slice(0, MAX_EVIDENCE_ITEMS)
    .map((item) => [
      `evidence_id: ${item.id}`,
      item.locator ? `locator: ${item.locator}` : '',
      item.excerpt ? truncate(item.excerpt, MAX_EVIDENCE_CHARS) : '',
    ].filter(Boolean).join('\n'))
    .filter(Boolean);
  return rows.length ? `evidence:\n${rows.join('\n')}` : '';
}

function semanticCoreText(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return `semantic_core: ${stringifyContent(value)}`;
}

function arrayText(label: string, values: unknown): string {
  if (!Array.isArray(values) || values.length === 0) return '';
  const text = values.map(String).map((item) => item.trim()).filter(Boolean).join('、');
  return text ? `${label}: ${text}` : '';
}

function stringifyContent(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxChars: number): string {
  const text = value.trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
