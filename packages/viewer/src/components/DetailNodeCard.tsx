import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { useNodeCardLoader } from '../hooks/useNodeCardLoader.js';
import { useGraphStore } from '../store/graphStore.js';
import { NODE_LAYER_LABELS } from '../constants/index.js';
import { humanizeKey } from '../graph/layout.js';
import { ToneBadge } from './aiwc/index.js';
import type { ApiNodeCard } from '@okm/types';
import {
  createDetailBodyTextStyle,
  createDetailEmptyCardStyle,
  detailSectionHeaderStyle,
  createDetailSectionMetaStyle,
  createDetailSectionStyle,
  createDetailSectionTitleStyle,
  createDetailSubcardStyle,
} from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';

interface Props {
  node: GraphNode;
}

function normalizeNodeCard(card: ApiNodeCard, node: GraphNode): ApiNodeCard & { card_layer: string } {
  return {
    ...card,
    card_layer:
      card.card_layer ||
      (card as Record<string, unknown>).layer as string | undefined ||
      (card.properties as Record<string, unknown> | undefined)?.card_layer as string | undefined ||
      node?.node_layer ||
      'support',
  } as ApiNodeCard & { card_layer: string };
}

function normalizeCardContent(content: unknown): string[] {
  if (Array.isArray(content)) return content.map((item) => String(item));
  if (content == null) return [];
  if (typeof content === 'string' || typeof content === 'number' || typeof content === 'boolean') {
    return [String(content)];
  }
  if (typeof content === 'object') {
    return Object.entries(content as Record<string, unknown>).map(([key, value]) => `${humanizeKey(key)}: ${String(value)}`);
  }
  return [String(content)];
}

function getPatternHints(node: GraphNode): Record<string, unknown>[] {
  const state = useGraphStore.getState();
  const patternMap = state.data?.patternsByType || new Map();
  const keys = [
    node.node_type,
    node.node_kind,
    node.node_subkind,
    node.node_kind && node.node_subkind ? `${node.node_kind}/${node.node_subkind}` : null,
  ].filter(Boolean) as string[];
  const seen = new Set<string>();

  return keys.flatMap((key) => patternMap.get(key) || []).filter((pattern) => {
    if (seen.has(pattern.id as string)) return false;
    seen.add(pattern.id as string);
    return true;
  });
}

export function DetailNodeCard({ node }: Props) {
  const t = useTokens();
  const { card, loading } = useNodeCardLoader(node);

  if (loading) {
    return (
      <div style={createDetailSectionStyle(t)}>
        <div style={detailSectionHeaderStyle}>
          <h3 style={createDetailSectionTitleStyle(t)}>节点说明卡</h3>
          <span style={createDetailSectionMetaStyle(t)}>加载中</span>
        </div>
        <div style={createDetailEmptyCardStyle(t)}>
          <p style={createDetailBodyTextStyle(t)}>正在读取这个节点的说明卡...</p>
        </div>
      </div>
    );
  }

  if (!card) {
    const patternHints = getPatternHints(node);
    const statusText = `尚未生成 · ${NODE_LAYER_LABELS[node.node_layer] ?? humanizeKey(node.node_layer)}卡`;
    return (
      <div style={createDetailSectionStyle(t)}>
        <div style={detailSectionHeaderStyle}>
          <h3 style={createDetailSectionTitleStyle(t)}>节点说明卡</h3>
          <span style={createDetailSectionMetaStyle(t)}>{statusText}</span>
        </div>
        <div style={createDetailEmptyCardStyle(t)}>
          <p style={createDetailBodyTextStyle(t)}>当前还没有这个节点的 node card，可以用 <code>@node-expander</code> 为它生成详细说明。</p>
          <p style={createDetailBodyTextStyle(t)}>如果这是当前批次里的主干节点，建议在 QA 通过后把它纳入批量扩卡目标。</p>
        </div>
        {patternHints.map((pattern) => {
          const sections = pattern.sections as Array<Record<string, unknown>> | undefined;
          const required = (sections || [])
            .filter((section) => section.required)
            .map((section) => section.title)
            .join('、');
          return (
            <div style={createDetailSubcardStyle(t)} key={pattern.id as string}>
              <h4 style={sectionTitleStyle}>{pattern.title as string}</h4>
              <p style={createDetailBodyTextStyle(t)}>{pattern.summary as string}</p>
              <div style={chipsStyle}>
                <ToneBadge tone="neutral">{pattern.id as string}</ToneBadge>
                <ToneBadge tone="neutral">必备 section: {required}</ToneBadge>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const normalizedCard = normalizeNodeCard(card, node);
  const statusText = `${normalizedCard.status || 'draft'} · ${NODE_LAYER_LABELS[normalizedCard.card_layer] ?? humanizeKey(normalizedCard.card_layer)}卡`;
  const layerChip = `${NODE_LAYER_LABELS[normalizedCard.card_layer] ?? humanizeKey(normalizedCard.card_layer)}卡`;

  return (
    <div style={createDetailSectionStyle(t)}>
      <div style={detailSectionHeaderStyle}>
        <h3 style={createDetailSectionTitleStyle(t)}>节点说明卡</h3>
        <span style={createDetailSectionMetaStyle(t)}>{statusText}</span>
      </div>
      <div style={createDetailSubcardStyle(t)}>
        <h4 style={sectionTitleStyle}>概要</h4>
        <p style={createDetailBodyTextStyle(t)}>{normalizedCard.summary || '暂无概要。'}</p>
        <div style={chipsStyle}>
          <ToneBadge tone="neutral">{layerChip}</ToneBadge>
          {(normalizedCard.pattern_refs || []).map((ref) => (
            <ToneBadge key={ref} tone="neutral">{ref}</ToneBadge>
          ))}
        </div>
      </div>
      {(normalizedCard.sections || []).map((section, i) => (
        <div style={createDetailSubcardStyle(t)} key={i}>
          <h4 style={sectionTitleStyle}>{section.title}</h4>
          <ul style={listStyle(t)}>
            {normalizeCardContent(section.content).map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
          {section.source_refs?.length && (
            <div style={chipsStyle}>
              {section.source_refs.map((ref) => (
                <ToneBadge key={ref} tone="neutral">{ref}</ToneBadge>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const sectionTitleStyle: CSSProperties = {
  margin: '0 0 6px',
  fontSize: '0.92rem',
  fontWeight: 600,
};

const chipsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

function listStyle(t: ReturnType<typeof useTokens>): CSSProperties {
  return {
    margin: 0,
    paddingLeft: 18,
    color: createDetailBodyTextStyle(t).color,
    lineHeight: 1.65,
  };
}
