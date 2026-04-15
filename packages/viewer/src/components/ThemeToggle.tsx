import { useGraphStore, setThemeMode } from '../store/graphStore.js';
import { useTokens } from '../hooks/useTokens.js';

export function ThemeToggle() {
  const themeMode = useGraphStore((s) => s.themeMode);
  const t = useTokens();

  return (
    <button
      onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
      style={{
        background: t.colorSurface,
        border: `1px solid ${t.colorBorder}`,
        borderRadius: t.radiusPill,
        color: t.colorTextSubtle,
        cursor: 'pointer',
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        transition: 'background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out',
        alignSelf: 'end',
      }}
      title={themeMode === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
    >
      {themeMode === 'dark' ? '☀' : '☾'}
      {themeMode === 'dark' ? '浅色' : '深色'}
    </button>
  );
}
