import { useAppState } from '@/hooks/useAppState';
import type { SearchHitMeta } from '@/core/graph/types';
import { Sun, Moon, Search, Network } from '@/lib/lucide-icons';
import { useState, useCallback, useRef, useEffect } from 'react';
import { searchNodes } from '@/services/backend-client';

export function Header() {
  const {
    themeMode, setThemeMode,
    searchTerm, setSearchTerm,
    sourceConfigs, selectedSourceKey, switchSource,
    knowledgeGraph,
    serverSearchLoading,
    setServerSearchHits, setServerSearchLoading, setServerSearchError,
  } = useAppState();

  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleThemeToggle = useCallback(() => {
    setThemeMode(themeMode === 'dark' ? 'light' : 'dark');
  }, [themeMode, setThemeMode]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value || !selectedSourceKey || !knowledgeGraph) return;
    debounceRef.current = setTimeout(async () => {
      setServerSearchLoading(true);
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
    <header className="flex h-12 items-center gap-3 border-b border-border-subtle bg-surface px-4">
      <div className="flex items-center gap-2">
        <Network className="h-5 w-5 text-accent" />
        <span className="text-sm font-semibold tracking-tight">知识地图</span>
      </div>

      {sourceConfigs.size > 1 && (
        <select
          value={selectedSourceKey || ''}
          onChange={(e) => switchSource(e.target.value)}
          className="rounded-md border border-border-subtle bg-elevated px-2 py-1 text-xs text-text-secondary outline-none focus:border-accent"
        >
          {Array.from(sourceConfigs.entries()).map(([key, config]) => (
            <option key={key} value={key}>{config.label}</option>
          ))}
        </select>
      )}

      <div className="flex-1" />

      <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors ${
        searchFocused ? 'border-accent bg-elevated' : 'border-border-subtle bg-surface'
      }`}>
        <Search className="h-3.5 w-3.5 text-text-muted" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder="搜索节点…"
          className="w-48 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
        />
        {serverSearchLoading && (
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        )}
        <kbd className="hidden rounded border border-border-subtle px-1 text-[10px] text-text-muted sm:inline">⌘K</kbd>
      </div>

      {knowledgeGraph && (
        <span className="text-xs text-text-muted">
          {knowledgeGraph.nodeCount} 节点 · {knowledgeGraph.edgeCount} 边
        </span>
      )}

      <button
        onClick={handleThemeToggle}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border-subtle bg-elevated text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
        title={themeMode === 'dark' ? '切换到亮色' : '切换到暗色'}
      >
        {themeMode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </header>
  );
}
