import { useAppState } from '@/hooks/useAppState';
import { BarChart3 } from '@/lib/lucide-icons';

export function StatusBar() {
  const { knowledgeGraph, communityCount, isLayoutRunning, sourceConfigs, selectedSourceKey } = useAppState();

  const sourceLabel = selectedSourceKey ? sourceConfigs.get(selectedSourceKey)?.label : null;

  return (
    <footer className="flex h-8 items-center gap-3 border-t border-border-subtle bg-surface/95 px-4 text-[11px] text-text-muted" aria-live="polite">
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
      {isLayoutRunning && (
        <span role="status" className="ml-auto text-node-process">布局优化中…</span>
      )}
    </footer>
  );
}
