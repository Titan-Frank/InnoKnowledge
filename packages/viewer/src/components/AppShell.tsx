import type { CSSProperties } from 'react';
import { useEffect } from 'react';
import { useGraphStore } from '../store/graphStore.js';
import { useTokens } from '../hooks/useTokens.js';
import { TopBar } from './TopBar.js';
import { Sidebar } from './Sidebar.js';
import { GraphStage } from './GraphStage.js';
import { DetailPanel } from './DetailPanel.js';

export function AppShell() {
  const data = useGraphStore((s) => s.data);
  const sourceLoading = useGraphStore((s) => s.sourceLoading);
  const themeMode = useGraphStore((s) => s.themeMode);
  const t = useTokens();

  // Sync body style and CSS custom properties with theme
  useEffect(() => {
    document.body.style.background = t.colorPage;
    document.body.style.color = t.colorText;
    document.documentElement.style.setProperty('--okm-color-page', t.colorPage);
    document.documentElement.style.setProperty('--okm-color-surface', t.colorSurface);
    document.documentElement.style.setProperty('--okm-color-border', t.colorBorder);
    document.documentElement.style.setProperty('--okm-color-text', t.colorText);
    document.documentElement.style.setProperty('--okm-color-text-subtle', t.colorTextSubtle);
    document.documentElement.style.setProperty('--okm-color-muted', t.colorMuted);
  }, [themeMode, t]);

  if (!data && !sourceLoading) {
    return (
      <div style={{ ...shellStyle, padding: 64, textAlign: 'center', color: t.colorMuted }}>
        <p>正在连接数据源...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ ...shellStyle, padding: 64, textAlign: 'center', color: t.colorMuted }}>
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
  gridTemplateRows: '1fr',
  gap: 16,
  alignItems: 'stretch',
};
