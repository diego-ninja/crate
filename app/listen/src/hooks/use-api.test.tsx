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
import { cacheGet } from "@/lib/cache";
import { useApi } from "@/hooks/use-api";

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
});
