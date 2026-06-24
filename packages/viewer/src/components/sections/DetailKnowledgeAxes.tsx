import type { OKMNode } from '@/core/graph/types';
import { LEARNING_MODE_LABELS, BRIDGE_TAG_LABELS } from '@/lib/constants';

export function DetailKnowledgeAxes({ node }: { node: OKMNode }) {
  const props = node.properties as Record<string, unknown>;
  const learningModes = (props?.learning_modes || []) as string[];
  const bridgeTags = (props?.bridge_tags || []) as string[];

  if (learningModes.length === 0 && bridgeTags.length === 0) return null;

  return (
    <div>
      {learningModes.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-xs font-medium text-text-muted">学习模式</div>
          <div className="flex flex-wrap gap-1">
            {learningModes.map((mode) => (
              <span key={mode} className="rounded-md bg-accent/10 px-1.5 py-0.5 text-xs text-accent">
                {LEARNING_MODE_LABELS[mode] ?? mode}
              </span>
            ))}
          </div>
        </div>
      )}
      {bridgeTags.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-text-muted">桥梁概念</div>
          <div className="flex flex-wrap gap-1">
            {bridgeTags.map((tag) => (
              <span key={tag} className="rounded-md bg-elevated px-1.5 py-0.5 text-xs text-text-secondary">
                {BRIDGE_TAG_LABELS[tag] ?? tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
