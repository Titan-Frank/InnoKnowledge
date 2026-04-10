import { useGraphStore, setSearchTerm } from '../store/graphStore.js';
import { getSearchMatches } from '../graph/visibility.js';

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
    <section className="panel-section">
      <div className="section-head">
        <h2>检索</h2>
        <span className="section-note">{countText}</span>
      </div>
      <label className="field">
        <span>搜索节点</span>
        <input
          type="search"
          placeholder="输入知识点、物质、实验、方法..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </label>
    </section>
  );
}
