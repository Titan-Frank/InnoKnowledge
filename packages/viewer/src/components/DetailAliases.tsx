import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { ToneBadge } from './aiwc/index.js';

interface Props {
  node: GraphNode;
}

export function DetailAliases({ node }: Props) {
  const aliases = node.aliases && node.aliases.length ? node.aliases : ['无'];

  return (
    <div style={blockStyle}>
      <h3 style={blockTitleStyle}>别名</h3>
      <div style={pillRowStyle}>
        {aliases.map((alias) => (
          <ToneBadge key={alias} tone="secondary">{alias}</ToneBadge>
        ))}
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

const pillRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 8,
};
