import type { CSSProperties } from 'react';
import { useGraphStore, setThemeMode } from '../store/graphStore.js';
import { useTokens } from '../hooks/useTokens.js';

export function ThemeToggle() {
  const themeMode = useGraphStore((s) => s.themeMode);
  const t = useTokens();

  return (
    <div style={toggleShellStyle(t)} aria-label="主题切换">
      <button
        type="button"
        onClick={() => setThemeMode('light')}
        style={optionStyle(themeMode === 'light', t)}
        title="切换到浅色模式"
        aria-pressed={themeMode === 'light'}
      >
        <span style={iconWrapStyle(themeMode === 'light', t)}>
          <SunIcon color={iconColor(themeMode === 'light', t)} />
        </span>
        浅色
      </button>
      <button
        type="button"
        onClick={() => setThemeMode('dark')}
        style={optionStyle(themeMode === 'dark', t)}
        title="切换到深色模式"
        aria-pressed={themeMode === 'dark'}
      >
        <span style={iconWrapStyle(themeMode === 'dark', t)}>
          <MoonIcon color={iconColor(themeMode === 'dark', t)} />
        </span>
        深色
      </button>
    </div>
  );
}

function toggleShellStyle(t: ReturnType<typeof useTokens>): CSSProperties {
  return {
    display: 'inline-grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 6,
    padding: 6,
    borderRadius: 999,
    background: t.colorSurfaceRaised,
    border: `1px solid ${t.colorBorder}`,
    boxShadow: t.shadowSoft,
  };
}

function optionStyle(active: boolean, t: ReturnType<typeof useTokens>): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 40,
    minWidth: 96,
    padding: '0 14px',
    borderRadius: 999,
    border: 'none',
    cursor: 'pointer',
    background: active ? t.colorSurface : 'transparent',
    color: active ? t.colorText : t.colorTextSubtle,
    fontSize: 13,
    fontWeight: 700,
    boxShadow: active ? t.shadowSoft : 'none',
  };
}

function iconWrapStyle(active: boolean, t: ReturnType<typeof useTokens>): CSSProperties {
  return {
    width: 22,
    height: 22,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    background: active ? t.colorAccentSoft : t.colorSurfaceMuted,
    border: `1px solid ${active ? `${t.colorAccent}33` : t.colorBorder}`,
    flexShrink: 0,
  };
}

function iconColor(active: boolean, t: ReturnType<typeof useTokens>): string {
  return active ? t.colorAccent : t.colorMuted;
}

function SunIcon({ color }: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill={color} />
      <path d="M8 1.5V3M8 13V14.5M14.5 8H13M3 8H1.5M12.95 3.05L11.9 4.1M4.1 11.9L3.05 12.95M12.95 12.95L11.9 11.9M4.1 4.1L3.05 3.05" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon({ color }: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10.8 2.1C8.15 2.4 6 4.66 6 7.38C6 10.31 8.38 12.69 11.31 12.69C12.1 12.69 12.85 12.52 13.53 12.21C12.64 13.69 10.99 14.69 9.11 14.69C6.28 14.69 4 12.41 4 9.58C4 6.99 5.92 4.84 8.41 4.51C9.17 3.53 9.96 2.73 10.8 2.1Z" fill={color} />
    </svg>
  );
}
