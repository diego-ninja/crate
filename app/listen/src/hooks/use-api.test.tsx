import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn(() => null),
  cacheSet: vi.fn(),
  onCacheInvalidation: vi.fn(() => () => {}),
  onCacheReconnect: vi.fn(() => () => {}),
  scopesForUrl: vi.fn(() => []),
}));

import { api } from "@/lib/api";
import { cacheGet, cacheSet, onCacheReconnect } from "@/lib/cache";
import { useApi } from "@/hooks/use-api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useApi", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("reads cached data once per URL instead of on every rerender", async () => {
    const cacheGetMock = vi.mocked(cacheGet);
    const apiMock = vi.mocked(api);

    const { rerender } = renderHook(
      ({ url }) => useApi(url),
      { initialProps: { url: "/api/me" as string | null } },
    );

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledTimes(1);
    });
    const initialCacheReads = cacheGetMock.mock.calls.length;
    expect(initialCacheReads).toBeGreaterThanOrEqual(1);

    rerender({ url: "/api/me" });
    expect(cacheGetMock).toHaveBeenCalledTimes(initialCacheReads);

    rerender({ url: "/api/me/stats" });
    expect(cacheGetMock.mock.calls.slice(initialCacheReads).map(([url]) => url)).toContain("/api/me/stats");
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledTimes(2);
    });
  });

  it("does not let a stale in-flight response overwrite the current URL data", async () => {
    const apiMock = vi.mocked(api);
    const cacheSetMock = vi.mocked(cacheSet);
    const first = deferred<{ id: string }>();
    const second = deferred<{ id: string }>();
    apiMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ url }) => useApi<{ id: string }>(url),
      { initialProps: { url: "/api/tracks/1" as string | null } },
    );

    rerender({ url: "/api/tracks/2" });

    first.resolve({ id: "track-a" });
    second.resolve({ id: "track-b" });

    await waitFor(() => {
      expect(result.current.data).toEqual({ id: "track-b" });
    });

    expect(cacheSetMock).toHaveBeenCalledWith("/api/tracks/1", { id: "track-a" });
    expect(cacheSetMock).toHaveBeenCalledWith("/api/tracks/2", { id: "track-b" });
  });

  it("does not expose the previous URL data during the first render after a URL change", async () => {
    const apiMock = vi.mocked(api);
    const cacheGetMock = vi.mocked(cacheGet);
    const first = deferred<{ id: string }>();
    const second = deferred<{ id: string }>();

    cacheGetMock.mockImplementation((url) => {
      if (url === "/api/artists/high-vis/page") return { id: "cached-high-vis" };
      return null;
    });

    apiMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ url }) => useApi<{ id: string }>(url),
      { initialProps: { url: "/api/artists/quicksand/page" as string | null } },
    );

    first.resolve({ id: "quicksand" });
    await waitFor(() => {
      expect(result.current.data).toEqual({ id: "quicksand" });
    });

    rerender({ url: "/api/artists/high-vis/page" });

    expect(result.current.data).toEqual({ id: "cached-high-vis" });
    expect(result.current.error).toBeNull();

    second.resolve({ id: "high-vis" });
    await waitFor(() => {
      expect(result.current.data).toEqual({ id: "high-vis" });
    });
  });

  it("revalidates when the cache invalidation SSE reconnects", async () => {
    const apiMock = vi.mocked(api);
    const onCacheReconnectMock = vi.mocked(onCacheReconnect);
    let reconnect: (() => void) | null = null;

    onCacheReconnectMock.mockImplementation((listener) => {
      reconnect = () => listener({
        name: "cache-invalidations",
        connected: true,
        degraded: false,
        hasEverConnected: true,
        reconnectCount: 1,
        degradeAfterMs: 75_000,
        lastOpenAt: Date.now(),
        lastEventAt: Date.now(),
        lastReconnectAt: Date.now(),
        lastErrorAt: null,
        lastCloseAt: null,
      });
      return () => {
        reconnect = null;
      };
    });

    apiMock
      .mockResolvedValueOnce({ ok: 1 })
      .mockResolvedValueOnce({ ok: 2 });

    const { result } = renderHook(() => useApi<{ ok: number }>("/api/me"));

    await waitFor(() => {
      expect(result.current.data).toEqual({ ok: 1 });
    });

    act(() => {
      reconnect?.();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual({ ok: 2 });
    });
  });

  it("uses a periodic safety-net refetch for critical views", async () => {
    vi.useFakeTimers();
    const apiMock = vi.mocked(api);
    apiMock
      .mockResolvedValueOnce({ ok: 1 })
      .mockResolvedValueOnce({ ok: 2 });

    const { result } = renderHook(() =>
      useApi<{ ok: number }>("/api/me", "GET", undefined, { safetyNetMs: 1_000 }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.data).toEqual({ ok: 1 });

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({ ok: 2 });
  });
});
