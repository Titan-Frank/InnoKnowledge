import { useGraphStore, setSearchTerm } from '../store/graphStore.js';
import { getSearchMatches } from '../graph/visibility.js';
import {
  workspaceFieldLabelStyle,
  workspaceFieldStyle,
  workspaceSectionHeaderStyle,
  workspaceSectionNoteStyle,
  workspaceSectionStyle,
  workspaceSectionTitleStyle,
  workspaceSelectLikeStyle,
} from './workspaceStyles.js';

export function SearchSection() {
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
    <div style={workspaceSectionStyle}>
      <div style={workspaceSectionHeaderStyle}>
        <h2 style={workspaceSectionTitleStyle}>检索</h2>
        <span style={workspaceSectionNoteStyle}>{countText}</span>
      </div>
      <label style={workspaceFieldStyle}>
        <span style={workspaceFieldLabelStyle}>搜索节点</span>
        <input
          type="search"
          placeholder="输入知识点、物质、实验、方法..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={workspaceSelectLikeStyle}
        />
      </label>
    </div>
  );
}
