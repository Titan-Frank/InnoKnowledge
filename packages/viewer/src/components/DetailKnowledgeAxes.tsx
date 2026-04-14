import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { getTypeLabel, humanizeKey } from '../graph/layout.js';
import { LEARNING_MODE_LABELS, BRIDGE_TAG_LABELS } from '../constants/index.js';
import { ToneBadge } from './aiwc/index.js';
import {
  detailBodyTextStyle,
  detailSectionStyle,
  detailSectionTitleStyle,
  detailSubcardStyle,
} from './workspaceStyles.js';

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
    <div style={detailSectionStyle}>
      <h3 style={detailSectionTitleStyle}>知识轴</h3>
      <div style={listStyle}>
        {sections.map((section) => (
          <div style={detailSubcardStyle} key={section.title}>
            <h4 style={groupTitleStyle}>{section.title}</h4>
            <p style={detailBodyTextStyle}>{section.summary}</p>
            {section.chips.length > 0 ? (
              <div style={chipsStyle}>
                {section.chips.map((chip) => (
                  <ToneBadge key={chip} tone="neutral">{chip}</ToneBadge>
                ))}
              </div>
            ) : (
              <p style={detailBodyTextStyle}>当前数据源里还没有这部分信息。</p>
            )}
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

const groupTitleStyle: CSSProperties = {
  margin: '0 0 6px',
  fontSize: '0.92rem',
  fontWeight: 600,
};

const chipsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};
