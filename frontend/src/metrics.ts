// Lightweight frontend metrics — batches events and ships them to FastAPI /frontend-metrics.
// Everything is best-effort: if the backend is unreachable the app keeps working.

const BACKEND = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8001';
const FLUSH_MS = 20_000; // flush every 20 s
const SESSION_KEY = 'bb_sid';

// ── Session ───────────────────────────────────────────────────────────────────

function sessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

// Track how many browser tabs are active (rough approximation via BroadcastChannel).
const _activeSessions = new Set<string>([sessionId()]);
try {
  const bc = new BroadcastChannel('bb_sessions');
  bc.postMessage({ type: 'hello', id: sessionId() });
  bc.onmessage = (e) => {
    if (e.data?.type === 'hello') _activeSessions.add(e.data.id);
    if (e.data?.type === 'bye')   _activeSessions.delete(e.data.id);
  };
  window.addEventListener('beforeunload', () => {
    bc.postMessage({ type: 'bye', id: sessionId() });
  });
} catch {
  // BroadcastChannel not supported — single-session fallback
}

// ── Event queue ───────────────────────────────────────────────────────────────

interface MetricEvent {
  type: 'page_load' | 'button_click' | 'api_call' | 'error';
  page?: string;
  button?: string;
  duration_ms?: number;
  method?: string;
  endpoint?: string;
  status?: number;
  error_type?: string;
}

let _queue: MetricEvent[] = [];

function enqueue(ev: MetricEvent): void {
  _queue.push(ev);
}

async function flush(): Promise<void> {
  if (_queue.length === 0) return;
  const events = _queue.splice(0);
  try {
    await fetch(`${BACKEND}/frontend-metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events, active_sessions: _activeSessions.size }),
      keepalive: true,
    });
  } catch {
    // drop silently — metrics are best-effort
  }
}

setInterval(flush, FLUSH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});

// ── Public API ────────────────────────────────────────────────────────────────

/** Call once on initial hard load (reads Performance Navigation Timing). */
export function trackPageLoad(page: string): void {
  const nav = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  const duration_ms = nav
    ? Math.round(nav.domInteractive - nav.startTime)
    : Math.round(performance.now());
  enqueue({ type: 'page_load', page, duration_ms });
}

/** Call on every SPA route change (no timing needed — just a counter). */
export function trackPageView(page: string): void {
  enqueue({ type: 'page_load', page });
}

/** Call when a tracked button is clicked. */
export function trackClick(button: string): void {
  enqueue({ type: 'button_click', button });
}

/** Call from axios interceptors with the round-trip time. */
export function trackApiCall(
  method: string,
  endpoint: string,
  status: number,
  duration_ms: number,
): void {
  // Normalise dynamic path segments so metrics don't explode: /auth/login stays as-is,
  // /trips/abc-123 becomes /trips/{id}.
  const clean = endpoint.replace(/\/[0-9a-f-]{8,}/gi, '/{id}');
  enqueue({ type: 'api_call', method: method.toUpperCase(), endpoint: clean, status, duration_ms });
}

/** Call from window.onerror / unhandledrejection handlers. */
export function trackError(error_type: string): void {
  enqueue({ type: 'error', error_type });
}
