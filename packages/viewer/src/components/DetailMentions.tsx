import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { useGraphStore } from '../store/graphStore.js';
import { getVisibleMentions } from '../graph/visibility.js';
import { ToneBadge, aiWebComponentTokens } from './aiwc/index.js';

interface Props {
  node: GraphNode;
}

export function DetailMentions({ node }: Props) {
  const state = useGraphStore.getState();
  const mentions = getVisibleMentions(node, state);

  if (mentions.length === 0) {
    const scopeLabel = state.selectedBook === 'all' ? '当前来源范围' : '当前教材';
    return (
      <div style={blockStyle}>
        <h3 style={blockTitleStyle}>教材出现位置</h3>
        <div style={emptyStyle}>
          <p style={emptyTextStyle}>{scopeLabel}下没有这个节点的教材出现记录。</p>
          <p style={emptyTextStyle}>这通常表示该版本输出里还没有为这个节点写入对应的 mention。</p>
        </div>
      </div>
    );
  }

  const outlineTitleByAnchor = new Map<string, string>();
  state.data!.booksById.forEach((book) => {
    const items = (book.outline as Record<string, unknown>)?.items as Array<Record<string, unknown>> | undefined;
    (items || []).forEach((item) => {
      outlineTitleByAnchor.set(item.id as string, `${item.label} ${item.title}`);
    });
  });

  return (
    <div style={blockStyle}>
      <h3 style={blockTitleStyle}>教材出现位置</h3>
      <div style={listStyle}>
        {mentions.map((mention) => {
          const mentionProps = mention.properties as Record<string, unknown>;
          const chips = [
            (mention as Record<string, unknown>).book_id as string,
            `页码 ${mentionProps?.page ?? '?'}`,
            outlineTitleByAnchor.get(mention.anchor_ref) || mention.anchor_ref,
          ];
          return (
            <div style={itemStyle} key={mention.id}>
              <h4 style={itemTitleStyle}>{String(mentionProps?.book_context || mention.role)}</h4>
              <p style={itemDescStyle}>{mention.role} · {mention.anchor_ref}</p>
              <div style={chipsStyle}>
                {chips.map((chip, i) => (
                  <ToneBadge key={i} tone="neutral">{chip}</ToneBadge>
                ))}
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
