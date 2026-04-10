import { StatsGrid } from './StatsGrid.js';

export function TopBar() {
  return (
    <header className="topbar fade-in">
      <div className="topbar-copy">
        <p className="eyebrow">Knowledge Backbone Viewer</p>
        <h1>知识主干网络浏览器</h1>
        <p className="lede">
          通过本地 SQLite API 读取 canonical nodes、edges、framework、patterns、mentions
          与 evidence，生成一个可交互的本地知识网络界面。
        </p>
      </div>
      <StatsGrid />
    </header>
  );
}
