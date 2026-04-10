import { useGraphStore, setLayerMode, collapseSupport } from '../store/graphStore.js';
import { LAYER_MODE_OPTIONS } from '../constants/index.js';

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
    <section className="panel-section">
      <div className="section-head">
        <h2>层级视图</h2>
        <span className="section-note">{layerNote}</span>
      </div>
      <div className="segmented">
        {LAYER_MODE_OPTIONS.map((option) => (
          <button
            key={option.id}
            className={`segment ${layerMode === option.id ? 'active' : ''}`}
            onClick={() => setLayerMode(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="source-hint">{hints.filter(Boolean).join(' | ')}</p>
      {showCollapse && (
        <button className="ghost-button" onClick={collapseSupport}>
          收起当前支撑展开
        </button>
      )}
    </section>
  );
}
