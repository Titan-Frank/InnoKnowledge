import { AppStateProvider } from './hooks/useAppState';
import { useBootData } from './hooks/useBootData';
import { Header } from './components/Header';
import { FilterPanel } from './components/FilterPanel';
import { GraphCanvas } from './components/GraphCanvas';
import { DetailPanel } from './components/DetailPanel';
import { StatusBar } from './components/StatusBar';
import { PipelineDebugPage } from './components/PipelineDebugPage';
import { TextbookTreePage } from './components/TextbookTreePage';
import { GraphSearchPanel } from './components/GraphSearchPanel';
import { PgAdminPage } from './components/PgAdminPage';
import { useAppState } from './hooks/useAppState';
import { PUBLIC_ARTIFACT_MODE } from './lib/runtime';

function AppContent() {
  useBootData();
  const { workspace } = useAppState();

  return (
    <div className="okm-app-shell flex h-screen flex-col overflow-hidden text-text-primary">
      <Header />
      {workspace === 'pipeline' ? (
        <PipelineDebugPage />
      ) : workspace === 'pg' ? (
        <PgAdminPage />
      ) : workspace === 'textbook' ? (
        <TextbookTreePage />
      ) : (
        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <FilterPanel />
          <div className="relative order-1 min-h-[220px] min-w-0 flex-1 sm:min-h-[320px] lg:order-none lg:min-h-0">
            <GraphCanvas />
            {!PUBLIC_ARTIFACT_MODE && <GraphSearchPanel />}
          </div>
          <DetailPanel />
        </main>
      )}
      <StatusBar />
    </div>
  );
}

export function App() {
  return (
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  );
}
