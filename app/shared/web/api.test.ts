import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./api";

const originalFetch = globalThis.fetch;

function mockFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      }),
    ),
  ) as typeof globalThis.fetch;
}

function mockFetchText(status: number, text: string) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(new Response(text, { status })),
  ) as typeof globalThis.fetch;
}

function fetchSpy() {
  return globalThis.fetch as ReturnType<typeof vi.fn>;
}

function firstFetchCall(): [RequestInfo | URL, RequestInit | undefined] {
  const call = fetchSpy().mock.calls[0];
  if (!call) {
    throw new Error("Expected fetch to have been called");
  }
  return call as [RequestInfo | URL, RequestInit | undefined];
}

function firstFetchInit(): RequestInit {
  const init = firstFetchCall()[1];
  if (!init) {
    throw new Error("Expected fetch to have request init options");
  }
  return init;
}

describe("ApiError", () => {
  it("stores status and message", () => {
    const err = new ApiError(404, "Not found");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not found");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("createApiClient", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("makes a GET request and returns parsed JSON", async () => {
    mockFetch(200, { tracks: [{ id: 1 }] });
    const api = createApiClient();

    const data = await api<{ tracks: { id: number }[] }>("/api/tracks");

    expect(data).toEqual({ tracks: [{ id: 1 }] });
    expect(fetchSpy()).toHaveBeenCalledWith("/api/tracks", {
      method: "GET",
      headers: {},
    });
  });

  it("prepends base URL to requests", async () => {
    mockFetch(200, { ok: true });
    const api = createApiClient({ base: "https://example.com" });

    await api("/api/test");

    expect(fetchSpy()).toHaveBeenCalledWith(
      "https://example.com/api/test",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sends credentials when configured", async () => {
    mockFetch(200, { ok: true });
    const api = createApiClient({ credentials: "include" });

    await api("/api/test");

    expect(fetchSpy()).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("sends POST with JSON body and Content-Type header", async () => {
    mockFetch(201, { id: 42 });
    const api = createApiClient();

    const data = await api<{ id: number }>("/api/create", "POST", {
      name: "test",
    });

    expect(data).toEqual({ id: 42 });
    const call = firstFetchCall();
    expect(call[0]).toBe("/api/create");
    const init = firstFetchInit();
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ name: "test" });
  });

  it("sends POST with FormData body without Content-Type header", async () => {
    mockFetch(201, { ok: true });
    const api = createApiClient();
    const form = new FormData();
    form.append("file", new Blob(["content"]), "test.txt");

    await api("/api/upload", "POST", form);

    const init = firstFetchInit();
    expect(init.body).toBe(form);
    expect(
      (init.headers as Record<string, string>)["Content-Type"],
    ).toBeUndefined();
  });

  it("uses defaultHeaders as static object", async () => {
    mockFetch(200, { ok: true });
    const api = createApiClient({
      defaultHeaders: { "X-Test": "value" },
    });

    await api("/api/test");

    const init = firstFetchInit();
    expect((init.headers as Record<string, string>)["X-Test"]).toBe("value");
  });

  it("uses defaultHeaders as a function", async () => {
    mockFetch(200, { ok: true });
    const headersFn = vi.fn(() => ({ Authorization: "Bearer token" }));
    const api = createApiClient({ defaultHeaders: headersFn });

    await api("/api/test");

    expect(headersFn).toHaveBeenCalledTimes(1);
    const init = firstFetchInit();
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token",
    );
  });

  it("throws ApiError on non-ok response", async () => {
    mockFetchText(500, "Internal error");
    const api = createApiClient();

    await expect(api("/api/fail")).rejects.toThrow(ApiError);
    await expect(api("/api/fail")).rejects.toMatchObject({
      status: 500,
      message: "Internal error",
    });
  });

  it("exposes Retry-After on API errors", async () => {
    mockFetch(503, { detail: "catalog_warming" }, { "Retry-After": "3" });
    const api = createApiClient();

    await expect(api("/api/catalog/search")).rejects.toMatchObject({
      status: 503,
      retryAfterMs: 3_000,
    });
  });

  it("calls onUnauthorized on 401 and does not call it for /auth/login", async () => {
    mockFetchText(401, "Unauthorized");
    const onUnauthorized = vi.fn();
    const api = createApiClient({ onUnauthorized });

    await expect(api("/api/protected")).rejects.toThrow(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    onUnauthorized.mockClear();
    await expect(api("/api/auth/login", "POST", {})).rejects.toThrow(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("does not call onUnauthorized for non-401 errors", async () => {
    mockFetchText(500, "Error");
    const onUnauthorized = vi.fn();
    const api = createApiClient({ onUnauthorized });

    await expect(api("/api/fail")).rejects.toThrow(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("reports failed requests without changing the thrown error", async () => {
    mockFetchText(500, "Error");
    const onError = vi.fn();
    const api = createApiClient({ onError });

    await expect(
      api("/api/fail", "POST", { safe: true }),
    ).rejects.toMatchObject({ status: 500 });

    expect(onError).toHaveBeenCalledWith(expect.any(ApiError), {
      method: "POST",
      url: "/api/fail",
      status: 500,
    });
  });

  it("reports network failures with no HTTP status", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    ) as typeof globalThis.fetch;
    const onError = vi.fn();
    const api = createApiClient({ base: "https://api.example.test", onError });

    await expect(api("/api/ping")).rejects.toThrow("Failed to fetch");

    expect(onError).toHaveBeenCalledWith(expect.any(TypeError), {
      method: "GET",
      url: "https://api.example.test/api/ping",
      status: undefined,
    });
  });

  it("ignores telemetry callback failures", async () => {
    mockFetchText(500, "Error");
    const api = createApiClient({
      onError: () => {
        throw new Error("telemetry unavailable");
      },
    });

    await expect(api("/api/fail")).rejects.toMatchObject({ status: 500 });
  });

  it("deduplicates inflight GET requests", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls++;
      return Promise.resolve(
        new Response(JSON.stringify({ count: calls }), { status: 200 }),
      );
    }) as typeof globalThis.fetch;

    const api = createApiClient();

    const [first, second] = await Promise.all([
      api("/api/data"),
      api("/api/data"),
    ]);

    expect(calls).toBe(1);
    expect(first).toEqual({ count: 1 });
    expect(second).toEqual({ count: 1 });
  });

  it("does not deduplicate different URLs", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls++;
      return Promise.resolve(
        new Response(JSON.stringify({ id: calls }), { status: 200 }),
      );
    }) as typeof globalThis.fetch;

    const api = createApiClient();

    const [a, b] = await Promise.all([api("/api/a"), api("/api/b")]);

    expect(calls).toBe(2);
    expect(a).toEqual({ id: 1 });
    expect(b).toEqual({ id: 2 });
  });

  it("does not deduplicate non-GET requests", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls++;
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }) as typeof globalThis.fetch;

    const api = createApiClient();

    await Promise.all([
      api("/api/data", "POST", { x: 1 }),
      api("/api/data", "POST", { x: 2 }),
    ]);

    expect(calls).toBe(2);
  });

  it("throws AbortError when signal is already aborted", async () => {
    mockFetch(200, {});
    const api = createApiClient();
    const controller = new AbortController();
    controller.abort();

    await expect(
      api("/api/data", "GET", undefined, { signal: controller.signal }),
    ).rejects.toThrow("The request was aborted");
  });

  it("throws AbortError on signal abort during GET", async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(
      () =>
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new DOMException("The request was aborted", "AbortError"));
          });
        }),
    ) as typeof globalThis.fetch;

    const api = createApiClient();
    const promise = api("/api/data", "GET", undefined, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toThrow("The request was aborted");
  });

  it("handles empty response body as null", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("", { status: 200 })),
    ) as typeof globalThis.fetch;
    const api = createApiClient();

    const result = await api("/api/empty");

    expect(result).toBeNull();
  });

  it("handles non-JSON response body gracefully", async () => {
    mockFetchText(200, "plain text");
    const api = createApiClient();

    await expect(api("/api/text")).rejects.toThrow();
  });
});
