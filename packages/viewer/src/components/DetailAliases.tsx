import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { ToneBadge } from './aiwc/index.js';
import { detailSectionStyle, detailSectionTitleStyle } from './workspaceStyles.js';

interface Props {
  node: GraphNode;
}

export function DetailAliases({ node }: Props) {
  const aliases = node.aliases && node.aliases.length ? node.aliases : ['无'];

  return (
    <div style={detailSectionStyle}>
      <h3 style={detailSectionTitleStyle}>别名</h3>
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
