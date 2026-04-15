import { useGraphStore, setSearchTerm } from '../store/graphStore.js';
import { getSearchMatches } from '../graph/visibility.js';
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

export function SearchSection() {
  const t = useTokens();
  const searchTerm = useGraphStore((s) => s.searchTerm);
  const data = useGraphStore((s) => s.data);

  const countText = data
    ? (() => {
        const allMatches = getSearchMatches(useGraphStore.getState());
        const matches = allMatches.slice(0, 60);
        return allMatches.length > matches.length
          ? `前 ${matches.length} / ${allMatches.length} 项`
          : `${allMatches.length} 项`;
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
