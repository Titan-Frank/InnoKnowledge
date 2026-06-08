import { useAppState } from '@/hooks/useAppState';
import { DetailHeader } from './sections/DetailHeader';
import { DetailDescription } from './sections/DetailDescription';
import { DetailKnowledgeAxes } from './sections/DetailKnowledgeAxes';
import { DetailAliases } from './sections/DetailAliases';
import { DetailProperties } from './sections/DetailProperties';
import { DetailSupportNodes } from './sections/DetailSupportNodes';
import { DetailUnit } from './sections/DetailUnit';
import { DetailMentions } from './sections/DetailMentions';
import { DetailEmpty } from './sections/DetailEmpty';

export function DetailPanel() {
  const { knowledgeGraph, selectedNodeId, selectedBook } = useAppState();

  if (!knowledgeGraph || !selectedNodeId) {
    return (
      <aside className="flex w-96 flex-col border-l border-border-subtle bg-surface">
        <DetailEmpty />
      </aside>
    );
  }

  const node = knowledgeGraph.nodeById.get(selectedNodeId);
  if (!node) {
    return (
      <aside className="flex w-96 flex-col border-l border-border-subtle bg-surface">
        <DetailEmpty />
      </aside>
    );
  }

  return (
    <aside className="flex w-96 flex-col border-l border-border-subtle bg-surface overflow-hidden">
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        <DetailHeader node={node} />
        <DetailUnit node={node} />
        {!node.description ? null : <DetailDescription node={node} />}
        <DetailKnowledgeAxes node={node} />
        <DetailAliases node={node} />
        <DetailProperties node={node} />
        <DetailSupportNodes node={node} />
        <DetailMentions node={node} selectedBook={selectedBook} />
      </div>
    </aside>
  );
}
