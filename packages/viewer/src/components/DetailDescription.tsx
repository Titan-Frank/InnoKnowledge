import type { GraphNode } from '../store/types.js';
import {
  createDetailBodyTextStyle,
  createDetailSectionStyle,
  createDetailSectionTitleStyle,
} from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';

interface Props {
  node: GraphNode;
}

export function DetailDescription({ node }: Props) {
  const t = useTokens();
  return (
    <div style={createDetailSectionStyle(t)}>
      <h3 style={createDetailSectionTitleStyle(t)}>摘要</h3>
      <p style={createDetailBodyTextStyle(t)}>{node.description || '暂无摘要。'}</p>
    </div>
  );
}
