import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn(() => null),
  cacheSet: vi.fn(),
  onCacheInvalidation: vi.fn(() => () => {}),
  scopesForUrl: vi.fn(() => []),
}));

import { api } from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/cache";
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
    expect(cacheGetMock).toHaveBeenCalledTimes(initialCacheReads + 1);
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
});
