import { ApiError } from "../../../shared/web/api";
import { redirectToLoginOnUnauthorized } from "@/lib/auth-route-policy";

type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ApiClient = <T = unknown>(
  path: string,
  method?: ApiMethod,
  body?: unknown,
  options?: { signal?: AbortSignal },
) => Promise<T>;

export interface ApiAuthTransportDependencies {
  apiBase: () => string;
  apiClient: ApiClient;
  apiCredentials: () => RequestCredentials;
  getApiAuthHeaders: () => Record<string, string>;
  getAuthToken: () => string | null;
  getAuthTokenExpiresAt: () => string | null;
  getRefreshToken: () => string | null;
  setAuthToken: (token: string | null, accessExpiresAt?: string | null) => void;
  setAuthTokens: (
    token: string | null,
    refreshToken?: string | null,
    accessExpiresAt?: string | null,
  ) => void;
  usesConfigurableServer: boolean;
}

export interface ApiAuthTransport {
  api: ApiClient;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  ensureFreshAuthToken: (minValidityMs?: number) => Promise<boolean>;
  refreshAuthToken: () => Promise<boolean>;
}

const AUTH_TOKEN_FRESHNESS_MARGIN_MS = 10 * 60 * 1000;

export function createApiAuthTransport(
  dependencies: ApiAuthTransportDependencies,
): ApiAuthTransport {
  let refreshPromise: Promise<boolean> | null = null;

  const shouldAttemptRefresh = (path: string): boolean =>
    !path.includes("/api/auth/login") &&
    !path.includes("/api/auth/register") &&
    !path.includes("/api/auth/refresh") &&
    !path.includes("/api/auth/logout");

  const redirectAfterUnauthorized = (): void => {
    redirectToLoginOnUnauthorized(window.location.pathname, (path) => {
      window.location.href = path;
    });
  };

  const clearRejectedWebSession = async (): Promise<void> => {
    if (dependencies.usesConfigurableServer) return;
    await fetch(`${dependencies.apiBase()}/api/auth/logout`, {
      method: "POST",
      credentials: dependencies.apiCredentials(),
      headers: dependencies.getApiAuthHeaders(),
    }).catch(() => {
      // The session is already unusable; a network failure should not block auth recovery.
    });
  };

  const refreshAuthToken = async (): Promise<boolean> => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const refreshToken = dependencies.getRefreshToken();
      const headers = dependencies.getApiAuthHeaders();
      headers["Content-Type"] = "application/json";
      const response = await fetch(
        `${dependencies.apiBase()}/api/auth/refresh`,
        {
          method: "POST",
          credentials: dependencies.apiCredentials(),
          headers,
          body: JSON.stringify(
            refreshToken ? { refresh_token: refreshToken } : {},
          ),
        },
      ).catch(() => null);
      if (!response) return false;
      if (!response.ok) {
        if ([400, 401, 403].includes(response.status)) {
          dependencies.setAuthToken(null);
          await clearRejectedWebSession();
        }
        return false;
      }
      const data = (await response.json().catch(() => null)) as {
        token?: string;
        access_expires_at?: string | null;
        refresh_token?: string | null;
      } | null;
      if (!data?.token) {
        dependencies.setAuthToken(null);
        await clearRejectedWebSession();
        return false;
      }
      dependencies.setAuthTokens(
        data.token,
        data.refresh_token ?? undefined,
        data.access_expires_at ?? undefined,
      );
      return true;
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  };

  const ensureFreshAuthToken = async (
    minValidityMs = AUTH_TOKEN_FRESHNESS_MARGIN_MS,
  ): Promise<boolean> => {
    const token = dependencies.getAuthToken();
    if (!token) return true;

    const expiresAt = dependencies.getAuthTokenExpiresAt();
    if (!expiresAt) return true;

    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs)) return true;

    if (expiresMs - Date.now() > minValidityMs) return true;
    return refreshAuthToken();
  };

  const api = <T = unknown>(
    path: string,
    method?: ApiMethod,
    body?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<T> =>
    dependencies
      .apiClient<T>(`${dependencies.apiBase()}${path}`, method, body, options)
      .catch(async (error) => {
        if (
          error instanceof ApiError &&
          error.status === 401 &&
          shouldAttemptRefresh(path) &&
          (await refreshAuthToken())
        ) {
          return dependencies.apiClient<T>(
            `${dependencies.apiBase()}${path}`,
            method,
            body,
            options,
          );
        }
        if (error instanceof ApiError && error.status === 401) {
          redirectAfterUnauthorized();
        }
        throw error;
      });

  const apiFetch = async (
    path: string,
    init?: RequestInit,
  ): Promise<Response> => {
    const requestHeaders = (): Record<string, string> => ({
      ...((init?.headers as Record<string, string>) || {}),
      ...dependencies.getApiAuthHeaders(),
    });
    const request = () =>
      fetch(`${dependencies.apiBase()}${path}`, {
        ...init,
        credentials: dependencies.apiCredentials(),
        headers: requestHeaders(),
      });
    let response = await request();
    if (
      response.status === 401 &&
      shouldAttemptRefresh(path) &&
      (await refreshAuthToken())
    ) {
      response = await request();
    }
    if (response.status === 401) redirectAfterUnauthorized();
    return response;
  };

  return {
    api,
    apiFetch,
    ensureFreshAuthToken,
    refreshAuthToken,
  };
}
