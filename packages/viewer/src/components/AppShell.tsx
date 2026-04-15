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
    document.documentElement.style.setProperty('--okm-color-accent', t.colorAccent);
    document.documentElement.style.setProperty('--okm-color-accent-soft', t.colorAccentSoft);
  }, [themeMode, t]);

  if (!data && !sourceLoading) {
    return (
      <div style={{ ...shellStyle(t), padding: 64, textAlign: 'center', color: t.colorMuted }}>
        <p>正在连接数据源...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ ...shellStyle(t), padding: 64, textAlign: 'center', color: t.colorMuted }}>
        <p>数据加载中...</p>
      </div>
    );
  }

  return (
    <div className="app-shell" style={shellStyle(t)}>
      <div style={backgroundLayerStyle}>
        <div style={backgroundGlowStyle(t)} />
        <div style={backgroundGlowAltStyle(t)} />
        <div style={backgroundGridStyle(t)} />
      </div>
      <div style={contentStyle}>
        <TopBar />
        <div className="workspace" style={workspaceStyle}>
          <Sidebar />
          <GraphStage />
          <DetailPanel />
        </div>
      </div>
    </div>
  );
}

function shellStyle(t: ReturnType<typeof useTokens>): CSSProperties {
  return {
    position: 'relative',
    minHeight: '100vh',
    overflow: 'hidden',
    background: `linear-gradient(180deg, ${t.colorPage} 0%, ${t.colorSurfaceMuted} 100%)`,
  };
}

const backgroundLayerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
};

function backgroundGlowStyle(t: ReturnType<typeof useTokens>): CSSProperties {
  return {
    position: 'absolute',
    top: -140,
    left: -120,
    width: 420,
    height: 420,
    borderRadius: '50%',
    background: `radial-gradient(circle, ${t.colorAccentSoft} 0%, transparent 72%)`,
    filter: 'blur(18px)',
    opacity: 0.9,
  };
}

function backgroundGlowAltStyle(t: ReturnType<typeof useTokens>): CSSProperties {
  return {
    position: 'absolute',
    right: -80,
    top: 80,
    width: 380,
    height: 380,
    borderRadius: '50%',
    background: `radial-gradient(circle, ${t.colorSecondaryAccentSoft} 0%, transparent 70%)`,
    filter: 'blur(24px)',
    opacity: 0.7,
  };
}

function backgroundGridStyle(t: ReturnType<typeof useTokens>): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    backgroundImage: `
      linear-gradient(${t.colorBorder}22 1px, transparent 1px),
      linear-gradient(90deg, ${t.colorBorder}22 1px, transparent 1px)
    `,
    backgroundSize: '48px 48px',
    maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.55), transparent 92%)',
  };
}

const contentStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  maxWidth: 1720,
  margin: '0 auto',
  padding: '28px 22px 36px',
};

const workspaceStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 320px) minmax(0, 1.15fr) minmax(320px, 380px)',
  gridTemplateRows: '1fr',
  gap: 18,
  alignItems: 'start',
};
