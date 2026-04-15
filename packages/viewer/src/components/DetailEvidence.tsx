import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { useGraphStore } from '../store/graphStore.js';
import { getVisibleEvidence } from '../graph/visibility.js';
import { ToneBadge } from './aiwc/index.js';
import {
  createDetailBodyTextStyle,
  createDetailEmptyCardStyle,
  createDetailSectionStyle,
  createDetailSectionTitleStyle,
  createDetailSubcardStyle,
} from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';

interface Props {
  node: GraphNode;
}

export function DetailEvidence({ node }: Props) {
  const t = useTokens();
  const state = useGraphStore.getState();
  const evidence = getVisibleEvidence(node, state);

  if (evidence.length === 0) {
    return (
      <div style={createDetailSectionStyle(t)}>
        <h3 style={createDetailSectionTitleStyle(t)}>证据</h3>
        <div style={createDetailEmptyCardStyle(t)}>
          <p style={createDetailBodyTextStyle(t)}>当前没有关联证据。</p>
          <p style={createDetailBodyTextStyle(t)}>这通常表示 mention 的 <code>source_refs</code> 还没有连到有效 evidence。</p>
        </div>
      </div>
    );
  }

  return (
    <div style={createDetailSectionStyle(t)}>
      <h3 style={createDetailSectionTitleStyle(t)}>证据</h3>
      <div style={listStyle}>
        {evidence.map((item) => {
          const itemAny = item as Record<string, unknown>;
          return (
            <div style={createDetailSubcardStyle(t)} key={item.id}>
              <h4 style={itemTitleStyle}>{item.id}</h4>
              <p style={createDetailBodyTextStyle(t)}>{String(itemAny.snippet || '')}</p>
              <div style={chipsStyle}>
                <ToneBadge tone="neutral">
                  {itemAny.page_start != null
                    ? `p.${itemAny.page_start}${itemAny.page_end !== itemAny.page_start ? `-${itemAny.page_end}` : ''}`
                    : String(itemAny.locator || '无页码')}
                </ToneBadge>
                <ToneBadge tone="neutral">{String(itemAny.book_id || item.source_id)}</ToneBadge>
                <ToneBadge tone="neutral">{item.anchor_ref}</ToneBadge>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const listStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const itemTitleStyle: CSSProperties = {
  margin: '0 0 6px',
  fontSize: '0.92rem',
  fontWeight: 600,
};

const chipsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};
