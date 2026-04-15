import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { ToneBadge } from './aiwc/index.js';
import { createDetailSectionStyle, createDetailSectionTitleStyle } from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';

interface Props {
  node: GraphNode;
}

export function DetailAliases({ node }: Props) {
  const t = useTokens();
  const aliases = node.aliases && node.aliases.length ? node.aliases : ['无'];

  return (
    <div style={createDetailSectionStyle(t)}>
      <h3 style={createDetailSectionTitleStyle(t)}>别名</h3>
      <div style={pillRowStyle}>
        {aliases.map((alias) => (
          <ToneBadge key={alias} tone="secondary">{alias}</ToneBadge>
        ))}
      </div>
    </div>
  );
}

const pillRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};
