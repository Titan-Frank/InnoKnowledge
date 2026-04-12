import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { useGraphStore } from '../store/graphStore.js';
import { getVisibleEvidence } from '../graph/visibility.js';
import { ToneBadge, aiWebComponentTokens } from './aiwc/index.js';

interface Props {
  node: GraphNode;
}

export function DetailEvidence({ node }: Props) {
  const state = useGraphStore.getState();
  const evidence = getVisibleEvidence(node, state);

  if (evidence.length === 0) {
    return (
      <div style={blockStyle}>
        <h3 style={blockTitleStyle}>证据</h3>
        <div style={emptyStyle}>
          <p style={emptyTextStyle}>当前没有关联证据。</p>
          <p style={emptyTextStyle}>这通常表示 mention 的 <code>source_refs</code> 还没有连到有效 evidence。</p>
        </div>
      </div>
    );
  }

  return (
    <div style={blockStyle}>
      <h3 style={blockTitleStyle}>证据</h3>
      <div style={listStyle}>
        {evidence.map((item) => {
          const itemAny = item as Record<string, unknown>;
          return (
            <div style={itemStyle} key={item.id}>
              <h4 style={itemTitleStyle}>{item.id}</h4>
              <p style={itemDescStyle}>{String(itemAny.snippet || '')}</p>
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

const blockStyle: CSSProperties = {
  marginTop: 16,
};

const blockTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.06rem',
  fontWeight: 600,
};

const listStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  marginTop: 8,
};

const itemStyle: CSSProperties = {
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radiusSmall,
  background: aiWebComponentTokens.colorSurface,
  padding: 12,
};

const itemTitleStyle: CSSProperties = {
  margin: '0 0 6px',
  fontSize: '0.92rem',
  fontWeight: 600,
};

const itemDescStyle: CSSProperties = {
  margin: 0,
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.88rem',
  lineHeight: 1.6,
};

const chipsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 8,
};

const emptyStyle: CSSProperties = {
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radiusSmall,
  background: aiWebComponentTokens.colorSurfaceMuted,
  padding: 12,
  marginTop: 8,
};

const emptyTextStyle: CSSProperties = {
  margin: 0,
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.88rem',
  lineHeight: 1.6,
};
