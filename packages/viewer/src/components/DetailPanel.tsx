import type { CSSProperties } from 'react';
import { useGraphStore } from '../store/graphStore.js';
import { DetailEmpty } from './DetailEmpty.js';
import { DetailContent } from './DetailContent.js';
import { aiWebComponentTokens } from './aiwc/index.js';

export function DetailPanel() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const data = useGraphStore((s) => s.data);
  const node = selectedNodeId ? data?.nodeById.get(selectedNodeId) : null;

  return (
    <aside style={detailStyle}>
      {node ? <DetailContent node={node} /> : <DetailEmpty />}
    </aside>
  );
}

const detailStyle: CSSProperties = {
  position: 'sticky',
  top: 20,
  maxHeight: 'calc(100vh - 52px)',
  overflow: 'auto',
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radius,
  background: aiWebComponentTokens.colorSurface,
  boxShadow: aiWebComponentTokens.shadow,
};
