import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { humanizeKey, renderValue } from '../graph/layout.js';
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

export function DetailProperties({ node }: Props) {
  const t = useTokens();
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  const entries = Object.entries(properties);

  if (entries.length === 0) {
    return (
      <div style={createDetailSectionStyle(t)}>
        <h3 style={createDetailSectionTitleStyle(t)}>结构属性</h3>
        <div style={createDetailEmptyCardStyle(t)}>
          <p style={createDetailBodyTextStyle(t)}>这个节点目前还没有结构属性。</p>
        </div>
      </div>
    );
  }

  return (
    <div style={createDetailSectionStyle(t)}>
      <h3 style={createDetailSectionTitleStyle(t)}>结构属性</h3>
      <div style={listStyle}>
        {entries.map(([key, value]) => (
          <div style={createDetailSubcardStyle(t)} key={key}>
            <div style={propertyLabelStyle}>{humanizeKey(key)}</div>
            <div style={propertyValueStyle(t)} dangerouslySetInnerHTML={{ __html: renderValue(value) }} />
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

function propertyValueStyle(t: ReturnType<typeof useTokens>): CSSProperties {
  return {
    ...createDetailBodyTextStyle(t),
    fontSize: '0.9rem',
  };
}
