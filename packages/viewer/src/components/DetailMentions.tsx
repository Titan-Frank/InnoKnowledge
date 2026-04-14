import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { useGraphStore } from '../store/graphStore.js';
import { getVisibleMentions } from '../graph/visibility.js';
import { ToneBadge } from './aiwc/index.js';
import {
  detailBodyTextStyle,
  detailEmptyCardStyle,
  detailSectionStyle,
  detailSectionTitleStyle,
  detailSubcardStyle,
} from './workspaceStyles.js';

interface Props {
  node: GraphNode;
}

export function DetailMentions({ node }: Props) {
  const state = useGraphStore.getState();
  const mentions = getVisibleMentions(node, state);

  if (mentions.length === 0) {
    const scopeLabel = state.selectedBook === 'all' ? '当前来源范围' : '当前教材';
    return (
      <div style={detailSectionStyle}>
        <h3 style={detailSectionTitleStyle}>教材出现位置</h3>
        <div style={detailEmptyCardStyle}>
          <p style={detailBodyTextStyle}>{scopeLabel}下没有这个节点的教材出现记录。</p>
          <p style={detailBodyTextStyle}>这通常表示该版本输出里还没有为这个节点写入对应的 mention。</p>
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
    <div style={detailSectionStyle}>
      <h3 style={detailSectionTitleStyle}>教材出现位置</h3>
      <div style={listStyle}>
        {mentions.map((mention) => {
          const mentionProps = mention.properties as Record<string, unknown>;
          const chips = [
            (mention as Record<string, unknown>).book_id as string,
            `页码 ${mentionProps?.page ?? '?'}`,
            outlineTitleByAnchor.get(mention.anchor_ref) || mention.anchor_ref,
          ];
          return (
            <div style={detailSubcardStyle} key={mention.id}>
              <h4 style={itemTitleStyle}>{String(mentionProps?.book_context || mention.role)}</h4>
              <p style={detailBodyTextStyle}>{mention.role} · {mention.anchor_ref}</p>
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
