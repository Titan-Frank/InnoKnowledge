import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { getTypeLabel, humanizeKey } from '../graph/layout.js';
import { LEARNING_MODE_LABELS, BRIDGE_TAG_LABELS } from '../constants/index.js';
import { ToneBadge, aiWebComponentTokens } from './aiwc/index.js';

interface Props {
  node: GraphNode;
}

export function DetailKnowledgeAxes({ node }: Props) {
  const ontologyChips = [
    node.node_kind ? getTypeLabel(node.node_kind) : null,
    node.node_subkind ? getTypeLabel(node.node_subkind) : null,
    node.node_type && node.node_type !== node.node_kind && node.node_type !== node.node_subkind
      ? `显示类型 ${getTypeLabel(node.node_type)}`
      : null,
  ].filter(Boolean) as string[];

  const learningModeChips = (node.learning_modes || []).map(
    (mode) => LEARNING_MODE_LABELS[mode] ?? humanizeKey(mode),
  );
  const bridgeTagChips = (node.bridge_tags || []).map(
    (tag) => BRIDGE_TAG_LABELS[tag] ?? humanizeKey(tag),
  );

  const sections = [
    { title: '本体类型', summary: '节点在统一知识地图中的主轴分类。', chips: ontologyChips },
    { title: '学习方式', summary: '这个节点更偏向哪种学习处理方式。', chips: learningModeChips },
    { title: '跨学科桥标签', summary: '用于跨学科连接和后续知识图谱扩展的桥接标签。', chips: bridgeTagChips },
  ];

  return (
    <div style={blockStyle}>
      <h3 style={blockTitleStyle}>知识轴</h3>
      <div style={listStyle}>
        {sections.map((section) => (
          <div style={groupStyle} key={section.title}>
            <h4 style={groupTitleStyle}>{section.title}</h4>
            <p style={groupDescStyle}>{section.summary}</p>
            {section.chips.length > 0 ? (
              <div style={chipsStyle}>
                {section.chips.map((chip) => (
                  <ToneBadge key={chip} tone="neutral">{chip}</ToneBadge>
                ))}
              </div>
            ) : (
              <p style={groupDescStyle}>当前数据源里还没有这部分信息。</p>
            )}
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

const groupStyle: CSSProperties = {
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radiusSmall,
  background: aiWebComponentTokens.colorSurface,
  padding: 12,
};

const groupTitleStyle: CSSProperties = {
  margin: '0 0 6px',
  fontSize: '0.92rem',
  fontWeight: 600,
};

const groupDescStyle: CSSProperties = {
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
