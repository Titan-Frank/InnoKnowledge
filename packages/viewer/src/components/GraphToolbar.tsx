import { useGraphStore, setShowLabels } from '../store/graphStore.js';
import { getTypeLabel, getTypeColor } from '../graph/layout.js';

export function GraphToolbar() {
  const data = useGraphStore((s) => s.data);
  const showLabels = useGraphStore((s) => s.showLabels);

  const handleFitView = () => {
    const canvas = document.getElementById('graph-canvas') as HTMLCanvasElement;
    const wrap = canvas?.parentElement as HTMLDivElement;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const state = useGraphStore.getState();
    if (!state.data) return;

    const nodes = state.data.nodes;
    if (nodes.length === 0) return;

    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const graphWidth = maxX - minX + 200;
    const graphHeight = maxY - minY + 200;
    const canvasWidth = wrap.clientWidth;
    const canvasHeight = wrap.clientHeight;
    const scale = Math.min(canvasWidth / graphWidth, canvasHeight / graphHeight, 1.5);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    useGraphStore.setState({
      transform: {
        x: (canvasWidth / 2 - cx * scale) * dpr,
        y: (canvasHeight / 2 - cy * scale) * dpr,
        scale,
      },
    });
  };

  return (
    <div className="graph-toolbar">
      <div className="legend">
        {(data?.availableTypes || []).map((type) => (
          <div className="legend-item" key={type}>
            <span className="legend-dot" style={{ background: getTypeColor(type) }} />
            <span>{getTypeLabel(type)}</span>
          </div>
        ))}
      </div>
      <div className="toolbar-actions">
        <button className="toolbar-button" onClick={handleFitView}>重置视图</button>
        <button
          className={`toolbar-button ${showLabels ? 'active' : ''}`}
          onClick={() => setShowLabels(!showLabels)}
          aria-pressed={showLabels}
          title={showLabels ? '隐藏画布上的节点名称' : '显示画布上的节点名称'}
        >
          {showLabels ? '隐藏名称' : '显示名称'}
        </button>
      </div>
    </div>
  );
}
