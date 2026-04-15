import type { CSSProperties } from 'react';
import { useTokens } from '../hooks/useTokens.js';
import type { TokenSet } from './aiwc/styles/tokens.js';

interface SigmaCameraControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToScreen: () => void;
}

export function SigmaCameraControls({ onZoomIn, onZoomOut, onFitToScreen }: SigmaCameraControlsProps) {
  const t = useTokens();

  return (
    <div style={controlsStyle(t)}>
      <button onClick={onZoomIn} style={buttonStyle(t)} title="放大">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="7" y1="4.5" x2="7" y2="9.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="4.5" y1="7" x2="9.5" y2="7" stroke="currentColor" strokeWidth="1.5" />
          <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <button onClick={onZoomOut} style={buttonStyle(t)} title="缩小">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="4.5" y1="7" x2="9.5" y2="7" stroke="currentColor" strokeWidth="1.5" />
          <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <div style={dividerStyle(t)} />
      <button onClick={onFitToScreen} style={buttonStyle(t)} title="适应画面">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <line x1="5.5" y1="5.5" x2="7" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="10.5" y1="5.5" x2="9" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="5.5" y1="10.5" x2="7" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="10.5" y1="10.5" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function controlsStyle(t: TokenSet): CSSProperties {
  return {
    position: 'absolute',
    bottom: 16,
    right: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    background: t.colorSurface,
    backdropFilter: 'blur(8px)',
    borderRadius: 8,
    border: `1px solid ${t.colorBorder}`,
    padding: '4px 6px',
    zIndex: 10,
  };
}

function buttonStyle(t: TokenSet): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    border: 'none',
    background: 'transparent',
    borderRadius: 6,
    color: t.colorTextSubtle,
    cursor: 'pointer',
    transition: 'background 120ms ease-out, color 120ms ease-out',
  };
}

function dividerStyle(t: TokenSet): CSSProperties {
  return {
    width: 1,
    height: 24,
    background: t.colorBorder,
    margin: '0 2px',
  };
}
