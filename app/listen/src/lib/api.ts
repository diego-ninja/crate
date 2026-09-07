import { ApiError, createApiClient } from "../../../shared/web/api";

export { ApiError };
import { shouldRedirectToLoginOnUnauthorized } from "@/lib/auth-route-policy";
import { isTauriRuntime, usesConfigurableServer } from "@/lib/platform";
import {
  getCurrentServer,
  migrateLegacyToken,
  seedDefaultServer,
} from "@/lib/server-store";
import {
  AUTH_TOKEN_EVENT,
  getApiAuthHeaders,
  getAuthToken,
  getAuthTokenExpiresAt,
  getRefreshToken,
  setAuthTokens as setSessionAuthTokens,
  setRefreshToken,
} from "@/lib/auth-session";
import {
  clearMediaAccessTickets,
  getMediaAccessTicket,
  type MediaAccessAudience,
} from "@/lib/media-access";
import {
  ensureMediaAccessUrl as ensureMediaAccessUrlInternal,
  MediaAccessTicketError,
  queueMediaAccessTarget,
  refreshMediaAccessTickets,
  startMediaAccessTicketRefresh,
} from "@/lib/api-media-access";
import { createApiUrlResolver } from "@/lib/api-url-resolver";
import { createApiAuthTransport } from "@/lib/api-auth-transport";
import { captureApiError } from "@/lib/sentry";

export {
  AUTH_TOKEN_EVENT,
  getApiAuthHeaders,
  getAuthToken,
  getAuthTokenExpiresAt,
  getRefreshToken,
  setRefreshToken,
  MediaAccessTicketError,
  refreshMediaAccessTickets,
  startMediaAccessTicketRefresh,
};

/**
 * Development-only desktop convenience. Release builds must not ship with a
 * preconfigured server; users should choose their own Crate instance.
 */
const DEV_TAURI_DEFAULT_SERVER = "https://api.lespedants.org";
const BUILD_TIME_DEFAULT =
  import.meta.env.DEV && isTauriRuntime ? DEV_TAURI_DEFAULT_SERVER : "";

// Run the legacy-token migration once on module load. It's a no-op
// after the first time and on fresh installs.
migrateLegacyToken(BUILD_TIME_DEFAULT);
seedDefaultServer(BUILD_TIME_DEFAULT);

/**
 * Resolve the active API base URL.
 *
 *   - Web: empty string. Listen Web is same-origin with its backend
 *     (proxied by Caddy/Traefik). Relative fetches are correct.
 *   - Configurable runtimes: the URL of the current server from the
 *     server-store. Tauri dev also gets a local development default so
 *     desktop iteration starts directly against prod-like API.
 *
 * This is re-evaluated on every call so switching servers in-flight
 * takes effect for the next request without a reload.
 */
export function getApiBase(): string {
  if (!usesConfigurableServer) return "";
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

function apiCredentials(): RequestCredentials {
  return usesConfigurableServer ? "omit" : "include";
}

const apiUrlResolver = createApiUrlResolver({
  apiUrl,
  getApiBase,
  getCurrentServer,
  getMediaAccessTicket,
  queueMediaAccessTarget,
  usesConfigurableServer,
});

export const {
  apiAssetUrl,
  apiSseUrl,
  apiStreamUrl,
  apiWsUrl,
  isApiUrl,
  isUsableMediaAssetUrl,
  requiresMediaAccessTicket,
  resolveMaybeApiAssetUrl,
  resolveMaybeApiStreamUrl,
  withMediaAccessTicket,
} = apiUrlResolver;

/**
 * Resolve a protected media URL only after its exact-path ticket is available.
 *
 * Synchronous URL helpers remain suitable for lazy page artwork, where a
 * ticket refresh can trigger a rerender. Audio engines and other connection
 * boundaries must use this function so they never receive a cold unticketed
 * URL in configurable-server runtimes.
 */
export async function ensureMediaAccessUrl(
  url: string,
  audience: MediaAccessAudience,
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  return ensureMediaAccessUrlInternal(url, audience, options, {
    resolveApiUrl: apiUrl,
    isApiUrl,
    withMediaAccessTicket,
  });
}

export function setAuthToken(
  token: string | null,
  accessExpiresAt?: string | null,
): void {
  setAuthTokens(token, token ? undefined : null, accessExpiresAt);
}

export function setAuthTokens(
  token: string | null,
  refreshToken?: string | null,
  accessExpiresAt?: string | null,
): void {
  setSessionAuthTokens(token, refreshToken, accessExpiresAt);
  if (usesConfigurableServer) {
    if (!token) clearMediaAccessTickets();
    else void refreshMediaAccessTickets();
  }
}
export { shouldRedirectToLoginOnUnauthorized };

if (typeof window !== "undefined") {
  (
    window as Window &
      typeof globalThis & {
        __crateResolveApiAssetUrl?: (path: string) => string;
      }
  ).__crateResolveApiAssetUrl = apiAssetUrl;
}

// The shared api client is created ONCE, but we want the base URL to be
// re-read on every request so server switches are live. We pass a
// base-URL getter and wrap calls through our own thin proxy.
const innerApi = createApiClient({
  credentials: apiCredentials(),
  defaultHeaders: getApiAuthHeaders,
  onError: captureApiError,
});

const apiAuthTransport = createApiAuthTransport({
  apiBase: getApiBase,
  apiClient: innerApi,
  apiCredentials,
  getApiAuthHeaders,
  getAuthToken,
  getAuthTokenExpiresAt,
  getRefreshToken,
  setAuthToken,
  setAuthTokens,
  usesConfigurableServer,
});

export const api = apiAuthTransport.api;
export const ensureFreshAuthToken = apiAuthTransport.ensureFreshAuthToken;
export const refreshAuthToken = apiAuthTransport.refreshAuthToken;
export const apiFetch = async (
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  const method = init?.method || "GET";
  const url = `${getApiBase()}${path}`;
  try {
    const response = await apiAuthTransport.apiFetch(path, init);
    if (!response.ok) {
      captureApiError(
        new ApiError(
          response.status,
          response.statusText || "HTTP request failed",
        ),
        { method, url, status: response.status },
      );
    }
    return response;
  } catch (error) {
    captureApiError(error, { method, url });
    throw error;
  }
};
