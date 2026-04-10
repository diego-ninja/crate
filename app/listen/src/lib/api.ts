export { ApiError } from "../../../shared/web/api";

import { createApiClient } from "../../../shared/web/api";
import { isNative } from "@/lib/capacitor";

/** Base URL for the backend API. Empty string in web (relative paths),
 *  full URL in Capacitor builds. */
export const API_BASE = import.meta.env.VITE_API_URL || "";

/** Resolve an API path to a full URL. Use for raw fetch() calls and stream URLs. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/** fetch() wrapper that adds API base URL and auth headers. Fire-and-forget friendly. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> || {}),
    ...authHeaders(),
  };
  return fetch(`${API_BASE}${path}`, { ...init, credentials: "include", headers });
}

// ── Token storage for Capacitor (cookies don't work cross-origin) ──

const TOKEN_KEY = "crate-auth-token";

export function getAuthToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setAuthToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

/** Build headers with Bearer token for native, nothing for web (uses cookies). */
function authHeaders(): Record<string, string> {
  if (!isNative) return {};
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const api = createApiClient({
  base: API_BASE,
  credentials: "include",
  defaultHeaders: authHeaders(),
  onUnauthorized: () => {
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  },
});

/** Refreshed api call that picks up the latest token (for post-login calls). */
export function authedApi<T = unknown>(
  url: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  // Re-create with fresh headers every call in native
  if (!isNative) return api<T>(url, method, body);
  const freshApi = createApiClient({
    base: API_BASE,
    credentials: "include",
    defaultHeaders: authHeaders(),
  });
  return freshApi<T>(url, method, body);
}
