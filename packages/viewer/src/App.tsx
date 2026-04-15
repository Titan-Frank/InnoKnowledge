import { Component, type ReactNode } from 'react';
import { useBootData } from './hooks/useBootData.js';
import { AppShell } from './components/AppShell.js';
import { useGraphStore } from './store/graphStore.js';
import { getTokens } from './components/aiwc/styles/tokens.js';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const mode = useGraphStore.getState().themeMode;
      const t = getTokens(mode);
      return (
        <div style={{ padding: 32, color: t.colorDanger, background: t.colorPage }}>
          <h2>渲染错误</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>
            {this.state.error?.message}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: t.colorMuted }}>
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  useBootData();
  return <AppShell />;
}

export function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
