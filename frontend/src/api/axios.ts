import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { trackApiCall } from '../metrics';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request: attach token + start timer ───────────────────────────────────────

interface TimedConfig extends InternalAxiosRequestConfig {
  _t?: number;
  _retry?: boolean;
}

api.interceptors.request.use((config: TimedConfig) => {
  const token = localStorage.getItem('access_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config._t = Date.now();
  return config;
});

// ── Response: record timing + handle 401 refresh ──────────────────────────────

api.interceptors.response.use(
  (response) => {
    const cfg = response.config as TimedConfig;
    const elapsed = Date.now() - (cfg._t ?? Date.now());
    trackApiCall(
      cfg.method ?? 'GET',
      cfg.url ?? '/',
      response.status,
      elapsed,
    );
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as TimedConfig | undefined;

    // Always record the failed call timing
    if (originalRequest) {
      const elapsed = Date.now() - (originalRequest._t ?? Date.now());
      trackApiCall(
        originalRequest.method ?? 'GET',
        originalRequest.url ?? '/',
        error.response?.status ?? 0,
        elapsed,
      );
    }

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });

        localStorage.setItem('access_token', data.access_token);
        if (data.refresh_token) {
          localStorage.setItem('refresh_token', data.refresh_token);
        }

        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
        return api(originalRequest);
      } catch {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

export default api;

// ── Driver Service API (Service 2 — port 8002) ────────────────────────────────
const DRIVER_URL = import.meta.env.VITE_DRIVER_SERVICE_URL || 'http://localhost:8002';

export const driverApi = axios.create({
  baseURL: DRIVER_URL,
  headers: { 'Content-Type': 'application/json' },
});

driverApi.interceptors.request.use((config: TimedConfig) => {
  const token = localStorage.getItem('access_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
