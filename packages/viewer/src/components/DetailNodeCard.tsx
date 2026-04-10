import type { GraphNode } from '../store/types.js';
import { useNodeCardLoader } from '../hooks/useNodeCardLoader.js';
import { useGraphStore } from '../store/graphStore.js';
import { NODE_LAYER_LABELS } from '../constants/index.js';
import { humanizeKey } from '../graph/layout.js';
import type { ApiNodeCard } from '@okm/types';

interface Props {
  node: GraphNode;
}

function normalizeNodeCard(card: ApiNodeCard, node: GraphNode): ApiNodeCard & { card_layer: string } {
  return {
    ...card,
    card_layer:
      card.card_layer ||
      (card as Record<string, unknown>).layer as string | undefined ||
      (card.properties as Record<string, unknown> | undefined)?.card_layer as string | undefined ||
      node?.node_layer ||
      'support',
  } as ApiNodeCard & { card_layer: string };
}

function normalizeCardContent(content: unknown): string[] {
  if (Array.isArray(content)) return content.map((item) => String(item));
  if (content == null) return [];
  if (typeof content === 'string' || typeof content === 'number' || typeof content === 'boolean') {
    return [String(content)];
  }
  if (typeof content === 'object') {
    return Object.entries(content as Record<string, unknown>).map(([key, value]) => `${humanizeKey(key)}: ${String(value)}`);
  }
  return [String(content)];
}

function getPatternHints(node: GraphNode): Record<string, unknown>[] {
  const state = useGraphStore.getState();
  const patternMap = state.data?.patternsByType || new Map();
  const keys = [
    node.node_type,
    node.node_kind,
    node.node_subkind,
    node.node_kind && node.node_subkind ? `${node.node_kind}/${node.node_subkind}` : null,
  ].filter(Boolean) as string[];
  const seen = new Set<string>();

  return keys.flatMap((key) => patternMap.get(key) || []).filter((pattern) => {
    if (seen.has(pattern.id as string)) return false;
    seen.add(pattern.id as string);
    return true;
  });
}

export function DetailNodeCard({ node }: Props) {
  const { card, loading } = useNodeCardLoader(node);

  if (loading) {
    return (
      <div className="detail-block">
        <div className="section-head">
          <h3>节点说明卡</h3>
          <span className="section-note">加载中</span>
        </div>
        <div id="detail-card">
          <div className="empty-state">
            <p>正在读取这个节点的说明卡...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!card) {
    const patternHints = getPatternHints(node);
    const statusText = `尚未生成 · ${NODE_LAYER_LABELS[node.node_layer] ?? humanizeKey(node.node_layer)}卡`;
    return (
      <div className="detail-block">
        <div className="section-head">
          <h3>节点说明卡</h3>
          <span className="section-note">{statusText}</span>
        </div>
        <div id="detail-card">
          <div className="empty-state">
            <p>当前还没有这个节点的 node card，可以用 <code>@node-expander</code> 为它生成详细说明。</p>
            <p>如果这是当前批次里的主干节点，建议在 QA 通过后把它纳入批量扩卡目标。</p>
          </div>
          {patternHints.map((pattern) => {
            const sections = pattern.sections as Array<Record<string, unknown>> | undefined;
            const required = (sections || [])
              .filter((section) => section.required)
              .map((section) => section.title)
              .join('、');
            return (
              <div className="card-section" key={pattern.id as string}>
                <h4>{pattern.title as string}</h4>
                <p>{pattern.summary as string}</p>
                <div className="micro-list">
                  <span className="micro-chip">{pattern.id as string}</span>
                  <span className="micro-chip">必备 section: {required}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const normalizedCard = normalizeNodeCard(card, node);
  const statusText = `${normalizedCard.status || 'draft'} · ${NODE_LAYER_LABELS[normalizedCard.card_layer] ?? humanizeKey(normalizedCard.card_layer)}卡`;
  const layerChip = `${NODE_LAYER_LABELS[normalizedCard.card_layer] ?? humanizeKey(normalizedCard.card_layer)}卡`;

  return (
    <div className="detail-block">
      <div className="section-head">
        <h3>节点说明卡</h3>
        <span className="section-note">{statusText}</span>
      </div>
      <div id="detail-card">
        <div className="card-section">
          <h4>概要</h4>
          <p>{normalizedCard.summary || '暂无概要。'}</p>
          <div className="micro-list">
            <span className="micro-chip">{layerChip}</span>
            {(normalizedCard.pattern_refs || []).map((ref) => (
              <span className="micro-chip" key={ref}>{ref}</span>
            ))}
          </div>
        </div>
        {(normalizedCard.sections || []).map((section, i) => (
          <div className="card-section" key={i}>
            <h4>{section.title}</h4>
            <ul className="card-list">
              {normalizeCardContent(section.content).map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
            {section.source_refs?.length && (
              <div className="micro-list">
                {section.source_refs.map((ref) => (
                  <span className="micro-chip" key={ref}>{ref}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
