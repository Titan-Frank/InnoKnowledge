import { AppStateProvider } from './hooks/useAppState';
import { useBootData } from './hooks/useBootData';
import { Header } from './components/Header';
import { FilterPanel } from './components/FilterPanel';
import { GraphCanvas } from './components/GraphCanvas';
import { DetailPanel } from './components/DetailPanel';
import { StatusBar } from './components/StatusBar';

function AppContent() {
  useBootData();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-void text-text-primary">
      <Header />
      <main className="flex min-h-0 flex-1">
        <FilterPanel />
        <div className="relative min-w-0 flex-1">
          <GraphCanvas />
        </div>
        <DetailPanel />
      </main>
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
