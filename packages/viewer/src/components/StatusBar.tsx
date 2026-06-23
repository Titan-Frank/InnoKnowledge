import { useAppState } from '@/hooks/useAppState';
import { BarChart3 } from '@/lib/lucide-icons';

export function StatusBar() {
  const { knowledgeGraph, communityCount, isLayoutRunning, sourceConfigs, selectedSourceKey } = useAppState();

  const sourceLabel = selectedSourceKey ? sourceConfigs.get(selectedSourceKey)?.label : null;

  return (
    <footer className="flex h-7 items-center gap-4 border-t border-border-subtle bg-surface px-4 text-[11px] text-text-muted" aria-live="polite">
      <BarChart3 className="h-3 w-3" />
      {sourceLabel && <span>{sourceLabel}</span>}
      {knowledgeGraph && (
        <>
          <span>{knowledgeGraph.nodeCount} 节点</span>
          <span>{knowledgeGraph.edgeCount} 边</span>
          <span>{knowledgeGraph.availableTypes.length} 类型</span>
          {communityCount > 0 && <span>{communityCount} 社区</span>}
        </>
      )}
      {isLayoutRunning && (
        <span role="status" className="text-emerald-400">布局优化中…</span>
      )}
    </footer>
  );
}
