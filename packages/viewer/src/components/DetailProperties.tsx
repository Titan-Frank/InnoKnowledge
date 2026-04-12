import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { humanizeKey, renderValue } from '../graph/layout.js';
import { aiWebComponentTokens } from './aiwc/index.js';

interface Props {
  node: GraphNode;
}

export function DetailProperties({ node }: Props) {
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  const entries = Object.entries(properties);

  if (entries.length === 0) {
    return (
      <div style={blockStyle}>
        <h3 style={blockTitleStyle}>结构属性</h3>
        <div style={emptyStyle}>
          <p style={emptyTextStyle}>这个节点目前还没有结构属性。</p>
        </div>
      </div>
    );
  }

  return (
    <div style={blockStyle}>
      <h3 style={blockTitleStyle}>结构属性</h3>
      <div style={listStyle}>
        {entries.map(([key, value]) => (
          <div style={propertyGroupStyle} key={key}>
            <div style={propertyLabelStyle}>{humanizeKey(key)}</div>
            <div style={propertyValueStyle} dangerouslySetInnerHTML={{ __html: renderValue(value) }} />
          </div>
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

const listStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  marginTop: 8,
};

const propertyGroupStyle: CSSProperties = {
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radiusSmall,
  background: aiWebComponentTokens.colorSurface,
  padding: 12,
};

const propertyLabelStyle: CSSProperties = {
  marginBottom: 6,
  fontWeight: 600,
};

const propertyValueStyle: CSSProperties = {
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.9rem',
  lineHeight: 1.65,
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
