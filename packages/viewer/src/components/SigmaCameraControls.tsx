import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useTokens } from '../hooks/useTokens.js';
import type { TokenSet } from './aiwc/styles/tokens.js';

interface SigmaCameraControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToScreen: () => void;
  onToggleFullscreen?: () => void | Promise<void>;
  isFullscreen?: boolean;
}

export function SigmaCameraControls({
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onToggleFullscreen,
  isFullscreen = false,
}: SigmaCameraControlsProps) {
  const t = useTokens();
  const stopBubble = (event: ReactMouseEvent | ReactPointerEvent) => {
    event.stopPropagation();
  };

  const handleAction = (
    action: () => void,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  return (
    <div style={controlsStyle(t)}>
      <button
        type="button"
        onPointerDown={stopBubble}
        onMouseDown={stopBubble}
        onClick={(event) => handleAction(onZoomIn, event)}
        style={buttonStyle(t)}
        title="放大"
        aria-label="放大"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="7" y1="4.5" x2="7" y2="9.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="4.5" y1="7" x2="9.5" y2="7" stroke="currentColor" strokeWidth="1.5" />
          <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        onPointerDown={stopBubble}
        onMouseDown={stopBubble}
        onClick={(event) => handleAction(onZoomOut, event)}
        style={buttonStyle(t)}
        title="缩小"
        aria-label="缩小"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="4.5" y1="7" x2="9.5" y2="7" stroke="currentColor" strokeWidth="1.5" />
          <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <div style={dividerStyle(t)} />
      <button
        type="button"
        onPointerDown={stopBubble}
        onMouseDown={stopBubble}
        onClick={(event) => handleAction(onFitToScreen, event)}
        style={buttonStyle(t)}
        title="适应画面"
        aria-label="适应画面"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <line x1="5.5" y1="5.5" x2="7" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="10.5" y1="5.5" x2="9" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="5.5" y1="10.5" x2="7" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="10.5" y1="10.5" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      {onToggleFullscreen && (
        <>
          <div style={dividerStyle(t)} />
          <button
            type="button"
            onPointerDown={stopBubble}
            onMouseDown={stopBubble}
            onClick={(event) => handleAction(() => void onToggleFullscreen(), event)}
            style={buttonStyle(t)}
            title={isFullscreen ? '退出全屏' : '全屏'}
            aria-label={isFullscreen ? '退出全屏' : '全屏'}
          >
            {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </button>
        </>
      )}
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
    zIndex: 40,
    isolation: 'isolate',
    pointerEvents: 'auto',
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
    pointerEvents: 'auto',
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

function FullscreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 2.5H2.5V6M10 2.5H13.5V6M2.5 10V13.5H6M13.5 10V13.5H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 6H2.5V2.5M10 6H13.5V2.5M2.5 13.5H6V10M13.5 13.5H10V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
