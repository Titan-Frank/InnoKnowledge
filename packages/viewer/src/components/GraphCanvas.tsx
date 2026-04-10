import { useGraphCanvas } from '../hooks/useGraphCanvas.js';
import { useCanvasInteraction } from '../hooks/useCanvasInteraction.js';

export function GraphCanvas() {
  const { canvasRef, wrapRef } = useGraphCanvas();
  useCanvasInteraction(canvasRef);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} id="graph-canvas" />
      <div className="graph-overlay">
        <div className="overlay-card">
          <p>拖动节点可调整布局，滚轮可缩放，空白处拖动画布。</p>
        </div>
      </div>
    </div>
  );
}
