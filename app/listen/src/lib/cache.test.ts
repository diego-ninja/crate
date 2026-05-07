import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cacheClear, cacheGet, cacheInvalidate, cacheSet, scopesForUrl } from "@/lib/cache";

describe("listen api cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cacheClear();

    let nextHandle = 1;
    const timers = new Map<number, ReturnType<typeof setTimeout>>();

    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: IdleRequestCallback, options?: IdleRequestOptions) => {
        const handle = nextHandle++;
        const timer = setTimeout(() => {
          callback({
            didTimeout: false,
            timeRemaining: () => 50,
          } as IdleDeadline);
        }, options?.timeout ?? 0);
        timers.set(handle, timer);
        return handle;
      }),
    );

    vi.stubGlobal(
      "cancelIdleCallback",
      vi.fn((handle: number) => {
        const timer = timers.get(handle);
        if (timer != null) {
          clearTimeout(timer);
          timers.delete(handle);
        }
      }),
    );
  });

  afterEach(() => {
    cacheClear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("writes to memory immediately and defers localStorage persistence", async () => {
    const setItemSpy = vi.spyOn(localStorage, "setItem");

    cacheSet("/api/me/home/discovery", { hero: ["Converge"] });

    expect(cacheGet<{ hero: string[] }>("/api/me/home/discovery")).toEqual({
      hero: ["Converge"],
    });
    expect(setItemSpy).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("crate-api-cache:/api/me/home/discovery")).toContain("Converge");
  });

  it("coalesces repeated writes for the same URL and persists the latest payload", async () => {
    const setItemSpy = vi.spyOn(localStorage, "setItem");

    cacheSet("/api/me/home/discovery", { hero: ["Old"] });
    cacheSet("/api/me/home/discovery", { hero: ["New"] });

    await vi.runAllTimersAsync();

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("crate-api-cache:/api/me/home/discovery")).toContain("New");
  });

  it("cancels pending writes when the matching scope is invalidated", async () => {
    const setItemSpy = vi.spyOn(localStorage, "setItem");

    cacheSet("/api/me/stats/overview?window=30d", { minutes: 42 });
    cacheInvalidate("history");

    await vi.runAllTimersAsync();

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(cacheGet("/api/me/stats/overview?window=30d")).toBeNull();
    expect(localStorage.getItem("crate-api-cache:/api/me/stats/overview?window=30d")).toBeNull();
  });

  it("keeps persistent entries for normal daily app opens", () => {
    vi.setSystemTime(new Date("2026-05-06T12:00:00Z"));
    localStorage.setItem(
      "crate-api-cache:/api/me/home/discovery",
      JSON.stringify({
        data: { hero: ["Dredg"] },
        timestamp: Date.now() - 179 * 24 * 60 * 60 * 1000,
        scopes: ["home"],
      }),
    );

    expect(cacheGet<{ hero: string[] }>("/api/me/home/discovery")).toEqual({
      hero: ["Dredg"],
    });
  });

  it("drops very old entries as a missed-invalidation safety net", () => {
    vi.setSystemTime(new Date("2026-05-06T12:00:00Z"));
    localStorage.setItem(
      "crate-api-cache:/api/me/home/discovery",
      JSON.stringify({
        data: { hero: ["Old"] },
        timestamp: Date.now() - 181 * 24 * 60 * 60 * 1000,
        scopes: ["home"],
      }),
    );

    expect(cacheGet("/api/me/home/discovery")).toBeNull();
    expect(localStorage.getItem("crate-api-cache:/api/me/home/discovery")).toBeNull();
  });

  it("maps jam room endpoints to the jam scope", () => {
    expect(scopesForUrl("/api/jam/rooms")).toContain("jam");
    expect(scopesForUrl("/api/jam/rooms/room-1")).toContain("jam");
  });
});
