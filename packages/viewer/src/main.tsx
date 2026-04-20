import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// Set initial theme
const stored = localStorage.getItem('okm-theme');
if (stored === 'light' || stored === 'dark') {
  document.documentElement.dataset.theme = stored;
} else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
  document.documentElement.dataset.theme = 'light';
} else {
  document.documentElement.dataset.theme = 'dark';
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
