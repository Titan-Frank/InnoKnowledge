import { useAppState } from '@/hooks/useAppState';
import type { SearchHitMeta } from '@/core/graph/types';
import { Sun, Moon, Search, Network, BarChart3, BookOpen, ClipboardList, Database } from '@/lib/lucide-icons';
import { useState, useCallback, useRef, useEffect } from 'react';
import { searchNodes } from '@/services/backend-client';

const WORKSPACE_ITEMS = [
  { id: 'graph', label: '图谱', icon: Network },
  { id: 'textbook', label: '教材', icon: BookOpen },
  { id: 'pipeline', label: '调试', icon: BarChart3 },
  { id: 'annotation', label: '标注', icon: ClipboardList },
] as const;

export function Header() {
  const {
    themeMode, setThemeMode,
    searchTerm, setSearchTerm,
    sourceConfigs, selectedSourceKey, switchSource,
    knowledgeGraph,
    workspace, setWorkspace,
    serverSearchLoading, serverSearchError, sourceLoading,
    setServerSearchHits, setServerSearchLoading, setServerSearchError,
  } = useAppState();

  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceLabel = selectedSourceKey ? sourceConfigs.get(selectedSourceKey)?.label : null;
  const currentWorkspace = WORKSPACE_ITEMS.find((item) => item.id === workspace);

  const handleThemeToggle = useCallback(() => {
    setThemeMode(themeMode === 'dark' ? 'light' : 'dark');
  }, [themeMode, setThemeMode]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value || !selectedSourceKey || !knowledgeGraph) return;
    debounceRef.current = setTimeout(async () => {
      setServerSearchLoading(true);
      setServerSearchError(false);
      try {
        const result = await searchNodes(selectedSourceKey, value, 60);
        if (result?.hits) {
          const hits = new Map<string, SearchHitMeta>();
          for (const hit of result.hits) {
            const h = hit as unknown as Record<string, unknown>;
            hits.set(hit.id, {
              score: hit.score ?? 0,
              text_match: (h.text_match as boolean) ?? false,
              vector_match: (h.vector_match as boolean) ?? false,
              similarity: (h.similarity as number | null) ?? null,
            });
          }
          setServerSearchHits(hits);
        }
      } catch {
        setServerSearchError(true);
      } finally {
        setServerSearchLoading(false);
      }
    }, 300);
  }, [selectedSourceKey, knowledgeGraph, setSearchTerm, setServerSearchLoading, setServerSearchHits, setServerSearchError]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <header className="okm-topbar border-b border-border-subtle bg-surface/90 px-3 py-2.5 shadow-panel backdrop-blur-xl sm:px-4">
      <div className="flex min-w-0 flex-col gap-3 xl:grid xl:grid-cols-[minmax(220px,auto)_minmax(420px,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <div className="okm-brand-mark flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent/35 bg-accent/10 text-accent shadow-glow-soft">
            <Network className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-semibold tracking-tight text-text-primary">知识地图</div>
              <span className="okm-live-dot" aria-hidden="true" />
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted">
              <span className="truncate">{sourceLabel ?? '等待数据源'}</span>
              {currentWorkspace && (
                <>
                  <span className="h-1 w-1 rounded-full bg-border-strong" />
                  <span className="shrink-0">{currentWorkspace.label}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:flex-nowrap">
          {sourceConfigs.size > 1 && (
            <label className="okm-control-surface flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border-subtle bg-elevated/90 px-2.5 text-xs text-text-secondary transition-colors focus-within:border-accent">
              <Database className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <select
                value={selectedSourceKey || ''}
                onChange={(e) => switchSource(e.target.value)}
                aria-label="选择数据源"
                className="min-w-0 max-w-40 bg-transparent text-xs text-text-primary outline-none sm:max-w-56"
              >
                {Array.from(sourceConfigs.entries()).map(([key, config]) => (
                  <option key={key} value={key}>{config.label}</option>
                ))}
              </select>
              {sourceLoading && (
                <div className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              )}
            </label>
          )}

          <nav className="okm-control-surface flex h-9 overflow-hidden rounded-lg border border-border-subtle bg-elevated/90 p-0.5" aria-label="工作区">
            {WORKSPACE_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = workspace === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setWorkspace(item.id)}
                  aria-pressed={active}
                  className={`flex min-w-16 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-accent text-white shadow-glow-soft'
                      : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 flex-1" />

          <label className={`okm-control-surface order-3 flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border px-3 transition-colors sm:order-none sm:w-72 lg:w-80 ${
            searchFocused
              ? 'border-accent bg-elevated shadow-glow-soft'
              : serverSearchError
                ? 'border-node-event/60 bg-elevated'
                : 'border-border-subtle bg-elevated'
          }`}>
            <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="搜索知识对象"
              aria-label="搜索知识对象"
              className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
            />
            {serverSearchLoading && (
              <div className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            )}
          </label>

          {knowledgeGraph && (
            <div className="okm-control-surface hidden items-center gap-2 rounded-lg border border-border-subtle bg-elevated/90 px-2.5 py-1.5 text-[11px] text-text-muted md:flex">
              <span className="font-medium text-text-secondary">{knowledgeGraph.nodeCount}</span>
              <span>节点</span>
              <span className="h-3 w-px bg-border-subtle" />
              <span className="font-medium text-text-secondary">{knowledgeGraph.edgeCount}</span>
              <span>边</span>
            </div>
          )}

          <button
            onClick={handleThemeToggle}
            aria-label={themeMode === 'dark' ? '切换到亮色' : '切换到暗色'}
            className="okm-control-surface flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-elevated/90 text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
            title={themeMode === 'dark' ? '切换到亮色' : '切换到暗色'}
          >
            {themeMode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
