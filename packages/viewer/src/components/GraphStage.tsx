import type { CSSProperties } from 'react';
import { GraphToolbar } from './GraphToolbar.js';
import { KnowledgeGraphPanel, aiWebComponentTokens } from './aiwc/index.js';
import type { KnowledgeNode } from './aiwc/index.js';
import { useKnowledgeGraphData } from '../hooks/useKnowledgeGraphData.js';
import { useGraphStore, selectNode } from '../store/graphStore.js';

export function GraphStage() {
  const { nodes, edges, activeNodeId, draggedPositions, handleNodeDragStop } = useKnowledgeGraphData();
  const showLabels = useGraphStore((s) => s.showLabels);

  const handleSelectNode = (node: KnowledgeNode) => {
    selectNode(node.id, false);
  };

  return (
    <main style={stageStyle}>
      <GraphToolbar />
      <div style={graphContainerStyle}>
        <KnowledgeGraphPanel
          hideHeader
          hideSidebar
          nodes={nodes}
          edges={edges}
          draggedPositions={draggedPositions}
          activeNodeId={activeNodeId}
          showLabels={showLabels}
          onSelectNode={handleSelectNode}
          onNodeDragStop={handleNodeDragStop}
          emptyState="当前筛选下没有可显示的节点。"
        />
      </div>
    </main>
  );
}

const stageStyle: CSSProperties = {
  minHeight: '74vh',
  overflow: 'hidden',
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radius,
  background: aiWebComponentTokens.colorSurface,
  boxShadow: aiWebComponentTokens.shadow,
  display: 'flex',
  flexDirection: 'column',
};

const graphContainerStyle: CSSProperties = {
  flex: 1,
  overflow: 'hidden',
};
