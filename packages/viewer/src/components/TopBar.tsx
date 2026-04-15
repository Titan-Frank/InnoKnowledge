import type { CSSProperties } from 'react';
import { StatsGrid } from './StatsGrid.js';
import { ThemeToggle } from './ThemeToggle.js';
import { useTokens } from '../hooks/useTokens.js';
import type { TokenSet } from './aiwc/styles/tokens.js';

export function TopBar() {
  const t = useTokens();

  return (
    <header className="topbar-layout" style={topbarStyle}>
      <div className="topbar-hero" style={heroPanelStyle(t)}>
        <div style={heroBadgeRowStyle}>
          <p style={eyebrowStyle(t)}>Open Knowledge Map</p>
          <span style={heroTagStyle(t)}>交互图谱工作台</span>
        </div>
        <h1 style={titleStyle}>知识地图</h1>
        <p style={ledeStyle(t)}>
          从教材中提取概念、原理与关联，绘制可交互的知识地图。新的布局把筛选、图谱和节点详情拆成更清晰的工作区，
          让浏览全貌与追踪细节可以在同一屏里自然切换。
        </p>
        <div style={highlightsStyle}>
          <span style={highlightPillStyle(t)}>全局筛选</span>
          <span style={highlightPillStyle(t)}>语义关系</span>
          <span style={highlightPillStyle(t)}>证据追溯</span>
        </div>
      </div>

      <div className="topbar-utility" style={utilityPanelStyle(t)}>
        <div className="topbar-utility-header" style={utilityHeaderStyle}>
          <div>
            <p style={utilityEyebrowStyle(t)}>Workspace</p>
            <h2 style={utilityTitleStyle(t)}>主题与概览</h2>
          </div>
          <ThemeToggle />
        </div>
        <StatsGrid />
      </div>
    </header>
  );
}

const topbarStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.28fr) minmax(360px, 0.92fr)',
  gap: 18,
  alignItems: 'stretch',
  marginBottom: 22,
};

function heroPanelStyle(t: TokenSet): CSSProperties {
  return {
    display: 'grid',
    gap: 14,
    minHeight: 220,
    padding: '26px 28px',
    borderRadius: 28,
    border: `1px solid ${t.colorBorder}`,
    background: `linear-gradient(135deg, ${t.colorSurface} 0%, ${t.colorSurfaceRaised} 58%, ${t.colorSurfaceAccent} 100%)`,
    boxShadow: t.shadow,
    overflow: 'hidden',
  };
}

const heroBadgeRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
};

function heroTagStyle(t: TokenSet): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 34,
    padding: '0 14px',
    borderRadius: 999,
    color: t.colorText,
    background: t.colorSurface,
    border: `1px solid ${t.colorBorder}`,
    fontSize: 12,
    fontWeight: 700,
    boxShadow: t.shadowSoft,
  };
}

function utilityPanelStyle(t: TokenSet): CSSProperties {
  return {
    display: 'grid',
    gap: 16,
    padding: '22px 22px 20px',
    borderRadius: 28,
    border: `1px solid ${t.colorBorder}`,
    background: t.colorSurface,
    boxShadow: t.shadow,
  };
}

const utilityHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
};

function utilityEyebrowStyle(t: TokenSet): CSSProperties {
  return {
    margin: '0 0 6px',
    color: t.colorMuted,
    fontSize: '0.78rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  };
}

function utilityTitleStyle(t: TokenSet): CSSProperties {
  return {
    margin: 0,
    fontSize: '1.15rem',
    fontWeight: 700,
    color: t.colorText,
  };
}

function eyebrowStyle(t: TokenSet): CSSProperties {
  return {
    margin: '0 0 4px',
    color: t.colorAccent,
    fontSize: '0.78rem',
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    fontWeight: 700,
  };
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'clamp(2.35rem, 4vw, 4.1rem)',
  lineHeight: 0.94,
  fontWeight: 700,
  letterSpacing: '-0.04em',
};

function ledeStyle(t: TokenSet): CSSProperties {
  return {
    maxWidth: '62ch',
    margin: 0,
    color: t.colorMuted,
    fontSize: '1rem',
    lineHeight: 1.75,
  };
}

const highlightsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 2,
};

function highlightPillStyle(t: TokenSet): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: 999,
    background: t.colorSurface,
    border: `1px solid ${t.colorBorder}`,
    color: t.colorTextSubtle,
    fontSize: 12,
    fontWeight: 700,
  };
}
