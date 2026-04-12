import type { CSSProperties } from 'react';
import { aiWebComponentTokens } from './aiwc/index.js';

export function DetailEmpty() {
  return (
    <div style={emptyStyle}>
      <p style={eyebrowStyle}>Node Detail</p>
      <h2 style={titleStyle}>选择一个节点</h2>
      <p style={descStyle}>
        右侧会显示这个知识点的基本信息、关系、来源课题、证据片段，以及已生成的节点说明卡。
      </p>
    </div>
  );
}

const emptyStyle: CSSProperties = {
  padding: '16px 16px 12px',
  background: aiWebComponentTokens.colorSurfaceMuted,
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
  fontSize: '1.06rem',
  fontWeight: 600,
};

const descStyle: CSSProperties = {
  margin: '8px 0 0',
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.88rem',
  lineHeight: 1.6,
};
