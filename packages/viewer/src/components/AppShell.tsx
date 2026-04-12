import type { CSSProperties } from 'react';
import { useGraphStore } from '../store/graphStore.js';
import { TopBar } from './TopBar.js';
import { Sidebar } from './Sidebar.js';
import { GraphStage } from './GraphStage.js';
import { DetailPanel } from './DetailPanel.js';
import { aiWebComponentTokens } from './aiwc/index.js';

export function AppShell() {
  const data = useGraphStore((s) => s.data);
  const sourceLoading = useGraphStore((s) => s.sourceLoading);

  if (!data && !sourceLoading) {
    return (
      <div style={{ ...shellStyle, padding: 64, textAlign: 'center', color: aiWebComponentTokens.colorMuted }}>
        <p>正在连接数据源...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ ...shellStyle, padding: 64, textAlign: 'center', color: aiWebComponentTokens.colorMuted }}>
        <p>数据加载中...</p>
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      <TopBar />
      <div style={workspaceStyle}>
        <Sidebar />
        <GraphStage />
        <DetailPanel />
      </div>
    </div>
  );
}

const shellStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  maxWidth: 1600,
  margin: '0 auto',
  padding: '24px 20px 32px',
};

const workspaceStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 320px) minmax(0, 1fr) minmax(310px, 360px)',
  gap: 16,
  alignItems: 'start',
};
