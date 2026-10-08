import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './main.css';
import { App } from './App';
import { loadRuntimeConfig } from './lib/runtimeConfig';

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');

// Resolve /config.json before the app — and therefore the first
// `apiClient` call — ever mounts, so `apiClient.ts` always sees the real runtime `apiBaseUrl`.
void loadRuntimeConfig().then(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

// Register service worker for PWA offline shell in production
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}
