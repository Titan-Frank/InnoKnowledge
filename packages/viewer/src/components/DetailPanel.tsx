import { useAppState } from '@/hooks/useAppState';
import { DetailHeader } from './sections/DetailHeader';
import { DetailDescription } from './sections/DetailDescription';
import { DetailKnowledgeAxes } from './sections/DetailKnowledgeAxes';
import { DetailProfiles } from './sections/DetailProfiles';
import { DetailAliases } from './sections/DetailAliases';
import { DetailProperties } from './sections/DetailProperties';
import { DetailSupportNodes } from './sections/DetailSupportNodes';
import { DetailNodeCard } from './sections/DetailNodeCard';
import { DetailRelations } from './sections/DetailRelations';
import { DetailMentions } from './sections/DetailMentions';
import { DetailEvidence } from './sections/DetailEvidence';
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
        <DetailDescription node={node} />
        <DetailKnowledgeAxes node={node} />
        <DetailAliases node={node} />
        <DetailProfiles node={node} />
        <DetailProperties node={node} />
        <DetailSupportNodes node={node} />
        <DetailRelations node={node} />
        <DetailMentions node={node} selectedBook={selectedBook} />
        <DetailEvidence node={node} selectedBook={selectedBook} knowledgeGraph={knowledgeGraph} />
        <DetailNodeCard node={node} />
      </div>
    </aside>
  );
}
