import type { GraphNode } from '../store/types.js';
import { DetailHeader } from './DetailHeader.js';
import { DetailDescription } from './DetailDescription.js';
import { DetailKnowledgeAxes } from './DetailKnowledgeAxes.js';
import { DetailProfiles } from './DetailProfiles.js';
import { DetailAliases } from './DetailAliases.js';
import { DetailProperties } from './DetailProperties.js';
import { DetailSupportNodes } from './DetailSupportNodes.js';
import { DetailNodeCard } from './DetailNodeCard.js';
import { DetailRelations } from './DetailRelations.js';
import { DetailMentions } from './DetailMentions.js';
import { DetailEvidence } from './DetailEvidence.js';

interface Props {
  node: GraphNode;
}

export function DetailContent({ node }: Props) {
  return (
    <section className="panel-section">
      <DetailHeader node={node} />
      <DetailDescription node={node} />
      <DetailKnowledgeAxes node={node} />
      <DetailProfiles node={node} />
      <DetailAliases node={node} />
      <DetailProperties node={node} />
      <DetailSupportNodes node={node} />
      <DetailNodeCard node={node} />
      <DetailRelations node={node} />
      <DetailMentions node={node} />
      <DetailEvidence node={node} />
    </section>
  );
}
