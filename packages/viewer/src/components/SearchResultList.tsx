import { useMemo } from 'react';
import { useGraphStore, selectNode } from '../store/graphStore.js';
import { getSearchMatches } from '../graph/visibility.js';
import { getTypeLabel } from '../graph/layout.js';
import { NODE_LAYER_LABELS } from '../constants/index.js';
import { humanizeKey } from '../graph/layout.js';
import { SessionListPanel } from './aiwc/index.js';
import type { SessionListItem } from './aiwc/index.js';
import {
  workspaceSectionHeaderStyle,
  createWorkspaceSectionNoteStyle,
  createWorkspaceSectionStyle,
  createWorkspaceSectionTitleStyle,
} from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';

function matchBadge(hit: { text_match: boolean; vector_match: boolean } | undefined): string | undefined {
  if (!hit) return undefined;
  if (hit.text_match && hit.vector_match) return '语义+文本';
  if (hit.vector_match) return '语义';
  if (hit.text_match) return '文本';
  return undefined;
}

export function SearchResultList() {
  const t = useTokens();
  const searchTerm = useGraphStore((s) => s.searchTerm);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectedBook = useGraphStore((s) => s.selectedBook);
  const layerMode = useGraphStore((s) => s.layerMode);
  const focusConnected = useGraphStore((s) => s.focusConnected);
  const expandedBackboneNodeId = useGraphStore((s) => s.expandedBackboneNodeId);
  const serverSearchHits = useGraphStore((s) => s.serverSearchHits);
  const serverSearchError = useGraphStore((s) => s.serverSearchError);

  const matches = useMemo(() => {
    return getSearchMatches(useGraphStore.getState()).slice(0, 60);
  }, [searchTerm, selectedNodeId, selectedBook, layerMode, focusConnected, expandedBackboneNodeId, serverSearchHits]);

  const items: SessionListItem[] = matches.map((node) => ({
    id: node.id,
    title: node.name,
    description: getTypeLabel(node.node_type),
    meta: node.id,
    badge: matchBadge(serverSearchHits.get(node.id))
      ?? NODE_LAYER_LABELS[node.node_layer]
      ?? humanizeKey(node.node_layer),
  }));

  const noteSuffix = serverSearchError && searchTerm ? '（本地搜索）' : '';

  return (
    <div style={createWorkspaceSectionStyle(t)}>
      <div style={workspaceSectionHeaderStyle}>
        <h2 style={createWorkspaceSectionTitleStyle(t)}>搜索结果</h2>
        <span style={createWorkspaceSectionNoteStyle(t)}>{items.length} 条匹配{noteSuffix}</span>
      </div>
      <SessionListPanel
        title="搜索结果"
        hideHeader
        items={items}
        activeItemId={selectedNodeId ?? undefined}
        emptyState="当前筛选下没有匹配结果，可以放宽类型筛选或切换来源范围。"
        onSelect={(item) => selectNode(item.id, true)}
      />
    </div>
  );
}
