import { useGraphStore, setLayerMode, collapseSupport } from '../store/graphStore.js';
import { LAYER_MODE_OPTIONS } from '../constants/index.js';
import { SegmentedControl, ActionButton } from './aiwc/index.js';
import {
  workspaceHintStyle,
  workspaceSectionHeaderStyle,
  workspaceSectionNoteStyle,
  workspaceSectionStyle,
  workspaceSectionTitleStyle,
} from './workspaceStyles.js';

export function LayerModeSection() {
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
    <div style={workspaceSectionStyle}>
      <div style={workspaceSectionHeaderStyle}>
        <h2 style={workspaceSectionTitleStyle}>层级视图</h2>
        <span style={workspaceSectionNoteStyle}>{layerNote}</span>
      </div>
      <SegmentedControl
        value={layerMode}
        items={LAYER_MODE_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
        onChange={(v) => setLayerMode(v as typeof layerMode)}
        ariaLabel="层级视图"
      />
      <p style={workspaceHintStyle}>{hints.filter(Boolean).join(' | ')}</p>
      {showCollapse && (
        <ActionButton variant="ghost" onClick={collapseSupport}>
          收起当前支撑展开
        </ActionButton>
      )}
    </div>
  );
}
