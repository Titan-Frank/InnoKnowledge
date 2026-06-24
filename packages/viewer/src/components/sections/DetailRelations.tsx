import type { OKMNode } from '@/core/graph/types';
import { useAppState } from '@/hooks/useAppState';
import { resolveEdgeVisual } from '@/lib/edge-styles';

export function DetailRelations({ node }: { node: OKMNode }) {
  const { knowledgeGraph, setSelectedNodeId } = useAppState();
  if (!knowledgeGraph) return null;

  const edges = knowledgeGraph.edges.filter(
    (e) => e.from === node.id || e.to === node.id,
  );
  if (edges.length === 0) return null;

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-text-muted">关系 ({edges.length})</div>
      <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
        {edges.map((edge) => {
          const otherId = edge.from === node.id ? edge.to : edge.from;
          const otherNode = knowledgeGraph.nodeById.get(otherId);
          const visual = resolveEdgeVisual(edge.edgeType);
          const isOutgoing = edge.from === node.id;

          return (
            <button
              key={edge.id}
              onClick={() => setSelectedNodeId(otherId)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-text-secondary transition-colors hover:bg-hover"
            >
              <div className="h-0.5 w-4 rounded" style={{ backgroundColor: visual.stroke }} />
              <span className="text-text-muted">{isOutgoing ? '→' : '←'}</span>
              <span style={{ color: visual.stroke }}>{visual.category}</span>
              <span className="truncate">{otherNode?.name ?? otherId}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
