import type { CSSProperties } from 'react';
import { GraphToolbar } from './GraphToolbar.js';
import { SigmaGraphPanel } from './SigmaGraphPanel.js';
import { useKnowledgeGraphData } from '../hooks/useKnowledgeGraphData.js';

export function GraphStage() {
  const { status } = useKnowledgeGraphData();

  return (
    <main style={stageStyle}>
      <GraphToolbar />
      <div style={graphContainerStyle}>
        <SigmaGraphPanel
          status={status}
          emptyState="当前筛选下没有可显示的节点。"
        />
      </div>
    </main>
  );
}

const stageStyle: CSSProperties = {
  height: '76vh',
  overflow: 'hidden',
  border: '1px solid #1e1e2a',
  borderRadius: 12,
  background: '#06060a',
  display: 'flex',
  flexDirection: 'column',
};

const graphContainerStyle: CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  position: 'relative',
};
