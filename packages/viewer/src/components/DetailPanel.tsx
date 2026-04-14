import { useGraphStore } from '../store/graphStore.js';
import { DetailEmpty } from './DetailEmpty.js';
import { DetailContent } from './DetailContent.js';
import { workspaceDockStyle } from './workspaceStyles.js';

export function DetailPanel() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const data = useGraphStore((s) => s.data);
  const node = selectedNodeId ? data?.nodeById.get(selectedNodeId) : null;

  return (
    <aside style={workspaceDockStyle}>
      {node ? <DetailContent node={node} /> : <DetailEmpty />}
    </aside>
  );
}
