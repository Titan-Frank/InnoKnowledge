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
  workspaceSectionNoteStyle,
  workspaceSectionStyle,
  workspaceSectionTitleStyle,
} from './workspaceStyles.js';

export function SearchResultList() {
  const searchTerm = useGraphStore((s) => s.searchTerm);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectedBook = useGraphStore((s) => s.selectedBook);
  const layerMode = useGraphStore((s) => s.layerMode);
  const focusConnected = useGraphStore((s) => s.focusConnected);
  const expandedBackboneNodeId = useGraphStore((s) => s.expandedBackboneNodeId);

  const matches = useMemo(() => {
    return getSearchMatches(useGraphStore.getState()).slice(0, 60);
  }, [searchTerm, selectedNodeId, selectedBook, layerMode, focusConnected, expandedBackboneNodeId]);

  const items: SessionListItem[] = matches.map((node) => ({
    id: node.id,
    title: node.name,
    description: getTypeLabel(node.node_type),
    meta: node.id,
    badge: NODE_LAYER_LABELS[node.node_layer] ?? humanizeKey(node.node_layer),
  }));

  return (
    <div style={workspaceSectionStyle}>
      <div style={workspaceSectionHeaderStyle}>
        <h2 style={workspaceSectionTitleStyle}>搜索结果</h2>
        <span style={workspaceSectionNoteStyle}>{items.length} 条匹配</span>
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
