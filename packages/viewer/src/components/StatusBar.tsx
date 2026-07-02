import { useAppState } from '@/hooks/useAppState';
import { BarChart3 } from '@/lib/lucide-icons';

export function StatusBar() {
  const {
    knowledgeGraph,
    communityCount,
    isLayoutRunning,
    sourceConfigs,
    selectedSourceKey,
    searchTerm,
    serverSearchHits,
    serverSearchLoading,
    serverSearchError,
  } = useAppState();

  const sourceLabel = selectedSourceKey ? sourceConfigs.get(selectedSourceKey)?.label : null;
  const searchStatus = serverSearchLoading
    ? '检索中'
    : serverSearchError
      ? '检索失败'
      : searchTerm
        ? `${serverSearchHits.size} 命中`
        : null;

  return (
    <footer className="flex h-8 items-center gap-3 overflow-hidden border-t border-border-subtle bg-surface/95 px-4 text-[11px] text-text-muted backdrop-blur" aria-live="polite">
      <BarChart3 className="h-3.5 w-3.5 text-accent" />
      {sourceLabel && <span className="max-w-[18rem] truncate text-text-secondary">{sourceLabel}</span>}
      {knowledgeGraph && (
        <>
          <span className="h-3 w-px bg-border-subtle" />
          <span>{knowledgeGraph.nodeCount} 节点</span>
          <span>{knowledgeGraph.edgeCount} 边</span>
          <span>{knowledgeGraph.availableTypes.length} 类型</span>
          {communityCount > 0 && <span>{communityCount} 社区</span>}
        </>
      )}
      {searchStatus && (
        <>
          <span className="h-3 w-px bg-border-subtle" />
          <span className={serverSearchError ? 'text-node-event' : 'text-text-secondary'}>{searchStatus}</span>
        </>
      )}
      {isLayoutRunning && (
        <span role="status" className="ml-auto flex items-center gap-1.5 text-node-process">
          <span className="h-1.5 w-1.5 rounded-full bg-node-process" />
          布局优化中…
        </span>
      )}
    </footer>
  );
}
