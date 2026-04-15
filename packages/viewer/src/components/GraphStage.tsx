import type { CSSProperties } from 'react';
import { GraphToolbar } from './GraphToolbar.js';
import { SigmaGraphPanel } from './SigmaGraphPanel.js';
import { useKnowledgeGraphData } from '../hooks/useKnowledgeGraphData.js';
import { useTokens } from '../hooks/useTokens.js';

export function GraphStage() {
  const { status } = useKnowledgeGraphData();
  const t = useTokens();

  return (
    <main style={stageStyle(t)}>
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

function stageStyle(t: ReturnType<typeof useTokens>): CSSProperties {
  return {
    height: '76vh',
    overflow: 'hidden',
    border: `1px solid ${t.colorBorder}`,
    borderRadius: 12,
    background: t.colorPage,
    display: 'flex',
    flexDirection: 'column',
  };
}

const graphContainerStyle: CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  position: 'relative',
};
