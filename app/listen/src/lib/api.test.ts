import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectToLoginMock } = vi.hoisted(() => {
  const redirectToLoginMock = vi.fn();
  return { redirectToLoginMock };
});

const { captureApiErrorMock } = vi.hoisted(() => {
  const captureApiErrorMock = vi.fn();
  return { captureApiErrorMock };
});

vi.mock("@/lib/auth-route-policy", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth-route-policy")>();
  return {
    ...actual,
    redirectToLoginOnUnauthorized: redirectToLoginMock,
  };
});

vi.mock("@/lib/platform", () => ({
  usesConfigurableServer: false,
  isTauriRuntime: false,
  getListenAppId: () => "listen-web",
}));

vi.mock("@/lib/listen-device", () => ({
  getListenDeviceFingerprint: () => "fp123",
  getListenDeviceLabel: () => "Test Device",
}));

vi.mock("@/lib/sentry", () => ({
  captureApiError: captureApiErrorMock,
  setSentryUser: vi.fn(),
}));

import {
  apiAssetUrl,
  apiSseUrl,
  apiWsUrl,
  apiUrl,
  getApiBase,
  getAuthToken,
  getAuthTokenExpiresAt,
  getRefreshToken,
  resolveMaybeApiAssetUrl,
  setAuthToken,
  setRefreshToken,
  setAuthTokens,
  getApiAuthHeaders,
  shouldRedirectToLoginOnUnauthorized,
  ensureFreshAuthToken,
  refreshAuthToken,
  apiFetch,
  api,
  AUTH_TOKEN_EVENT,
  ApiError,
} from "@/lib/api";

function mockFetchResponse(status: number, body?: unknown): Response {
  const ok = status >= 200 && status < 300;
  const bodyText =
    body === undefined
      ? ""
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  return {
    ok,
    status,
    text: async () => bodyText,
    json: async () => {
      if (body === undefined || body === null) return {};
      if (typeof body === "string") {
        try {
          return JSON.parse(body);
        } catch {
          return {};
        }
      }
      return body;
    },
  } as Response;
}

function mockJsonResponse(body: unknown): Response {
  return mockFetchResponse(200, body);
}

beforeEach(() => {
  localStorage.clear();
  setAuthToken(null);
  vi.restoreAllMocks();
  redirectToLoginMock.mockClear();
  captureApiErrorMock.mockClear();
});

// ═══════════════════════════════════════════════════════════════════
// getApiBase / apiUrl
// ═══════════════════════════════════════════════════════════════════

describe("getApiBase", () => {
  it("returns empty string for web", () => {
    expect(getApiBase()).toBe("");
  });
});

describe("apiUrl", () => {
  it("returns relative path for web", () => {
    expect(apiUrl("/api/artists")).toBe("/api/artists");
  });

  it("preserves query params", () => {
    expect(apiUrl("/api/search?q=test")).toBe("/api/search?q=test");
  });
});

// ═══════════════════════════════════════════════════════════════════
// shouldRedirectToLoginOnUnauthorized
// ═══════════════════════════════════════════════════════════════════

describe("shouldRedirectToLoginOnUnauthorized", () => {
  it("skips redirect during public auth bootstrap routes", () => {
    expect(shouldRedirectToLoginOnUnauthorized("/login")).toBe(false);
    expect(shouldRedirectToLoginOnUnauthorized("/register")).toBe(false);
    expect(shouldRedirectToLoginOnUnauthorized("/server-setup")).toBe(false);
    expect(shouldRedirectToLoginOnUnauthorized("/auth/callback")).toBe(false);
  });

  it("redirects from protected app routes", () => {
    expect(shouldRedirectToLoginOnUnauthorized("/")).toBe(true);
    expect(shouldRedirectToLoginOnUnauthorized("/stats")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// apiAssetUrl / resolveMaybeApiAssetUrl
// ═══════════════════════════════════════════════════════════════════

describe("apiAssetUrl", () => {
  it("returns relative path unchanged for same-origin web", () => {
    localStorage.setItem("listen-auth-token", "tok");
    expect(apiAssetUrl("/api/cover.jpg")).toBe("/api/cover.jpg");
  });

  it("preserves existing query params without adding token for same-origin", () => {
    localStorage.setItem("listen-auth-token", "tok");
    expect(apiAssetUrl("/api/playlists/1/cover?size=256")).toBe(
      "/api/playlists/1/cover?size=256",
    );
  });

  it("does not leak the bearer to absolute cross-origin API URLs", () => {
    localStorage.setItem("listen-auth-token", "tok");
    expect(apiAssetUrl("https://api.example.com/api/playlists/1/cover")).toBe(
      "https://api.example.com/api/playlists/1/cover",
    );
  });

  it("does not add token to same-origin absolute URLs", () => {
    localStorage.setItem("listen-auth-token", "tok");
    const origin = window.location.origin;
    expect(apiAssetUrl(`${origin}/api/cover.jpg`)).toBe(
      `${origin}/api/cover.jpg`,
    );
  });

  it("removes an existing bearer query param from API assets", () => {
    localStorage.setItem("listen-auth-token", "tok");
    expect(apiAssetUrl("https://api.example.com/api/cover?token=tok")).toBe(
      "https://api.example.com/api/cover",
    );
  });

  it("preserves cross-origin query params without adding a bearer", () => {
    localStorage.setItem("listen-auth-token", "tok");
    expect(apiAssetUrl("https://api.example.com/api/cover?size=256")).toBe(
      "https://api.example.com/api/cover?size=256",
    );
  });

  it("returns URL unchanged when no token is set", () => {
    expect(apiAssetUrl("https://api.example.com/api/cover")).toBe(
      "https://api.example.com/api/cover",
    );
  });

  it("never adds a bearer to arbitrary external URLs", () => {
    localStorage.setItem("listen-auth-token", "tok");
    expect(apiAssetUrl("https://example.com/photo.jpg")).toBe(
      "https://example.com/photo.jpg",
    );
  });
});

describe("resolveMaybeApiAssetUrl", () => {
  it("returns null for null/undefined", () => {
    expect(resolveMaybeApiAssetUrl(null)).toBeNull();
    expect(resolveMaybeApiAssetUrl(undefined)).toBeNull();
  });

  it("leaves data: URLs unchanged", () => {
    expect(resolveMaybeApiAssetUrl("data:image/png;base64,cover")).toBe(
      "data:image/png;base64,cover",
    );
  });

  it("leaves blob: URLs unchanged", () => {
    expect(resolveMaybeApiAssetUrl("blob:abc123")).toBe("blob:abc123");
  });

  it("leaves file: URLs unchanged", () => {
    expect(resolveMaybeApiAssetUrl("file:///storage/cover.jpg")).toBe(
      "file:///storage/cover.jpg",
    );
  });

  it("leaves capacitor: URLs unchanged", () => {
    expect(resolveMaybeApiAssetUrl("capacitor://localhost/cover.jpg")).toBe(
      "capacitor://localhost/cover.jpg",
    );
  });

  it("uses cookies for same-origin API assets", () => {
    localStorage.setItem("listen-auth-token", "listen token");
    expect(resolveMaybeApiAssetUrl("/api/playlists/1/cover")).toBe(
      "/api/playlists/1/cover",
    );
  });

  it("normalizes API asset paths without a leading slash", () => {
    localStorage.setItem("listen-auth-token", "listen token");
    expect(resolveMaybeApiAssetUrl("api/genres/hardcore/cover")).toBe(
      "/api/genres/hardcore/cover",
    );
  });

  it("does not expose the bearer in absolute crate API asset URLs", () => {
    localStorage.setItem("listen-auth-token", "listen-token");
    expect(
      resolveMaybeApiAssetUrl("https://api.example.test/api/playlists/1/cover"),
    ).toBe("https://api.example.test/api/playlists/1/cover");
  });

  it("strips origin from same-origin absolute /api/ URLs", () => {
    localStorage.setItem("listen-auth-token", "tok");
    expect(resolveMaybeApiAssetUrl(`${window.location.origin}/api/cover`)).toBe(
      "/api/cover",
    );
  });

  it("strips base URL from absolute /api/ URLs when base is set", () => {
    // This is tested in native mode below.
  });

  it("leaves external non-API absolute URLs unchanged", () => {
    localStorage.setItem("listen-auth-token", "tok");
    expect(
      resolveMaybeApiAssetUrl("https://example.com/images/photo.jpg"),
    ).toBe("https://example.com/images/photo.jpg");
  });

  it("does not expose the bearer on another absolute API origin", () => {
    localStorage.setItem("listen-auth-token", "tok");
    expect(
      resolveMaybeApiAssetUrl("https://cdn.example.com/api/images/cover.jpg"),
    ).toBe("https://cdn.example.com/api/images/cover.jpg");
  });
});

// ═══════════════════════════════════════════════════════════════════
// apiSseUrl
// ═══════════════════════════════════════════════════════════════════

describe("apiSseUrl", () => {
  it("returns relative path for web", () => {
    expect(apiSseUrl("/api/events")).toBe("/api/events");
  });

  it("returns path with existing query params intact for web", () => {
    expect(apiSseUrl("/api/events?stream=ops")).toBe("/api/events?stream=ops");
  });
});

// ═══════════════════════════════════════════════════════════════════
// apiWsUrl
// ═══════════════════════════════════════════════════════════════════

describe("apiWsUrl", () => {
  it("does not put the bearer in a web socket URL", () => {
    localStorage.setItem("listen-auth-token", "tok");
    const url = apiWsUrl("/api/ws");
    expect(url.startsWith("ws://")).toBe(true);
    expect(url).not.toContain("token=");
  });

  it("returns ws URL without token when absent", () => {
    const url = apiWsUrl("/api/ws");
    expect(url.startsWith("ws://")).toBe(true);
    expect(url).not.toContain("token=");
  });

  it("preserves existing query params without adding a bearer", () => {
    localStorage.setItem("listen-auth-token", "tok");
    const url = apiWsUrl("/api/ws?room=main");
    expect(url).toContain("room=main");
    expect(url).not.toContain("token=");
  });

  it("replaces http with ws in the origin", () => {
    const url = apiWsUrl("/api/ws");
    expect(url).toMatch(/^ws:\/\/.+\/api\/ws$/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// auth tokens
// ═══════════════════════════════════════════════════════════════════

describe("auth tokens", () => {
  it("getAuthToken reads from in-memory web session", () => {
    setAuthToken("abc");
    expect(getAuthToken()).toBe("abc");
  });

  it("getAuthToken returns null when absent", () => {
    expect(getAuthToken()).toBeNull();
  });

  it("getAuthTokenExpiresAt reads from in-memory web session", () => {
    setAuthToken("abc", "2025-01-01T00:00:00.000Z");
    expect(getAuthTokenExpiresAt()).toBe("2025-01-01T00:00:00.000Z");
  });

  it("getAuthTokenExpiresAt returns null when absent", () => {
    expect(getAuthTokenExpiresAt()).toBeNull();
  });

  it("getRefreshToken returns null for web", () => {
    expect(getRefreshToken()).toBeNull();
  });

  it("setAuthToken stores token and emits event", () => {
    const handler = vi.fn();
    window.addEventListener(AUTH_TOKEN_EVENT, handler);
    setAuthToken("new-tok");
    expect(getAuthToken()).toBe("new-tok");
    expect(handler).toHaveBeenCalled();
    window.removeEventListener(AUTH_TOKEN_EVENT, handler);
  });

  it("setAuthToken removes token when null", () => {
    setAuthToken("tmp");
    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
  });

  it("setAuthToken(null) removes expiresAt too", () => {
    setAuthToken("tmp", "2025-06-01T00:00:00Z");
    setAuthToken(null);
    expect(getAuthTokenExpiresAt()).toBeNull();
  });

  it("setRefreshToken is a no-op for web", () => {
    expect(() => setRefreshToken(null)).not.toThrow();
    expect(() => setRefreshToken("ref")).not.toThrow();
  });

  it("setAuthTokens stores token and expiresAt", () => {
    setAuthTokens("tok", null, "2025-06-01T00:00:00.000Z");
    expect(getAuthToken()).toBe("tok");
    expect(getAuthTokenExpiresAt()).toBe("2025-06-01T00:00:00.000Z");
  });

  it("setAuthTokens with null token removes token and expiresAt", () => {
    setAuthTokens("tok", null, "2025-06-01T00:00:00.000Z");
    setAuthTokens(null);
    expect(getAuthToken()).toBeNull();
    expect(getAuthTokenExpiresAt()).toBeNull();
  });

  it("setAuthTokens emits event", () => {
    const handler = vi.fn();
    window.addEventListener(AUTH_TOKEN_EVENT, handler);
    setAuthTokens("tok");
    expect(handler).toHaveBeenCalled();
    window.removeEventListener(AUTH_TOKEN_EVENT, handler);
  });

  it("decodes JWT exp and stores it via setAuthToken", () => {
    const payload = btoa(JSON.stringify({ exp: 1893456000 }));
    const token = `header.${payload}.signature`;
    setAuthToken(token);
    expect(getAuthTokenExpiresAt()).toBe(
      new Date(1893456000 * 1000).toISOString(),
    );
  });

  it("decodes JWT exp with base64url padding via setAuthTokens", () => {
    // base64url of {"exp":1893456000} = eyJleHAiOjE4OTM0NTYwMDB9
    // No padding needed, but proves padding path works
    const payload = btoa(JSON.stringify({ exp: 1893456000 }));
    const token = `h.${payload}.s`;
    setAuthTokens(token);
    expect(getAuthTokenExpiresAt()).toBe(
      new Date(1893456000 * 1000).toISOString(),
    );
  });

  it("handles JWT with invalid payload gracefully", () => {
    const token = "header.not-json.signature";
    setAuthToken(token);
    expect(getAuthToken()).toBe("header.not-json.signature");
    expect(getAuthTokenExpiresAt()).toBeNull();
  });

  it("handles JWT with missing exp claim gracefully", () => {
    const payload = btoa(JSON.stringify({ sub: "user" }));
    const token = `header.${payload}.signature`;
    setAuthToken(token);
    expect(getAuthTokenExpiresAt()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// getApiAuthHeaders
// ═══════════════════════════════════════════════════════════════════

describe("getApiAuthHeaders", () => {
  it("omits bearer token on web even when a token is present", () => {
    localStorage.setItem("listen-auth-token", "tok");
    const headers = getApiAuthHeaders();
    expect(headers).not.toHaveProperty("Authorization");
  });

  it("omits Authorization header when token absent", () => {
    const headers = getApiAuthHeaders();
    expect(headers).not.toHaveProperty("Authorization");
  });

  it("includes device headers", () => {
    const headers = getApiAuthHeaders();
    expect(headers["X-Crate-App"]).toBe("listen-web");
    expect(headers["X-Device-Label"]).toBe("Test Device");
    expect(headers["X-Device-Fingerprint"]).toBe("fp123");
  });
});

// ═══════════════════════════════════════════════════════════════════
// refreshAuthToken
// ═══════════════════════════════════════════════════════════════════

describe("refreshAuthToken", () => {
  it("returns false on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network"));
    expect(await refreshAuthToken()).toBe(false);
  });

  it("returns false on 401 and clears token", async () => {
    localStorage.setItem("listen-auth-token", "old");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(401));
    expect(await refreshAuthToken()).toBe(false);
    expect(getAuthToken()).toBeNull();
  });

  it("clears stale web cookies after refresh rejects the session", async () => {
    localStorage.setItem("listen-auth-token", "old");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFetchResponse(401))
      .mockResolvedValueOnce(mockFetchResponse(200));

    expect(await refreshAuthToken()).toBe(false);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });

  it("returns false on 400 and clears token", async () => {
    localStorage.setItem("listen-auth-token", "old");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(400));
    expect(await refreshAuthToken()).toBe(false);
    expect(getAuthToken()).toBeNull();
  });

  it("returns false on 403 and clears token", async () => {
    localStorage.setItem("listen-auth-token", "old");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(403));
    expect(await refreshAuthToken()).toBe(false);
    expect(getAuthToken()).toBeNull();
  });

  it("returns true and stores new token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockJsonResponse({
        token: "new-tok",
        access_expires_at: "2025-01-01T00:00:00Z",
      }),
    );
    expect(await refreshAuthToken()).toBe(true);
    expect(getAuthToken()).toBe("new-tok");
  });

  it("returns true and stores new token with refresh_token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockJsonResponse({
        token: "new-tok",
        refresh_token: "new-refresh",
        access_expires_at: "2025-01-01T00:00:00Z",
      }),
    );
    expect(await refreshAuthToken()).toBe(true);
    expect(getAuthToken()).toBe("new-tok");
  });

  it("returns false when response has no token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse({}));
    expect(await refreshAuthToken()).toBe(false);
  });

  it("returns false when response JSON is malformed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("invalid JSON");
      },
    } as unknown as Response);
    expect(await refreshAuthToken()).toBe(false);
  });

  it("deduplicates concurrent refresh calls", async () => {
    let resolveFirst: (value: Response) => void;
    const firstFetch = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(firstFetch)
      .mockResolvedValueOnce(
        mockJsonResponse({
          token: "concurrent-tok",
          access_expires_at: "2025-01-01T00:00:00Z",
        }),
      );

    const first = refreshAuthToken();
    const second = refreshAuthToken();

    resolveFirst!(
      mockJsonResponse({
        token: "concurrent-tok",
        access_expires_at: "2025-01-01T00:00:00Z",
      }),
    );

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reuses failed refresh promise across concurrent callers", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network"));

    const [r1, r2] = await Promise.all([
      refreshAuthToken(),
      refreshAuthToken(),
    ]);
    expect(r1).toBe(false);
    expect(r2).toBe(false);
  });
});

describe("ensureFreshAuthToken", () => {
  it("does not refresh when the access token has enough lifetime left", async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    setAuthTokens("fresh-token", null, expiresAt);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await ensureFreshAuthToken()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes when the access token is close to expiry", async () => {
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    setAuthTokens("stale-token", null, expiresAt);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockJsonResponse({
        token: "refreshed-token",
        access_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    );

    expect(await ensureFreshAuthToken()).toBe(true);
    expect(getAuthToken()).toBe("refreshed-token");
  });
});

// ═══════════════════════════════════════════════════════════════════
// api()
// ═══════════════════════════════════════════════════════════════════

describe("api", () => {
  it("returns parsed JSON on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockJsonResponse({ artists: [] }),
    );
    const result = await api<{ artists: unknown[] }>("/api/artists");
    expect(result).toEqual({ artists: [] });
  });

  it("returns null for empty 200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockFetchResponse(200, ""),
    );
    const result = await api("/api/ping");
    expect(result).toBeNull();
  });

  it("sends POST with JSON body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockJsonResponse({ id: "new" }));

    await api("/api/playlists", "POST", { name: "My List" });

    const call = fetchSpy.mock.calls[0]!;
    expect(call[1]?.method).toBe("POST");
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(call[1]?.body).toBe(JSON.stringify({ name: "My List" }));
  });

  it("throws ApiError on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse(404, "Not found"),
    );
    const promise = api("/api/missing");
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ status: 404 });
  });

  it("refreshes token on 401 and retries successfully", async () => {
    localStorage.setItem("listen-auth-token", "old-tok");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      // First API call → 401
      .mockResolvedValueOnce(mockFetchResponse(401, "Unauthorized"))
      // Refresh call → 200 with new token
      .mockResolvedValueOnce(mockJsonResponse({ token: "new-tok" }))
      // Retry API call → 200
      .mockResolvedValueOnce(mockJsonResponse({ data: "ok" }));

    const result = await api("/api/protected");
    expect(result).toEqual({ data: "ok" });
    expect(getAuthToken()).toBe("new-tok");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("redirects to login when 401 refresh fails", async () => {
    localStorage.setItem("listen-auth-token", "old-tok");
    // Set pathname so shouldRedirectToLoginOnUnauthorized returns true
    Object.defineProperty(window, "location", {
      value: { pathname: "/dashboard" },
      writable: true,
      configurable: true,
    });

    vi.spyOn(globalThis, "fetch")
      // API call → 401
      .mockResolvedValueOnce(mockFetchResponse(401, "Unauthorized"))
      // Refresh call → 401
      .mockResolvedValueOnce(mockFetchResponse(401));

    await expect(api("/api/protected")).rejects.toBeInstanceOf(ApiError);
    expect(redirectToLoginMock).toHaveBeenCalled();
  });

  it("does not attempt refresh on /api/auth/login 401", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFetchResponse(401, "Bad credentials"));

    await expect(
      api("/api/auth/login", "POST", { email: "a@b.com" }),
    ).rejects.toBeInstanceOf(ApiError);

    // Only 1 call — no refresh was attempted
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not attempt refresh on /api/auth/register 401", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFetchResponse(401));

    await expect(api("/api/auth/register", "POST", {})).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not attempt refresh on /api/auth/refresh 401", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFetchResponse(401));

    await expect(api("/api/auth/refresh", "POST", {})).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not attempt refresh on /api/auth/logout 401", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFetchResponse(401));

    await expect(api("/api/auth/logout", "POST")).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("redirects on 401 for auth routes (no refresh attempted)", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/login" },
      writable: true,
      configurable: true,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockFetchResponse(401, "Unauthorized"),
    );

    // path is not an auth API path but shouldAttemptRefresh checks the path, not window.location
    await expect(api("/api/admin/settings")).rejects.toBeInstanceOf(ApiError);
    expect(redirectToLoginMock).toHaveBeenCalled();
  });

  it("rejects immediately when AbortSignal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      api("/api/data", "GET", undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

// ═══════════════════════════════════════════════════════════════════
// apiFetch
// ═══════════════════════════════════════════════════════════════════

describe("apiFetch", () => {
  it("returns response on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(200));
    const res = await apiFetch("/api/test");
    expect(res.status).toBe(200);
  });

  it("refreshes token on 401 and retries", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFetchResponse(401))
      .mockResolvedValueOnce(mockJsonResponse({ token: "refreshed" }))
      .mockResolvedValueOnce(mockFetchResponse(200));

    const res = await apiFetch("/api/test");
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does not refresh on auth routes", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFetchResponse(401));

    const res = await apiFetch("/api/auth/refresh");
    expect(res.status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("merges init headers with auth headers", async () => {
    localStorage.setItem("listen-auth-token", "tok");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFetchResponse(200));

    await apiFetch("/api/data", {
      headers: { "X-Custom": "value" },
    });

    const headers = fetchSpy.mock.calls[0]![1]?.headers as Record<
      string,
      string
    >;
    expect(headers["X-Custom"]).toBe("value");
    expect(headers).not.toHaveProperty("Authorization");
    expect(headers["X-Crate-App"]).toBe("listen-web");
  });

  it("passes credentials option", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFetchResponse(200));

    await apiFetch("/api/data");

    expect(fetchSpy.mock.calls[0]![1]?.credentials).toBe("include");
  });

  it("redirects on final 401 after failed refresh", async () => {
    localStorage.setItem("listen-auth-token", "old-tok");
    Object.defineProperty(window, "location", {
      value: { pathname: "/dashboard" },
      writable: true,
      configurable: true,
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFetchResponse(401))
      .mockResolvedValueOnce(mockFetchResponse(401));

    await apiFetch("/api/protected");
    expect(redirectToLoginMock).toHaveBeenCalled();
  });

  it("reports final apiFetch HTTP failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(503));

    await apiFetch("/api/health", { method: "POST" });

    expect(captureApiErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 503 }),
      expect.objectContaining({
        method: "POST",
        url: "/api/health",
        status: 503,
      }),
    );
  });

  it("reports apiFetch network failures and rethrows them", async () => {
    const error = new TypeError("Failed to fetch");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(error);

    await expect(apiFetch("/api/health")).rejects.toBe(error);
    expect(captureApiErrorMock).toHaveBeenCalledWith(error, {
      method: "GET",
      url: "/api/health",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Native (configurable server) mode
// ═══════════════════════════════════════════════════════════════════

describe("native (configurable server) mode", () => {
  let apiMod: typeof import("@/lib/api");
  let serverStore: typeof import("@/lib/server-store");
  let mediaAccess: typeof import("@/lib/media-access");

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@/lib/platform", () => ({
      usesConfigurableServer: true,
      isTauriRuntime: false,
      isCapacitorRuntime: true,
      getListenAppId: () => "listen-capacitor",
    }));
    vi.doMock("@/lib/listen-device", () => ({
      getListenDeviceFingerprint: () => "fp-native",
      getListenDeviceLabel: () => "Native Device",
    }));
    // Reset the redirect mock so api.ts re-imports it
    vi.doMock("@/lib/auth-route-policy", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@/lib/auth-route-policy")>();
      return {
        ...actual,
        redirectToLoginOnUnauthorized: vi.fn(),
      };
    });
    localStorage.clear();
    apiMod = await import("@/lib/api");
    serverStore = await import("@/lib/server-store");
    mediaAccess = await import("@/lib/media-access");
  });

  function setupServer(url = "https://api.example.com", token = "native-tok") {
    const s = serverStore.addServer(url);
    serverStore.setCurrentServerId(s.id);
    serverStore.setCurrentServerToken(token);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    mediaAccess.setMediaAccessTickets(
      [
        {
          audience: "artwork",
          path: "/api/cover.jpg",
          ticket: "artwork-ticket",
          expires_at: expiresAt,
        },
        {
          audience: "artwork",
          path: "/api/network/external-artist/photo",
          ticket: "artwork-ticket",
          expires_at: expiresAt,
        },
        {
          audience: "artwork",
          path: "/api/genres/hardcore/cover",
          ticket: "artwork-ticket",
          expires_at: expiresAt,
        },
        {
          audience: "stream",
          path: "/api/tracks/1/stream",
          ticket: "stream-ticket",
          expires_at: expiresAt,
        },
        {
          audience: "sse",
          path: "/api/events",
          ticket: "sse-ticket",
          expires_at: expiresAt,
        },
        {
          audience: "ws",
          path: "/api/ws",
          ticket: "ws-ticket",
          expires_at: expiresAt,
        },
      ],
      s.id,
    );
    return s;
  }

  describe("getApiBase", () => {
    it("returns empty when no server configured", () => {
      expect(apiMod.getApiBase()).toBe("");
    });

    it("returns server URL when configured", () => {
      setupServer();
      expect(apiMod.getApiBase()).toBe("https://api.example.com");
    });
  });

  describe("apiUrl", () => {
    it("prepends server base URL", () => {
      setupServer();
      expect(apiMod.apiUrl("/api/artists")).toBe(
        "https://api.example.com/api/artists",
      );
    });

    it("returns relative when no server configured", () => {
      expect(apiMod.apiUrl("/api/artists")).toBe("/api/artists");
    });
  });

  describe("apiSseUrl", () => {
    it("appends an SSE-scoped ticket", () => {
      setupServer();
      expect(apiMod.apiSseUrl("/api/events")).toBe(
        "https://api.example.com/api/events?media_ticket=sse-ticket",
      );
    });

    it("uses & separator when URL already has query params", () => {
      setupServer();
      expect(apiMod.apiSseUrl("/api/events?stream=ops")).toBe(
        "https://api.example.com/api/events?stream=ops&media_ticket=sse-ticket",
      );
    });

    it("returns URL without token when no token set", () => {
      setupServer("https://api.example.com", "" as unknown as string);
      serverStore.setCurrentServerToken(null);
      expect(apiMod.apiSseUrl("/api/events")).toBe(
        "https://api.example.com/api/events",
      );
    });
  });

  describe("apiAssetUrl", () => {
    it("marks protected URLs usable only after a credential is attached", () => {
      setupServer();
      mediaAccess.clearMediaAccessTickets();

      expect(
        apiMod.isUsableMediaAssetUrl(
          "https://api.example.com/api/albums/1/cover?size=256",
        ),
      ).toBe(false);
      expect(
        apiMod.isUsableMediaAssetUrl(
          "https://api.example.com/api/albums/1/cover?size=256&media_ticket=fresh",
        ),
      ).toBe(true);
      expect(
        apiMod.isUsableMediaAssetUrl("https://cdn.example.net/cover.webp"),
      ).toBe(true);
      expect(
        apiMod.requiresMediaAccessTicket(
          "https://api.example.com/api/albums/1/cover?size=256",
        ),
      ).toBe(true);
      expect(
        apiMod.requiresMediaAccessTicket(
          "https://cdn.example.net/api/albums/1/cover",
        ),
      ).toBe(false);
    });

    it("never reuses an artwork ticket for another API path", () => {
      setupServer();

      expect(apiMod.apiAssetUrl("/api/cover.jpg")).toContain(
        "media_ticket=artwork-ticket",
      );
      expect(apiMod.apiAssetUrl("/api/artists/99/photo")).toBe(
        "https://api.example.com/api/artists/99/photo",
      );
    });

    it("never sends a media ticket to another absolute origin", () => {
      setupServer();

      expect(apiMod.apiAssetUrl("https://cdn.example.net/api/cover.jpg")).toBe(
        "https://cdn.example.net/api/cover.jpg",
      );
    });

    it("waits until its own ticket batch completes during concurrent recovery", async () => {
      setupServer();
      mediaAccess.clearMediaAccessTickets();
      let releaseFirst: (() => void) | undefined;
      const firstRequestPending = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let releaseSecond: (() => void) | undefined;
      const secondRequestPending = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      const requestedBatches: Array<
        Array<{ audience: "artwork"; path: string }>
      > = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          targets: Array<{ audience: "artwork"; path: string }>;
        };
        requestedBatches.push(body.targets);
        if (requestedBatches.length === 1) await firstRequestPending;
        if (requestedBatches.length === 2) await secondRequestPending;
        return mockJsonResponse({
          tickets: body.targets.map((target) => ({
            ...target,
            ticket: `ticket:${target.path}`,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          })),
        });
      });

      const first = apiMod.ensureMediaAccessUrl(
        "/api/albums/1/cover",
        "artwork",
        { forceRefresh: true },
      );
      await vi.waitFor(() => expect(requestedBatches).toHaveLength(1));
      const second = apiMod.ensureMediaAccessUrl(
        "/api/albums/2/cover",
        "artwork",
        { forceRefresh: true },
      );
      releaseFirst?.();
      await vi.waitFor(() => expect(requestedBatches).toHaveLength(2));
      releaseSecond?.();

      await expect(first).resolves.toContain(
        "media_ticket=ticket%3A%2Fapi%2Falbums%2F1%2Fcover",
      );
      await expect(second).resolves.toContain(
        "media_ticket=ticket%3A%2Fapi%2Falbums%2F2%2Fcover",
      );
      expect(requestedBatches.flat()).toEqual(
        expect.arrayContaining([
          { audience: "artwork", path: "/api/albums/1/cover" },
          { audience: "artwork", path: "/api/albums/2/cover" },
        ]),
      );
    });

    it("appends an artwork-scoped ticket for configurable servers", () => {
      setupServer();
      expect(apiMod.apiAssetUrl("/api/cover.jpg")).toBe(
        "https://api.example.com/api/cover.jpg?media_ticket=artwork-ticket",
      );
    });

    it("appends with & when query params exist", () => {
      setupServer();
      expect(apiMod.apiAssetUrl("/api/cover.jpg?size=256")).toBe(
        "https://api.example.com/api/cover.jpg?size=256&media_ticket=artwork-ticket",
      );
    });

    it("replaces a legacy bearer query with the scoped ticket", () => {
      setupServer();
      expect(
        apiMod.apiAssetUrl(
          "https://api.example.com/api/cover.jpg?token=native-tok",
        ),
      ).toBe(
        "https://api.example.com/api/cover.jpg?media_ticket=artwork-ticket",
      );
    });

    it("returns URL unchanged when no token", () => {
      setupServer("https://api.example.com", "" as unknown as string);
      serverStore.setCurrentServerToken(null);
      expect(apiMod.apiAssetUrl("/api/cover.jpg")).toBe(
        "https://api.example.com/api/cover.jpg",
      );
    });

    it("does not reuse an artwork ticket after switching servers", () => {
      setupServer("https://api-a.example.com");
      const serverB = serverStore.addServer("https://api-b.example.com");
      serverStore.setCurrentServerId(serverB.id);
      serverStore.setCurrentServerToken("server-b-token");

      expect(apiMod.apiAssetUrl("/api/cover.jpg")).toBe(
        "https://api-b.example.com/api/cover.jpg",
      );
    });
  });

  describe("media access refresh", () => {
    it("keeps media tickets when only the current access token changes", () => {
      setupServer();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          tickets: [],
        }),
      );
      const stop = apiMod.startMediaAccessTicketRefresh();
      expect(apiMod.apiAssetUrl("/api/cover.jpg")).toContain(
        "media_ticket=artwork-ticket",
      );

      serverStore.setCurrentServerToken("rotated-access-token");

      expect(apiMod.apiAssetUrl("/api/cover.jpg")).toContain(
        "media_ticket=artwork-ticket",
      );
      stop();
    });

    it("starts immediate artwork recovery without refreshing historical targets", async () => {
      setupServer();
      const initialResumeVersion = mediaAccess.getMediaAccessResumeVersion();
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          tickets: [],
        }),
      );
      const stop = apiMod.startMediaAccessTicketRefresh();

      window.dispatchEvent(new CustomEvent("crate:app-resumed"));

      await vi.waitFor(() =>
        expect(mediaAccess.getMediaAccessResumeVersion()).toBe(
          initialResumeVersion + 1,
        ),
      );
      await Promise.resolve();
      expect(fetchMock).not.toHaveBeenCalled();

      stop();
    });

    it("invalidates cached artwork credentials before mounted images resume", async () => {
      setupServer();
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          tickets: [],
        }),
      );
      const stop = apiMod.startMediaAccessTicketRefresh();
      expect(apiMod.apiAssetUrl("/api/cover.jpg")).toContain(
        "media_ticket=artwork-ticket",
      );

      window.dispatchEvent(new CustomEvent("crate:app-resumed"));

      expect(apiMod.apiAssetUrl("/api/cover.jpg")).toBe(
        "https://api.example.com/api/cover.jpg",
      );
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      stop();
    });

    it("requests a missing ticket for the exact path without blocking URL generation", async () => {
      const server = setupServer();
      mediaAccess.clearMediaAccessTickets();
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockJsonResponse({
          tickets: [
            {
              audience: "artwork",
              path: "/api/artists/99/photo",
              ticket: "artist-photo-ticket",
              expires_at: expiresAt,
            },
          ],
        }),
      );

      expect(apiMod.apiAssetUrl("/api/artists/99/photo")).toBe(
        "https://api.example.com/api/artists/99/photo",
      );

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(String(init?.body))).toEqual({
        targets: [
          {
            audience: "artwork",
            path: "/api/artists/99/photo",
          },
        ],
      });
      expect(
        mediaAccess.getMediaAccessTicket(
          "artwork",
          "/api/artists/99/photo",
          server.id,
        ),
      ).toBe("artist-photo-ticket");
      expect(apiMod.apiAssetUrl("/api/artists/99/photo")).toBe(
        "https://api.example.com/api/artists/99/photo?media_ticket=artist-photo-ticket",
      );
    });

    it("exchanges the bearer through an Authorization header", async () => {
      const server = setupServer();
      mediaAccess.clearMediaAccessTickets();
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockJsonResponse({
          tickets: [
            {
              audience: "artwork",
              path: "/api/albums/12/cover",
              ticket: "fresh-artwork-ticket",
              expires_at: expiresAt,
            },
          ],
        }),
      );

      await expect(
        apiMod.refreshMediaAccessTickets([
          {
            audience: "artwork",
            path: "/api/albums/12/cover",
          },
        ]),
      ).resolves.toBe(true);

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.example.com/api/auth/media-access",
        expect.objectContaining({
          method: "POST",
          credentials: "omit",
          headers: expect.objectContaining({
            Authorization: "Bearer native-tok",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            targets: [
              {
                audience: "artwork",
                path: "/api/albums/12/cover",
              },
            ],
          }),
        }),
      );
      expect(
        mediaAccess.getMediaAccessTicket(
          "artwork",
          "/api/albums/12/cover",
          server.id,
        ),
      ).toBe("fresh-artwork-ticket");
    });

    it("waits for a cold exact-path ticket before returning a protected URL", async () => {
      mediaAccess.clearMediaAccessTickets();
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockJsonResponse({
          tickets: [
            {
              audience: "stream",
              path: "/api/tracks/42/stream",
              ticket: "cold-stream-ticket",
              expires_at: expiresAt,
            },
          ],
        }),
      );
      setupServer();
      mediaAccess.clearMediaAccessTickets();

      await expect(
        apiMod.ensureMediaAccessUrl(
          "/api/tracks/42/stream?delivery=balanced",
          "stream",
        ),
      ).resolves.toBe(
        "https://api.example.com/api/tracks/42/stream?delivery=balanced&media_ticket=cold-stream-ticket",
      );
    });

    it("deduplicates concurrent ticket acquisition for the same target", async () => {
      const server = setupServer();
      mediaAccess.clearMediaAccessTickets();
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          tickets: [
            {
              audience: "artwork",
              path: "/api/albums/42/cover",
              ticket: "shared-artwork-ticket",
              expires_at: expiresAt,
            },
          ],
        }),
      );

      const [first, second] = await Promise.all([
        apiMod.ensureMediaAccessUrl("/api/albums/42/cover", "artwork"),
        apiMod.ensureMediaAccessUrl("/api/albums/42/cover", "artwork"),
      ]);

      expect(first).toContain("media_ticket=shared-artwork-ticket");
      expect(second).toContain("media_ticket=shared-artwork-ticket");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        mediaAccess.getMediaAccessTicket(
          "artwork",
          "/api/albums/42/cover",
          server.id,
        ),
      ).toBe("shared-artwork-ticket");
    });

    it("preserves each caller query while sharing concurrent ticket acquisition", async () => {
      setupServer();
      mediaAccess.clearMediaAccessTickets();
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          tickets: [
            {
              audience: "artwork",
              path: "/api/albums/42/cover",
              ticket: "shared-responsive-ticket",
              expires_at: expiresAt,
            },
          ],
        }),
      );

      const [small, large] = await Promise.all([
        apiMod.ensureMediaAccessUrl(
          "/api/albums/42/cover?size=160&format=webp",
          "artwork",
        ),
        apiMod.ensureMediaAccessUrl(
          "/api/albums/42/cover?size=480&format=webp",
          "artwork",
        ),
      ]);

      expect(small).toContain("size=160");
      expect(large).toContain("size=480");
      expect(small).toContain("media_ticket=shared-responsive-ticket");
      expect(large).toContain("media_ticket=shared-responsive-ticket");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects instead of returning an unticketed protected URL", async () => {
      setupServer();
      mediaAccess.clearMediaAccessTickets();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockFetchResponse(503),
      );

      await expect(
        apiMod.ensureMediaAccessUrl("/api/tracks/42/stream", "stream"),
      ).rejects.toMatchObject({
        name: "MediaAccessTicketError",
        audience: "stream",
        path: "/api/tracks/42/stream",
      });
    });
  });

  describe("apiStreamUrl", () => {
    it("uses a stream-scoped ticket without exposing the bearer", () => {
      setupServer();
      expect(
        apiMod.apiStreamUrl("/api/tracks/1/stream?delivery=balanced"),
      ).toBe(
        "https://api.example.com/api/tracks/1/stream?delivery=balanced&media_ticket=stream-ticket",
      );
    });
  });

  describe("apiWsUrl", () => {
    it("uses server base as ws:// origin", () => {
      setupServer();
      const url = apiMod.apiWsUrl("/api/ws");
      expect(url).toBe("wss://api.example.com/api/ws?media_ticket=ws-ticket");
    });

    it("returns ws URL without token when absent", () => {
      setupServer("https://api.example.com", "" as unknown as string);
      serverStore.setCurrentServerToken(null);
      expect(apiMod.apiWsUrl("/api/ws")).toBe("wss://api.example.com/api/ws");
    });
  });

  describe("resolveMaybeApiAssetUrl", () => {
    it("strips base URL prefix from absolute API URLs", () => {
      setupServer();
      const result = apiMod.resolveMaybeApiAssetUrl(
        "https://api.example.com/api/cover.jpg",
      );
      expect(result).toBe(
        "https://api.example.com/api/cover.jpg?media_ticket=artwork-ticket",
      );
    });

    it("keeps public external artist photos stable across ticket rotations", () => {
      setupServer();
      const result = apiMod.resolveMaybeApiAssetUrl(
        "/api/network/external-artist/photo?name=Slowthai",
      );
      expect(result).toBe(
        "https://api.example.com/api/network/external-artist/photo?name=Slowthai",
      );
      expect(apiMod.requiresMediaAccessTicket(result)).toBe(false);
    });

    it("resolves genre cover fallbacks against the configured server", () => {
      setupServer();
      const result = apiMod.resolveMaybeApiAssetUrl(
        "api/genres/hardcore/cover?size=1280&format=webp",
      );
      expect(result).toBe(
        "https://api.example.com/api/genres/hardcore/cover?size=1280&format=webp&media_ticket=artwork-ticket",
      );
    });
  });

  describe("auth tokens (native)", () => {
    it("getAuthToken reads from server config", () => {
      setupServer();
      expect(apiMod.getAuthToken()).toBe("native-tok");
    });

    it("getAuthToken returns null when no current server", () => {
      expect(apiMod.getAuthToken()).toBeNull();
    });

    it("getAuthTokenExpiresAt reads from server config", () => {
      setupServer();
      serverStore.setCurrentServerToken("tok", "2025-06-01T00:00:00Z");
      expect(apiMod.getAuthTokenExpiresAt()).toBe("2025-06-01T00:00:00Z");
    });

    it("getRefreshToken reads from server config", () => {
      setupServer();
      serverStore.setCurrentServerRefreshToken("native-refresh");
      expect(apiMod.getRefreshToken()).toBe("native-refresh");
    });

    it("getRefreshToken returns null when no refresh token", () => {
      setupServer();
      expect(apiMod.getRefreshToken()).toBeNull();
    });

    it("setAuthToken stores on current server", () => {
      setupServer();
      apiMod.setAuthToken("updated-tok");
      expect(apiMod.getAuthToken()).toBe("updated-tok");
    });

    it("setAuthToken(null) clears token on current server", () => {
      setupServer();
      apiMod.setAuthToken(null);
      expect(apiMod.getAuthToken()).toBeNull();
    });

    it("setRefreshToken stores refresh token on server", () => {
      setupServer();
      apiMod.setRefreshToken("new-refresh");
      expect(apiMod.getRefreshToken()).toBe("new-refresh");
    });

    it("setRefreshToken(null) clears refresh token on server", () => {
      setupServer();
      serverStore.setCurrentServerRefreshToken("old-refresh");
      apiMod.setRefreshToken(null);
      expect(apiMod.getRefreshToken()).toBeNull();
    });

    it("setAuthTokens with undefined refresh token updates only access token", () => {
      setupServer();
      serverStore.setCurrentServerRefreshToken("existing-refresh");
      apiMod.setAuthTokens("new-access");
      expect(apiMod.getAuthToken()).toBe("new-access");
      expect(apiMod.getRefreshToken()).toBe("existing-refresh");
    });

    it("setAuthTokens with explicit refresh token null clears it", () => {
      setupServer();
      serverStore.setCurrentServerRefreshToken("old-refresh");
      apiMod.setAuthTokens("new-access", null);
      expect(apiMod.getRefreshToken()).toBeNull();
    });

    it("setAuthTokens emits auth token change event", () => {
      setupServer();
      const handler = vi.fn();
      window.addEventListener(apiMod.AUTH_TOKEN_EVENT, handler);
      apiMod.setAuthTokens("tok");
      expect(handler).toHaveBeenCalled();
      window.removeEventListener(apiMod.AUTH_TOKEN_EVENT, handler);
    });

    it("setAuthToken emits auth token change event", () => {
      setupServer();
      const handler = vi.fn();
      window.addEventListener(apiMod.AUTH_TOKEN_EVENT, handler);
      apiMod.setAuthToken("tok");
      expect(handler).toHaveBeenCalled();
      window.removeEventListener(apiMod.AUTH_TOKEN_EVENT, handler);
    });
  });

  describe("getApiAuthHeaders (native)", () => {
    it("includes native device headers", () => {
      setupServer();
      const headers = apiMod.getApiAuthHeaders();
      expect(headers["Authorization"]).toBe("Bearer native-tok");
      expect(headers["X-Crate-App"]).toBe("listen-capacitor");
      expect(headers["X-Device-Label"]).toBe("Native Device");
      expect(headers["X-Device-Fingerprint"]).toBe("fp-native");
    });

    it("omits Authorization when no token", () => {
      const headers = apiMod.getApiAuthHeaders();
      expect(headers).not.toHaveProperty("Authorization");
    });
  });
});
