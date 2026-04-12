import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { aiWebComponentTokens } from './aiwc/index.js';

interface Props {
  node: GraphNode;
}

export function DetailDescription({ node }: Props) {
  return (
    <div style={blockStyle}>
      <h3 style={blockTitleStyle}>摘要</h3>
      <p style={blockTextStyle}>{node.description || '暂无摘要。'}</p>
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

const blockTextStyle: CSSProperties = {
  margin: 0,
  lineHeight: 1.7,
  color: aiWebComponentTokens.colorTextSubtle,
};
