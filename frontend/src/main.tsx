import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { trackError, trackPageLoad } from './metrics'

// ── Global error capture ──────────────────────────────────────────────────────
window.addEventListener('error', (e) => {
  trackError(e.error?.name ?? 'Error');
});

window.addEventListener('unhandledrejection', () => {
  trackError('UnhandledPromiseRejection');
});

// ── Initial hard-load page timing ─────────────────────────────────────────────
trackPageLoad(window.location.pathname);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
