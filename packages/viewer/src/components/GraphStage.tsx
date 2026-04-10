import { GraphToolbar } from './GraphToolbar.js';
import { GraphCanvas } from './GraphCanvas.js';

export function GraphStage() {
  return (
    <main className="graph-stage panel fade-in">
      <GraphToolbar />
      <GraphCanvas />
    </main>
  );
}
