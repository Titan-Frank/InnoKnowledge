import type { OKMNode } from '@/core/graph/types';
import { useAppState } from '@/hooks/useAppState';
import { isBackboneNode } from '@/core/graph/knowledge-data';
import { TYPE_META } from '@/lib/constants';

export function DetailSupportNodes({ node }: { node: OKMNode }) {
  const { knowledgeGraph, setSelectedNodeId, setExpandedBackboneNodeId, layerMode } = useAppState();
  if (!knowledgeGraph || !isBackboneNode(node)) return null;

  const supportEdges = knowledgeGraph.edges.filter(
    (e) => e.backboneExpand && (e.from === node.id || e.to === node.id),
  );
  if (supportEdges.length === 0) return null;

  const supportNodes = supportEdges
    .map((e) => {
      const otherId = e.from === node.id ? e.to : e.from;
      return knowledgeGraph.nodeById.get(otherId);
    })
    .filter((n): n is OKMNode => !!n && !isBackboneNode(n));

  if (supportNodes.length === 0) return null;

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-text-muted">支撑节点 ({supportNodes.length})</div>
      <div className="space-y-0.5">
        {supportNodes.map((sn) => (
          <button
            key={sn.id}
            onClick={() => {
              setSelectedNodeId(sn.id);
              if (layerMode === 'backbone-expand') setExpandedBackboneNodeId(node.id);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-text-secondary transition-colors hover:bg-hover"
          >
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: TYPE_META[sn.nodeType]?.color ?? '#9A9AB0' }} />
            <span className="truncate">{sn.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
