export { ApiError } from "../../../shared/web/api";

import { createApiClient } from "../../../shared/web/api";
import { isNative, platform } from "@/lib/capacitor";
import {
  getCurrentServer,
  migrateLegacyToken,
  setCurrentServerToken,
} from "@/lib/server-store";

/**
 * Default URL used when no server has been configured yet in a native
 * build. Taken from the build-time env so the APK ships with a sensible
 * first choice (the reference cratemusic.app instance) while still
 * letting the user point the app at their own server.
 */
const BUILD_TIME_DEFAULT = import.meta.env.VITE_API_URL || "";

// Run the legacy-token migration once on module load. It's a no-op
// after the first time and on fresh installs.
migrateLegacyToken(BUILD_TIME_DEFAULT);

/**
 * Resolve the active API base URL.
 *
 *   - Web: empty string. Listen Web is same-origin with its backend
 *     (proxied by Caddy/Traefik). Relative fetches are correct.
 *   - Capacitor: the URL of the current server from the server-store,
 *     or the build-time default if no server is configured yet (which
 *     happens only during first boot before ServerSetup runs).
 *
 * This is re-evaluated on every call so switching servers in-flight
 * takes effect for the next request without a reload.
 */
export function getApiBase(): string {
  if (!isNative) return "";
  const server = getCurrentServer();
  return server?.url || BUILD_TIME_DEFAULT;
}

/**
 * @deprecated use getApiBase() — kept as a compatibility shim for a
 * couple of call sites that still expect a constant. Returns the value
 * at import time; prefer the getter for anything long-lived.
 */
export const API_BASE = getApiBase();

/** Resolve an API path to a full URL. Use for raw fetch() calls and stream URLs. */
export function apiUrl(path: string): string {
  return `${getApiBase()}${path}`;
}

/** Resolve an API path to a full WebSocket URL. */
export function apiWsUrl(path: string): string {
  const base = getApiBase();
  const baseOrigin = base
    ? base.replace(/^http/i, "ws")
    : window.location.origin.replace(/^http/i, "ws");
  const token = getAuthToken();
  if (!token) return `${baseOrigin}${path}`;
  const separator = path.includes("?") ? "&" : "?";
  return `${baseOrigin}${path}${separator}token=${encodeURIComponent(token)}`;
}

// ── Auth token ──────────────────────────────────────────────────────
//
// In Capacitor, the token lives on the ServerConfig — every server can
// have its own session. On web, the token is stored in localStorage.

export function getAuthToken(): string | null {
  if (isNative) return getCurrentServer()?.token ?? null;
  try { return localStorage.getItem("listen-auth-token"); } catch { return null; }
}

export function setAuthToken(token: string | null) {
  if (isNative) { setCurrentServerToken(token); return; }
  try {
    if (token) localStorage.setItem("listen-auth-token", token);
    else localStorage.removeItem("listen-auth-token");
  } catch {}
}

export function getApiAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  headers["X-Crate-App"] = isNative ? `listen-${platform}` : "listen-web";
  if (isNative) {
    headers["X-Device-Label"] = `${platform === "ios" ? "iPhone" : platform === "android" ? "Android" : "Native"} (Listen)`;
  }
  return headers;
}

// The shared api client is created ONCE, but we want the base URL to be
// re-read on every request so server switches are live. We pass a
// base-URL getter and wrap calls through our own thin proxy.
const innerApi = createApiClient({
  credentials: "include",
  defaultHeaders: getApiAuthHeaders,
  onUnauthorized: () => {
    if (window.location.pathname !== "/login" && window.location.pathname !== "/server-setup") {
      window.location.href = "/login";
    }
  },
});

export function api<T = unknown>(path: string, method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
  return innerApi<T>(`${getApiBase()}${path}`, method, body, options);
}

/** fetch() wrapper that adds API base URL and auth headers. Fire-and-forget friendly. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> || {}),
    ...getApiAuthHeaders(),
  };
  return fetch(`${getApiBase()}${path}`, { ...init, credentials: "include", headers });
}
