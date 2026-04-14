import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { humanizeKey, renderValue } from '../graph/layout.js';
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

export function DetailProperties({ node }: Props) {
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  const entries = Object.entries(properties);

  if (entries.length === 0) {
    return (
      <div style={detailSectionStyle}>
        <h3 style={detailSectionTitleStyle}>结构属性</h3>
        <div style={detailEmptyCardStyle}>
          <p style={detailBodyTextStyle}>这个节点目前还没有结构属性。</p>
        </div>
      </div>
    );
  }

  return (
    <div style={detailSectionStyle}>
      <h3 style={detailSectionTitleStyle}>结构属性</h3>
      <div style={listStyle}>
        {entries.map(([key, value]) => (
          <div style={detailSubcardStyle} key={key}>
            <div style={propertyLabelStyle}>{humanizeKey(key)}</div>
            <div style={propertyValueStyle} dangerouslySetInnerHTML={{ __html: renderValue(value) }} />
          </div>
        ))}
      </div>
    </div>
  );
}

const listStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const propertyLabelStyle: CSSProperties = {
  marginBottom: 6,
  fontWeight: 600,
};

const propertyValueStyle: CSSProperties = {
  ...detailBodyTextStyle,
  fontSize: '0.9rem',
};
