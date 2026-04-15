import { useGraphStore } from '../store/graphStore.js';
import { DetailEmpty } from './DetailEmpty.js';
import { DetailContent } from './DetailContent.js';
import { createWorkspaceDockStyle } from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';

export function DetailPanel() {
  const t = useTokens();
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const data = useGraphStore((s) => s.data);
  const node = selectedNodeId ? data?.nodeById.get(selectedNodeId) : null;

  return (
    <aside style={createWorkspaceDockStyle(t)}>
      {node ? <DetailContent node={node} /> : <DetailEmpty />}
    </aside>
  );
}
