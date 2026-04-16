import { useEffect, useRef } from 'react';
import { useGraphStore, setSearchTerm, setServerSearchLoading, setServerSearchHits, setServerSearchError, clearServerSearch } from '../store/graphStore.js';
import { getSearchMatches } from '../graph/visibility.js';
import { searchNodes } from '../api/index.js';
import type { SearchHitMeta } from '../store/types.js';
import {
  createWorkspaceFieldLabelStyle,
  workspaceFieldStyle,
  workspaceSectionHeaderStyle,
  createWorkspaceSectionNoteStyle,
  createWorkspaceSectionStyle,
  createWorkspaceSectionTitleStyle,
  createWorkspaceSelectLikeStyle,
} from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 1;

export function SearchSection() {
  const t = useTokens();
  const searchTerm = useGraphStore((s) => s.searchTerm);
  const data = useGraphStore((s) => s.data);
  const selectedSourceKey = useGraphStore((s) => s.selectedSourceKey);
  const serverSearchLoading = useGraphStore((s) => s.serverSearchLoading);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced server search
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!searchTerm || searchTerm.trim().length < MIN_QUERY_LENGTH || !selectedSourceKey) {
      if (!searchTerm) clearServerSearch();
      return;
    }

    timerRef.current = setTimeout(async () => {
      setServerSearchLoading();
      const requestId = useGraphStore.getState().serverSearchRequestId;

      const result = await searchNodes(selectedSourceKey, searchTerm.trim());
      const currentRequestId = useGraphStore.getState().serverSearchRequestId;

      if (requestId !== currentRequestId) return; // stale

      if (result) {
        const hitMap = new Map<string, SearchHitMeta>();
        for (const hit of result.hits) {
          hitMap.set(hit.id, {
            score: hit.score,
            text_match: hit.text_match,
            vector_match: hit.vector_match,
            similarity: hit.similarity,
          });
        }
        setServerSearchHits(hitMap, requestId);
      } else {
        setServerSearchError(requestId);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [searchTerm, selectedSourceKey]);

  const countText = data
    ? (() => {
        const allMatches = getSearchMatches(useGraphStore.getState());
        const matches = allMatches.slice(0, 60);
        const suffix = serverSearchLoading ? '...' : '';
        return allMatches.length > matches.length
          ? `前 ${matches.length} / ${allMatches.length} 项${suffix}`
          : `${allMatches.length} 项${suffix}`;
      })()
    : '0 项';

  return (
    <div style={createWorkspaceSectionStyle(t)}>
      <div style={workspaceSectionHeaderStyle}>
        <h2 style={createWorkspaceSectionTitleStyle(t)}>检索</h2>
        <span style={createWorkspaceSectionNoteStyle(t)}>{countText}</span>
      </div>
      <label style={workspaceFieldStyle}>
        <span style={createWorkspaceFieldLabelStyle(t)}>搜索节点</span>
        <input
          type="search"
          placeholder="输入知识点、物质、实验、方法..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={createWorkspaceSelectLikeStyle(t)}
        />
      </label>
    </div>
  );
}
