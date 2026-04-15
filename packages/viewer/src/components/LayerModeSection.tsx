import { useGraphStore, setLayerMode, collapseSupport } from '../store/graphStore.js';
import { LAYER_MODE_OPTIONS } from '../constants/index.js';
import { SegmentedControl, ActionButton } from './aiwc/index.js';
import {
  createWorkspaceHintStyle,
  workspaceSectionHeaderStyle,
  createWorkspaceSectionNoteStyle,
  createWorkspaceSectionStyle,
  createWorkspaceSectionTitleStyle,
} from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';

export function LayerModeSection() {
  const t = useTokens();
  const layerMode = useGraphStore((s) => s.layerMode);
  const expandedBackboneNodeId = useGraphStore((s) => s.expandedBackboneNodeId);
  const data = useGraphStore((s) => s.data);

  const expandedNode = expandedBackboneNodeId && data?.nodeById.get(expandedBackboneNodeId);
  const layerNote = layerMode === 'all'
    ? '全部可见'
    : expandedNode
      ? `已展开 ${expandedNode.name}`
      : '主干优先';

  const activeMode = LAYER_MODE_OPTIONS.find((o) => o.id === layerMode);
  const hints = [activeMode?.description];
  if (layerMode === 'backbone-expand') {
    hints.push(
      expandedNode
        ? `当前展开主干: ${expandedNode.name}`
        : '点一个主干节点，就会把它的一跳支撑节点展开出来。',
    );
  }
  const showCollapse = layerMode === 'backbone-expand' && expandedNode;

  return (
    <div style={createWorkspaceSectionStyle(t)}>
      <div style={workspaceSectionHeaderStyle}>
        <h2 style={createWorkspaceSectionTitleStyle(t)}>层级视图</h2>
        <span style={createWorkspaceSectionNoteStyle(t)}>{layerNote}</span>
      </div>
      <SegmentedControl
        value={layerMode}
        items={LAYER_MODE_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
        onChange={(v) => setLayerMode(v as typeof layerMode)}
        ariaLabel="层级视图"
      />
      <p style={createWorkspaceHintStyle(t)}>{hints.filter(Boolean).join(' | ')}</p>
      {showCollapse && (
        <ActionButton variant="ghost" onClick={collapseSupport}>
          收起当前支撑展开
        </ActionButton>
      )}
    </div>
  );
}
