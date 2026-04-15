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
    </div>
  );
}

function emptyStyle(t: TokenSet): CSSProperties {
  return {
    padding: '16px 16px 12px',
    background: t.colorSurfaceMuted,
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
    margin: '8px 0 0',
    color: t.colorMuted,
    fontSize: '0.88rem',
    lineHeight: 1.6,
  };
}
