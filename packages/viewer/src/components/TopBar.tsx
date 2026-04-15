import type { CSSProperties } from 'react';
import { StatsGrid } from './StatsGrid.js';
import { ThemeToggle } from './ThemeToggle.js';
import { useTokens } from '../hooks/useTokens.js';
import type { TokenSet } from './aiwc/styles/tokens.js';

export function TopBar() {
  const t = useTokens();

  return (
    <header style={topbarStyle}>
      <div>
        <p style={eyebrowStyle(t)}>Knowledge Map</p>
        <h1 style={titleStyle}>知识地图</h1>
        <p style={ledeStyle(t)}>
          从教材中提取概念、原理与关联，绘制可交互的知识地图——看清全貌，也看清脉络。
        </p>
      </div>
      <div style={rightColStyle}>
        <ThemeToggle />
        <StatsGrid />
      </div>
    </header>
  );
}

const topbarStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.35fr) minmax(340px, 1fr)',
  gap: 20,
  alignItems: 'end',
  marginBottom: 20,
};

const rightColStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  alignItems: 'end',
};

function eyebrowStyle(t: TokenSet): CSSProperties {
  return {
    margin: '0 0 4px',
    color: t.colorAccent,
    fontSize: '0.78rem',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
  };
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'clamp(2rem, 4vw, 3.5rem)',
  lineHeight: 0.98,
  fontWeight: 600,
};

function ledeStyle(t: TokenSet): CSSProperties {
  return {
    maxWidth: '70ch',
    margin: '12px 0 0',
    color: t.colorMuted,
    lineHeight: 1.7,
  };
}
