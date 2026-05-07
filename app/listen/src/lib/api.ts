import { ApiError, createApiClient } from "../../../shared/web/api";

export { ApiError };
import { redirectToLoginOnUnauthorized, shouldRedirectToLoginOnUnauthorized } from "@/lib/auth-route-policy";
import { isNative, platform } from "@/lib/capacitor";
import {
  getCurrentServer,
  migrateLegacyToken,
  setCurrentServerAuthTokens,
  setCurrentServerRefreshToken,
  setCurrentServerToken,
} from "@/lib/server-store";
import { getListenDeviceFingerprint, getListenDeviceLabel } from "@/lib/listen-device";

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

function isAbsoluteHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function hasQueryParam(url: string, name: string): boolean {
  try {
    const parsed = new URL(
      url,
      typeof window !== "undefined" ? window.location.origin : "https://crate.local",
    );
    return parsed.searchParams.has(name);
  } catch {
    return new RegExp(`[?&]${name}=`).test(url);
  }
}

/** Resolve an SSE path to a full URL, adding auth token for native clients. */
export function apiSseUrl(path: string): string {
  const token = getAuthToken();
  if (!token) return apiUrl(path);
  const separator = path.includes("?") ? "&" : "?";
  return `${getApiBase()}${path}${separator}token=${encodeURIComponent(token)}`;
}

/** Resolve an API media path to a full URL, adding auth token for <img>/<video> requests. */
export function apiAssetUrl(path: string): string {
  const baseUrl = isAbsoluteHttpUrl(path) ? path : apiUrl(path);
  const token = getAuthToken();
  if (!token) return baseUrl;
  if (hasQueryParam(baseUrl, "token")) return baseUrl;
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
}

export function resolveMaybeApiAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (
    url.startsWith("data:")
    || url.startsWith("blob:")
    || url.startsWith("file:")
    || url.startsWith("capacitor:")
  ) {
    return url;
  }
  if (url.startsWith("/api/")) return apiAssetUrl(url);

  const base = getApiBase();
  if (base && url.startsWith(`${base}/api/`)) {
    const relative = url.slice(base.length);
    return apiAssetUrl(relative);
  }

  if (typeof window !== "undefined" && url.startsWith(`${window.location.origin}/api/`)) {
    const relative = url.slice(window.location.origin.length);
    return apiAssetUrl(relative);
  }

  if (isAbsoluteHttpUrl(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith("/api/")) return apiAssetUrl(url);
    } catch {
      // Leave malformed external URLs untouched.
    }
  }

  return url;
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

export function getRefreshToken(): string | null {
  if (isNative) return getCurrentServer()?.refreshToken ?? null;
  return null;
}

export function setAuthToken(token: string | null) {
  setAuthTokens(token, token ? undefined : null);
}

export function setRefreshToken(refreshToken: string | null) {
  if (isNative) { setCurrentServerRefreshToken(refreshToken); return; }
  try {
    localStorage.removeItem("listen-auth-refresh-token");
  } catch {
    // ignore persistence failures
  }
}

export function setAuthTokens(token: string | null, refreshToken?: string | null) {
  if (isNative) {
    if (refreshToken === undefined) setCurrentServerToken(token);
    else setCurrentServerAuthTokens(token, refreshToken);
    return;
  }
  try {
    if (token) localStorage.setItem("listen-auth-token", token);
    else localStorage.removeItem("listen-auth-token");
    if (refreshToken !== undefined && refreshToken === null) {
      localStorage.removeItem("listen-auth-refresh-token");
    }
  } catch {
    // ignore persistence failures
  }
}

export function getApiAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  headers["X-Crate-App"] = isNative ? `listen-${platform}` : "listen-web";
  headers["X-Device-Label"] = getListenDeviceLabel();
  headers["X-Device-Fingerprint"] = getListenDeviceFingerprint();
  return headers;
}
export { shouldRedirectToLoginOnUnauthorized };

if (typeof window !== "undefined") {
  (window as Window & typeof globalThis & {
    __crateResolveApiAssetUrl?: (path: string) => string;
  }).__crateResolveApiAssetUrl = apiAssetUrl;
}

// The shared api client is created ONCE, but we want the base URL to be
// re-read on every request so server switches are live. We pass a
// base-URL getter and wrap calls through our own thin proxy.
const innerApi = createApiClient({
  credentials: "include",
  defaultHeaders: getApiAuthHeaders,
});

let refreshPromise: Promise<boolean> | null = null;

function shouldAttemptRefresh(path: string): boolean {
  return !path.includes("/api/auth/login")
    && !path.includes("/api/auth/register")
    && !path.includes("/api/auth/refresh")
    && !path.includes("/api/auth/logout");
}

function redirectAfterUnauthorized(): void {
  redirectToLoginOnUnauthorized(window.location.pathname, (path) => {
    window.location.href = path;
  });
}

export async function refreshAuthToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    const headers = getApiAuthHeaders();
    headers["Content-Type"] = "application/json";
    const response = await fetch(`${getApiBase()}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
    }).catch(() => null);
    if (!response?.ok) {
      setAuthToken(null);
      return false;
    }
    const data = await response.json().catch(() => null) as { token?: string; refresh_token?: string | null } | null;
    if (!data?.token) {
      setAuthToken(null);
      return false;
    }
    setAuthTokens(data.token, data.refresh_token ?? undefined);
    return true;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export function api<T = unknown>(path: string, method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
  return innerApi<T>(`${getApiBase()}${path}`, method, body, options).catch(async (error) => {
    if (error instanceof ApiError && error.status === 401 && shouldAttemptRefresh(path) && await refreshAuthToken()) {
      return innerApi<T>(`${getApiBase()}${path}`, method, body, options);
    }
    if (error instanceof ApiError && error.status === 401) {
      redirectAfterUnauthorized();
    }
    throw error;
  });
}

/** fetch() wrapper that adds API base URL and auth headers. Fire-and-forget friendly. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> || {}),
    ...getApiAuthHeaders(),
  };
  const request = () => fetch(`${getApiBase()}${path}`, { ...init, credentials: "include", headers });
  let response = await request();
  if (response.status === 401 && shouldAttemptRefresh(path) && await refreshAuthToken()) {
    response = await fetch(`${getApiBase()}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init?.headers as Record<string, string> || {}),
        ...getApiAuthHeaders(),
      },
    });
  }
  if (response.status === 401) {
    redirectAfterUnauthorized();
  }
  return response;
}
