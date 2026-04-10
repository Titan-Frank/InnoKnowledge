import type { GraphNode } from '../store/types.js';
import { useGraphStore } from '../store/graphStore.js';
import { getVisibleEvidence } from '../graph/visibility.js';

interface Props {
  node: GraphNode;
}

export function DetailEvidence({ node }: Props) {
  const state = useGraphStore.getState();
  const evidence = getVisibleEvidence(node, state);

  if (evidence.length === 0) {
    return (
      <div className="detail-block">
        <h3>证据</h3>
        <div className="evidence-list">
          <div className="empty-state">
            <p>当前没有关联证据。</p>
            <p>这通常表示 mention 的 <code>source_refs</code> 还没有连到有效 evidence。</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-block">
      <h3>证据</h3>
      <div className="evidence-list">
        {evidence.map((item) => {
          const itemAny = item as Record<string, unknown>;
          return (
            <div className="evidence-item" key={item.id}>
              <h4>{item.id}</h4>
              <p>{String(itemAny.snippet || '')}</p>
              <div className="micro-list">
                <span className="micro-chip">
                  {itemAny.page_start != null
                    ? `p.${itemAny.page_start}${itemAny.page_end !== itemAny.page_start ? `-${itemAny.page_end}` : ''}`
                    : String(itemAny.locator || '无页码')}
                </span>
                <span className="micro-chip">{String(itemAny.book_id || item.source_id)}</span>
                <span className="micro-chip">{item.anchor_ref}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
