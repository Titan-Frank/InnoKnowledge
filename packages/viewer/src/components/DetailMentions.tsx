import type { GraphNode } from '../store/types.js';
import { useGraphStore } from '../store/graphStore.js';
import { getVisibleMentions } from '../graph/visibility.js';

interface Props {
  node: GraphNode;
}

export function DetailMentions({ node }: Props) {
  const state = useGraphStore.getState();
  const mentions = getVisibleMentions(node, state);

  if (mentions.length === 0) {
    const scopeLabel = state.selectedBook === 'all' ? '当前来源范围' : '当前教材';
    return (
      <div className="detail-block">
        <h3>教材出现位置</h3>
        <div className="mention-list">
          <div className="empty-state">
            <p>{scopeLabel}下没有这个节点的教材出现记录。</p>
            <p>这通常表示该版本输出里还没有为这个节点写入对应的 mention。</p>
          </div>
        </div>
      </div>
    );
  }

  const outlineTitleByAnchor = new Map<string, string>();
  state.data!.booksById.forEach((book) => {
    const items = (book.outline as Record<string, unknown>)?.items as Array<Record<string, unknown>> | undefined;
    (items || []).forEach((item) => {
      outlineTitleByAnchor.set(item.id as string, `${item.label} ${item.title}`);
    });
  });

  return (
    <div className="detail-block">
      <h3>教材出现位置</h3>
      <div className="mention-list">
        {mentions.map((mention) => {
          const mentionProps = mention.properties as Record<string, unknown>;
          const chips = [
            (mention as Record<string, unknown>).book_id as string,
            `页码 ${mentionProps?.page ?? '?'}`,
            outlineTitleByAnchor.get(mention.anchor_ref) || mention.anchor_ref,
          ];
          return (
            <div className="mention-item" key={mention.id}>
              <h4>{String(mentionProps?.book_context || mention.role)}</h4>
              <p>{mention.role} · {mention.anchor_ref}</p>
              <div className="micro-list">
                {chips.map((chip, i) => (
                  <span className="micro-chip" key={i}>{chip}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
