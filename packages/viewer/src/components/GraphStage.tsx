import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { GraphToolbar } from './GraphToolbar.js';
import { SigmaGraphPanel } from './SigmaGraphPanel.js';
import { useKnowledgeGraphData } from '../hooks/useKnowledgeGraphData.js';
import { useTokens } from '../hooks/useTokens.js';

export function GraphStage() {
  const { status } = useKnowledgeGraphData();
  const t = useTokens();
  const stageRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === stageRef.current);
    };

    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    const stage = stageRef.current;
    if (!stage) return;

    if (document.fullscreenElement === stage) {
      await document.exitFullscreen();
      return;
    }

    await stage.requestFullscreen();
  };

  return (
    <main ref={stageRef} style={stageStyle(t, isFullscreen)}>
      <GraphToolbar />
      <div style={graphContainerStyle}>
        <SigmaGraphPanel
          status={status}
          emptyState="当前筛选下没有可显示的节点。"
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>
    </main>
  );
}

function stageStyle(t: ReturnType<typeof useTokens>, isFullscreen: boolean): CSSProperties {
  return {
    minHeight: isFullscreen ? '100vh' : '78vh',
    height: isFullscreen ? '100vh' : undefined,
    overflow: 'hidden',
    border: `1px solid ${t.colorBorder}`,
    borderRadius: 28,
    background: `linear-gradient(180deg, ${t.colorSurface} 0%, ${t.colorSurfaceMuted} 100%)`,
    boxShadow: t.shadow,
    display: 'flex',
    flexDirection: 'column',
  };
}

const graphContainerStyle: CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  position: 'relative',
};
