import type { GraphNode } from '../store/types.js';
import {
  detailBodyTextStyle,
  detailSectionStyle,
  detailSectionTitleStyle,
} from './workspaceStyles.js';

interface Props {
  node: GraphNode;
}

export function DetailDescription({ node }: Props) {
  return (
    <div style={detailSectionStyle}>
      <h3 style={detailSectionTitleStyle}>摘要</h3>
      <p style={detailBodyTextStyle}>{node.description || '暂无摘要。'}</p>
    </div>
  );
}
