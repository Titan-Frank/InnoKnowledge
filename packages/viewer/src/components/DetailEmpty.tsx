import type { CSSProperties } from 'react';
import { useTokens } from '../hooks/useTokens.js';
import type { TokenSet } from './aiwc/styles/tokens.js';

export function DetailEmpty() {
  const t = useTokens();

  return (
    <div style={emptyStyle(t)}>
      <p style={eyebrowStyle(t)}>Node Detail</p>
      <h2 style={titleStyle}>选择一个节点</h2>
      <p style={descStyle(t)}>
        右侧会显示这个知识点的基本信息、关系、来源课题、证据片段，以及已生成的节点说明卡。
      </p>
      <div style={hintListStyle}>
        <span style={hintItemStyle(t)}>点击节点查看详情</span>
        <span style={hintItemStyle(t)}>拖动画布调整视野</span>
        <span style={hintItemStyle(t)}>在左侧筛选范围</span>
      </div>
    </div>
  );
}

function emptyStyle(t: TokenSet): CSSProperties {
  return {
    display: 'grid',
    gap: 12,
    padding: '22px 18px 18px',
    borderBottom: `1px solid ${t.colorBorder}`,
    background: `linear-gradient(180deg, ${t.colorSurface} 0%, ${t.colorSurfaceMuted} 100%)`,
  };
}

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
  fontSize: '1.06rem',
  fontWeight: 600,
};

function descStyle(t: TokenSet): CSSProperties {
  return {
    margin: 0,
    color: t.colorMuted,
    fontSize: '0.88rem',
    lineHeight: 1.6,
  };
}

const hintListStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

function hintItemStyle(t: TokenSet): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '7px 10px',
    borderRadius: 999,
    background: t.colorSurface,
    border: `1px solid ${t.colorBorder}`,
    color: t.colorTextSubtle,
    fontSize: '0.8rem',
    fontWeight: 600,
  };
}
