import { useGraphStore } from '../store/graphStore.js';
import { TopBar } from './TopBar.js';
import { Sidebar } from './Sidebar.js';
import { GraphStage } from './GraphStage.js';
import { DetailPanel } from './DetailPanel.js';

export function AppShell() {
  const data = useGraphStore((s) => s.data);
  const sourceLoading = useGraphStore((s) => s.sourceLoading);

  if (!data && !sourceLoading) {
    return (
      <div className="app-shell" style={{ padding: 64, textAlign: 'center', color: 'var(--iaie-text-3)' }}>
        <p>正在连接数据源...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app-shell" style={{ padding: 64, textAlign: 'center', color: 'var(--iaie-text-3)' }}>
        <p>数据加载中...</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopBar />
      <div className="workspace">
        <Sidebar />
        <GraphStage />
        <DetailPanel />
      </div>
    </div>
  );
}
