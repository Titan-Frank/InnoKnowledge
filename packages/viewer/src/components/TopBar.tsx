import type { CSSProperties } from 'react';
import { StatsGrid } from './StatsGrid.js';
import { aiWebComponentTokens } from './aiwc/index.js';

export function TopBar() {
  return (
    <header style={topbarStyle}>
      <div>
        <p style={eyebrowStyle}>Knowledge Backbone Viewer</p>
        <h1 style={titleStyle}>知识主干网络浏览器</h1>
        <p style={ledeStyle}>
          通过本地 SQLite API 读取 canonical nodes、edges、framework、patterns、mentions
          与 evidence，生成一个可交互的本地知识网络界面。
        </p>
      </div>
      <StatsGrid />
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

const eyebrowStyle: CSSProperties = {
  margin: '0 0 4px',
  color: aiWebComponentTokens.colorAccent,
  fontSize: '0.78rem',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'clamp(2rem, 4vw, 3.5rem)',
  lineHeight: 0.98,
  fontWeight: 600,
};

const ledeStyle: CSSProperties = {
  maxWidth: '70ch',
  margin: '12px 0 0',
  color: aiWebComponentTokens.colorMuted,
  lineHeight: 1.7,
};
