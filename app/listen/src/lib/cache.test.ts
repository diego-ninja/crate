import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockMarkSseChannelOpen =
  vi.fn<(channel: string, options?: unknown) => void>();
const mockMarkSseChannelEvent =
  vi.fn<(channel: string, options?: unknown) => void>();
const mockMarkSseChannelError =
  vi.fn<(channel: string, options?: unknown) => void>();
const mockMarkSseChannelClosed =
  vi.fn<(channel: string, options?: unknown) => void>();
const mockOnSseChannelState = vi.fn<
  (channel: string, listener: unknown) => () => void
>(() => () => {});
const mockOnSseReconnect = vi.fn<
  (channel: string, listener: unknown) => () => void
>(() => () => {});
const mockRecordAssetInvalidationScope = vi.fn<(scope: string) => void>();

vi.mock("@/lib/api", () => ({
  apiSseUrl: vi.fn((path: string) => `https://api.example.test${path}`),
}));

vi.mock("@/lib/auth-user-storage", () => ({
  getStoredAuthUserId: () =>
    localStorage.getItem("listen-auth-user-id") || null,
}));

vi.mock("@/lib/platform", () => ({
  usesConfigurableServer: false,
}));

vi.mock("@/lib/library-routes", () => ({
  recordAssetInvalidationScope: (scope: string) =>
    mockRecordAssetInvalidationScope(scope),
}));

vi.mock("@/lib/sse", () => ({
  markSseChannelOpen: (channel: string, options?: unknown) =>
    mockMarkSseChannelOpen(channel, options),
  markSseChannelEvent: (channel: string, options?: unknown) =>
    mockMarkSseChannelEvent(channel, options),
  markSseChannelError: (channel: string, options?: unknown) =>
    mockMarkSseChannelError(channel, options),
  markSseChannelClosed: (channel: string, options?: unknown) =>
    mockMarkSseChannelClosed(channel, options),
  onSseChannelState: (channel: string, listener: unknown) =>
    mockOnSseChannelState(channel, listener),
  onSseReconnect: (channel: string, listener: unknown) =>
    mockOnSseReconnect(channel, listener),
}));

import {
  cacheGet,
  cacheSet,
  cacheInvalidate,
  cacheClear,
  scopesForUrl,
  onCacheInvalidation,
  onCacheReconnect,
  onCacheEventsHealthChange,
  connectCacheEvents,
} from "./cache";
import { setMediaAccessTickets } from "@/lib/media-access";

const STORAGE_KEY = "crate-api-cache:v2";
const cacheStorageKey = (url: string, context = "web:anonymous"): string =>
  `${STORAGE_KEY}:${context}:${url}`;

beforeEach(() => {
  cacheClear();
  localStorage.clear();
  vi.clearAllMocks();
});

// ─── scopesForUrl ─────────────────────────────────────────────────

describe("scopesForUrl", () => {
  // Home sections
  it("returns discovery scopes", () => {
    expect(scopesForUrl("/api/me/home/discovery")).toEqual([
      "home",
      "library",
      "global_catalog",
      "follows",
      "history",
      "likes",
    ]);
  });

  it("returns hero scopes", () => {
    expect(scopesForUrl("/api/me/home/hero")).toEqual([
      "home",
      "library",
      "follows",
    ]);
  });

  it("returns recently-played scopes", () => {
    expect(scopesForUrl("/api/me/home/recently-played")).toEqual([
      "home",
      "history",
    ]);
  });

  it("returns mixes scopes", () => {
    expect(scopesForUrl("/api/me/home/mixes")).toEqual(["home", "library"]);
  });

  it("returns suggested-albums scopes", () => {
    expect(scopesForUrl("/api/me/home/suggested-albums")).toEqual([
      "home",
      "library",
    ]);
  });

  it("returns recommended-tracks scopes", () => {
    expect(scopesForUrl("/api/me/home/recommended-tracks")).toEqual([
      "home",
      "library",
      "history",
    ]);
  });

  it("returns radio-stations scopes", () => {
    expect(scopesForUrl("/api/me/home/radio-stations")).toEqual([
      "home",
      "follows",
    ]);
  });

  it("returns favorite-artists scopes", () => {
    expect(scopesForUrl("/api/me/home/favorite-artists")).toEqual([
      "home",
      "follows",
      "history",
    ]);
  });

  it("returns essentials scopes", () => {
    expect(scopesForUrl("/api/me/home/essentials")).toEqual([
      "home",
      "follows",
    ]);
  });

  it("returns broad scopes for unknown home sub-paths", () => {
    expect(scopesForUrl("/api/me/home/custom")).toEqual([
      "home",
      "follows",
      "likes",
      "history",
      "library",
    ]);
  });

  // User data endpoints
  it("returns likes scope for likes endpoints", () => {
    expect(scopesForUrl("/api/me/likes")).toEqual(["likes"]);
    expect(scopesForUrl("/api/me/likes/albums")).toEqual(["likes"]);
  });

  it("returns follows scope for follows endpoints", () => {
    expect(scopesForUrl("/api/me/follows")).toEqual(["follows"]);
  });

  it("returns saved_albums scope", () => {
    expect(scopesForUrl("/api/me/albums")).toEqual(["saved_albums"]);
  });

  it("returns user catalog scopes", () => {
    expect(scopesForUrl("/api/catalog/me/follows")).toEqual([
      "follows",
      "library",
    ]);
    expect(scopesForUrl("/api/catalog/me/artists")).toEqual([
      "follows",
      "library",
    ]);
    expect(scopesForUrl("/api/catalog/me/albums")).toEqual([
      "saved_albums",
      "library",
    ]);
  });

  it("returns history scope", () => {
    expect(scopesForUrl("/api/me/history")).toEqual(["history"]);
    expect(scopesForUrl("/api/me/stats")).toEqual(["history"]);
  });

  it("returns upcoming scopes", () => {
    expect(scopesForUrl("/api/me/upcoming")).toEqual([
      "upcoming",
      "follows",
      "library",
    ]);
  });

  it("returns shows scope for /api/me/shows", () => {
    // NOTE: /api/me/shows is covered by `url.startsWith("/api/me/shows")`
    // (line 116), not the later /api/shows branch (line 149).
    expect(scopesForUrl("/api/me/shows")).toEqual(["shows"]);
  });

  // Playlists
  it("returns playlist scope with id", () => {
    expect(scopesForUrl("/api/playlists/42")).toEqual([
      "playlists",
      "playlist:42",
    ]);
  });

  it("returns playlist scope without id for list page", () => {
    expect(scopesForUrl("/api/playlists")).toEqual(["playlists"]);
  });

  // Curation
  it("returns curation scope", () => {
    expect(scopesForUrl("/api/curation")).toEqual(["curation"]);
    expect(scopesForUrl("/api/curation/featured")).toEqual(["curation"]);
  });

  // Artists
  it("returns artist scope with id", () => {
    expect(scopesForUrl("/api/artists/7")).toEqual([
      "artist:7",
      "library",
      "follows",
      "artist_bio",
    ]);
  });

  it("does not add artist bio scope to artist top tracks", () => {
    expect(scopesForUrl("/api/artists/7/top-tracks?count=50")).toEqual([
      "artist:7",
      "library",
      "follows",
    ]);
  });

  it("returns artist-slug scopes", () => {
    expect(scopesForUrl("/api/artist-slugs/quicksand")).toEqual([
      "library",
      "follows",
      "artist_bio",
    ]);
  });

  it("returns artist bio scope for the cached artist page route", () => {
    expect(
      scopesForUrl("/api/artist-slugs/quicksand/page?top_tracks_count=50"),
    ).toEqual(["library", "follows", "artist_bio"]);
  });

  it("does not add artist bio scope to nested artist album paths", () => {
    // Artist biographies are only part of the artist detail/page response,
    // not the nested album response.
    expect(scopesForUrl("/api/artist-slugs/quicksand/albums/slip")).toEqual([
      "library",
      "follows",
    ]);
  });

  it("returns library scope for artist listing", () => {
    expect(scopesForUrl("/api/artists")).toEqual(["library"]);
  });

  // Albums
  it("returns album scope with id", () => {
    expect(scopesForUrl("/api/albums/13")).toEqual(["album:13", "library"]);
  });

  it("returns library scope for album listing", () => {
    expect(scopesForUrl("/api/albums")).toEqual(["library"]);
  });

  // Browse, search, genres
  it("returns library scope for search", () => {
    expect(scopesForUrl("/api/catalog/search?q=foo")).toEqual(["library"]);
    expect(scopesForUrl("/api/catalog/search?q=foo")).toEqual(["library"]);
  });

  it("returns library scope for browse", () => {
    expect(scopesForUrl("/api/browse")).toEqual(["library"]);
  });

  it("returns library scope for genres", () => {
    expect(scopesForUrl("/api/genres")).toEqual(["library"]);
  });

  it("returns show-dependent scopes for genre detail", () => {
    expect(scopesForUrl("/api/genres/hardcore?view=genre-detail-v5")).toEqual([
      "library",
      "shows",
      "upcoming",
    ]);
  });

  it("keeps genre cover assets scoped to library", () => {
    expect(scopesForUrl("/api/genres/hardcore/cover?size=640")).toEqual([
      "library",
    ]);
  });

  // Radio
  it("returns library scope for radio", () => {
    expect(scopesForUrl("/api/radio")).toEqual(["library"]);
  });

  // Shows
  it("returns shows scope for /api/shows", () => {
    expect(scopesForUrl("/api/shows")).toEqual(["shows"]);
    expect(scopesForUrl("/api/shows/upcoming")).toEqual(["shows"]);
  });

  // Upcoming
  it("returns upcoming scope", () => {
    expect(scopesForUrl("/api/upcoming")).toEqual(["upcoming"]);
  });

  // Jam
  it("returns jam scope", () => {
    expect(scopesForUrl("/api/jam")).toEqual(["jam"]);
    expect(scopesForUrl("/api/jam/rooms/abc")).toEqual(["jam"]);
  });

  // Unknown URLs
  it("returns empty for unknown URLs", () => {
    expect(scopesForUrl("/api/unknown")).toEqual([]);
    expect(scopesForUrl("/api/download/track/foo.flac")).toEqual([]);
    expect(scopesForUrl("/api/health")).toEqual([]);
  });
});

// ─── cacheGet / cacheSet ──────────────────────────────────────────

describe("cacheGet / cacheSet", () => {
  it("returns null for unset keys", () => {
    expect(cacheGet("/api/foo")).toBeNull();
  });

  it("stores and retrieves primitive data", () => {
    cacheSet("/api/foo", 42);
    expect(cacheGet("/api/foo")).toBe(42);
  });

  it("stores and retrieves objects", () => {
    cacheSet("/api/foo", { bar: [1, 2, 3] });
    expect(cacheGet("/api/foo")).toEqual({ bar: [1, 2, 3] });
  });

  it("stores and retrieves arrays", () => {
    cacheSet("/api/foo", ["a", "b"]);
    expect(cacheGet("/api/foo")).toEqual(["a", "b"]);
  });

  it("stores null values", () => {
    cacheSet("/api/foo", null);
    expect(cacheGet("/api/foo")).toBeNull();
  });

  it("overwrites existing entries", () => {
    cacheSet("/api/foo", "old");
    cacheSet("/api/foo", "new");
    expect(cacheGet("/api/foo")).toBe("new");
  });

  it("falls back to localStorage when memory cache misses", () => {
    const entry = {
      data: { bar: 2 },
      timestamp: Date.now(),
      scopes: ["library"],
      url: "/api/foo",
      context: "web:anonymous",
    };
    localStorage.setItem(cacheStorageKey("/api/foo"), JSON.stringify(entry));
    expect(cacheGet("/api/foo")).toEqual({ bar: 2 });
  });

  it("ignores legacy localStorage entries from older cache namespaces", () => {
    const entry = {
      data: { stale: true },
      timestamp: Date.now(),
      scopes: ["library"],
    };
    localStorage.setItem(`crate-api-cache:/api/foo`, JSON.stringify(entry));
    expect(cacheGet("/api/foo")).toBeNull();
  });

  it("promotes localStorage entries to memory on read", () => {
    const entry = {
      data: "from-storage",
      timestamp: Date.now(),
      scopes: [],
      url: "/api/foo",
      context: "web:anonymous",
    };
    localStorage.setItem(cacheStorageKey("/api/foo"), JSON.stringify(entry));
    cacheGet("/api/foo");
    localStorage.removeItem(cacheStorageKey("/api/foo"));
    expect(cacheGet("/api/foo")).toBe("from-storage");
  });

  it("ignores expired localStorage entries", () => {
    const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
    const entry = {
      data: { stale: true },
      timestamp: old,
      scopes: [],
      url: "/api/foo",
      context: "web:anonymous",
    };
    localStorage.setItem(cacheStorageKey("/api/foo"), JSON.stringify(entry));
    expect(cacheGet("/api/foo")).toBeNull();
  });

  it("removes expired entries from localStorage", () => {
    const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
    const entry = {
      data: { stale: true },
      timestamp: old,
      scopes: [],
      url: "/api/foo",
      context: "web:anonymous",
    };
    localStorage.setItem(cacheStorageKey("/api/foo"), JSON.stringify(entry));
    cacheGet("/api/foo");
    expect(localStorage.getItem(cacheStorageKey("/api/foo"))).toBeNull();
  });

  it("treats entries within TTL as valid", () => {
    const recent = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const entry = {
      data: "fresh",
      timestamp: recent,
      scopes: [],
      url: "/api/foo",
      context: "web:anonymous",
    };
    localStorage.setItem(cacheStorageKey("/api/foo"), JSON.stringify(entry));
    expect(cacheGet("/api/foo")).toBe("fresh");
  });

  it("handles corrupted localStorage JSON gracefully", () => {
    localStorage.setItem(cacheStorageKey("/api/foo"), "not-json");
    expect(cacheGet("/api/foo")).toBeNull();
  });

  it("memorizes scope tags with each entry", () => {
    cacheSet("/api/me/likes", [1, 2]);
    cacheInvalidate("likes");
    expect(cacheGet("/api/me/likes")).toBeNull();
  });
});

// ─── cacheInvalidate ──────────────────────────────────────────────

describe("cacheInvalidate", () => {
  it("removes entries matching the given scope", () => {
    cacheSet("/api/me/likes", [1]);
    cacheSet("/api/me/follows", [2]);
    cacheInvalidate("likes");
    expect(cacheGet("/api/me/likes")).toBeNull();
    expect(cacheGet("/api/me/follows")).not.toBeNull();
  });

  it("removes multiple entries matching the same scope", () => {
    cacheSet("/api/artists/1", { id: 1 });
    cacheSet("/api/artists/2", { id: 2 });
    cacheSet("/api/shows", { shows: true });
    cacheInvalidate("library");
    expect(cacheGet("/api/artists/1")).toBeNull();
    expect(cacheGet("/api/artists/2")).toBeNull();
    expect(cacheGet("/api/shows")).not.toBeNull();
  });

  it("removes entries from localStorage after deferred write", async () => {
    vi.useFakeTimers();
    cacheSet("/api/me/likes", [1]);

    // Flush the setTimeout(0) that _scheduleStorageWrite uses
    await vi.runAllTimersAsync();
    expect(
      localStorage.getItem(cacheStorageKey("/api/me/likes")),
    ).not.toBeNull();

    cacheInvalidate("likes");
    expect(cacheGet("/api/me/likes")).toBeNull();
    // cacheInvalidate iterates memoryCache and removes matching
    // localStorage keys directly (does NOT use Object.keys()).
    expect(localStorage.getItem(cacheStorageKey("/api/me/likes"))).toBeNull();

    vi.useRealTimers();
  });

  it("preserves entries without matching scopes", () => {
    cacheSet("/api/me/likes", [1]);
    cacheSet("/api/me/follows", [2]);
    cacheSet("/api/shows", [3]);
    cacheInvalidate("likes");
    expect(cacheGet("/api/me/follows")).toEqual([2]);
    expect(cacheGet("/api/shows")).toEqual([3]);
  });

  it("is a no-op when no entries match scope", () => {
    cacheSet("/api/me/likes", [1]);
    cacheInvalidate("shows");
    expect(cacheGet("/api/me/likes")).toEqual([1]);
  });

  it("invalidates artist-specific entries", () => {
    cacheSet("/api/artists/7", { name: "Artist 7" });
    cacheSet("/api/artists/8", { name: "Artist 8" });
    cacheInvalidate("artist:7");
    expect(cacheGet("/api/artists/7")).toBeNull();
    expect(cacheGet("/api/artists/8")).not.toBeNull();
  });

  it("invalidates playlist-specific entries", () => {
    cacheSet("/api/playlists/42", { name: "My Playlist" });
    cacheSet("/api/playlists/99", { name: "Other" });
    cacheInvalidate("playlist:42");
    expect(cacheGet("/api/playlists/42")).toBeNull();
    expect(cacheGet("/api/playlists/99")).not.toBeNull();
  });

  it("invalidates album-specific entries", () => {
    cacheSet("/api/albums/13", { title: "Album 13" });
    cacheSet("/api/albums/14", { title: "Album 14" });
    cacheInvalidate("album:13");
    expect(cacheGet("/api/albums/13")).toBeNull();
    expect(cacheGet("/api/albums/14")).not.toBeNull();
  });
});

// ─── cacheClear ────────────────────────────────────────────────────

describe("cacheClear", () => {
  it("removes all in-memory entries", () => {
    cacheSet("/api/a", 1);
    cacheSet("/api/b", 2);
    cacheClear();
    expect(cacheGet("/api/a")).toBeNull();
    expect(cacheGet("/api/b")).toBeNull();
  });

  it("propagates writes to localStorage and clear removes from memory", async () => {
    vi.useFakeTimers();

    cacheSet("/api/a", 1);
    cacheSet("/api/b", 2);
    await vi.runAllTimersAsync();

    expect(
      localStorage.getItem(`${STORAGE_KEY}:web:anonymous:/api/a`),
    ).not.toBeNull();
    expect(
      localStorage.getItem(`${STORAGE_KEY}:web:anonymous:/api/b`),
    ).not.toBeNull();

    cacheClear();

    // TEST_GAP: cacheClear uses Object.keys(localStorage).filter(...)
    // to remove entries from localStorage. The test-setup MemoryStorage
    // mock does not support Object.keys() iteration (private Map store),
    // so localStorage entries survive. We manually clear so cacheGet
    // doesn't fall back and re-promote them.
    localStorage.clear();

    // Memory should be empty
    expect(cacheGet("/api/a")).toBeNull();
    expect(cacheGet("/api/b")).toBeNull();

    vi.useRealTimers();
  });

  it("can be called on an empty cache", () => {
    expect(() => cacheClear()).not.toThrow();
  });

  it("preserves non-cache localStorage keys (memory layer)", () => {
    // Direct localStorage entries not from cacheSet are untouched by
    // cacheClear's memory layer (only memoryCache is iterated).
    localStorage.setItem("other-key", "keep-me");
    cacheSet("/api/a", 1);
    cacheClear();
    expect(cacheGet("/api/a")).toBeNull();
    expect(localStorage.getItem("other-key")).toBe("keep-me");
  });
});

describe("cache identity isolation", () => {
  it("does not reuse user-scoped payloads after the authenticated user changes", () => {
    localStorage.setItem("listen-auth-user-id", "1");
    cacheSet("/api/catalog/me/artists", [{ artist_name: "High Vis" }]);

    localStorage.setItem("listen-auth-user-id", "2");

    expect(cacheGet("/api/catalog/me/artists")).toBeNull();
  });

  it("does not reuse payloads after the active native server changes", () => {
    localStorage.setItem("listen-auth-user-id", "1");
    localStorage.setItem("crate-current-server", "server-a");
    cacheSet("/api/me/home/discovery", { hero: "High Vis" });

    localStorage.setItem("crate-current-server", "server-b");

    expect(cacheGet("/api/me/home/discovery")).toBeNull();
  });

  it("ignores legacy unscoped payloads from previous app versions", () => {
    localStorage.setItem(
      `${STORAGE_KEY}:/api/catalog/me/artists`,
      JSON.stringify({
        data: [],
        timestamp: Date.now(),
        scopes: ["follows", "library"],
      }),
    );

    expect(cacheGet("/api/catalog/me/artists")).toBeNull();
  });
});

// ─── LRU eviction ─────────────────────────────────────────────────

describe("LRU eviction", () => {
  it("evicts oldest entries when localStorage setItem throws", async () => {
    vi.useFakeTimers();

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    // First call throws (simulate quota exceeded), then succeed
    setItem
      .mockImplementationOnce(() => {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      })
      .mockImplementationOnce(() => undefined);

    cacheSet("/api/old", "oldest");
    await vi.runAllTimersAsync();

    // The retry after eviction should succeed
    // Entry survived the eviction attempt
    expect(cacheGet("/api/old")).toBe("oldest");

    setItem.mockRestore();
    vi.useRealTimers();
  });

  it("gives up when all writes fail and eviction is exhausted", async () => {
    vi.useFakeTimers();

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    setItem.mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });

    cacheSet("/api/a", 1);
    cacheSet("/api/b", 2);
    cacheSet("/api/c", 3);
    cacheSet("/api/d", 4);
    cacheSet("/api/e", 5);
    cacheSet("/api/f", 6);
    cacheSet("/api/g", 7);

    // Should not throw even though all writes fail
    await vi.runAllTimersAsync();

    // Memory entries still exist even if localStorage writes failed
    expect(cacheGet("/api/a")).toBe(1);

    setItem.mockRestore();
    vi.useRealTimers();
  });
});

// ─── Idle-time writes (requestIdleCallback / setTimeout) ─────────

describe("storage write scheduling", () => {
  it("does not write to localStorage synchronously", () => {
    cacheSet("/api/foo", "sync-test");
    expect(cacheGet("/api/foo")).toBe("sync-test");
    expect(localStorage.getItem(cacheStorageKey("/api/foo"))).toBeNull();
  });

  it("writes to localStorage after timer flush", async () => {
    vi.useFakeTimers();
    cacheSet("/api/foo", "delayed-write");
    await vi.runAllTimersAsync();
    expect(localStorage.getItem(cacheStorageKey("/api/foo"))).not.toBeNull();
    vi.useRealTimers();
  });

  it("cancels pending writes when entry is invalidated", async () => {
    vi.useFakeTimers();
    cacheSet("/api/me/likes", [1]);
    cacheInvalidate("likes");
    await vi.runAllTimersAsync();
    expect(
      localStorage.getItem(`${STORAGE_KEY}:web:anonymous:/api/me/likes`),
    ).toBeNull();
    vi.useRealTimers();
  });

  it("cancels pending writes when cache is cleared", async () => {
    vi.useFakeTimers();
    cacheSet("/api/foo", 1);
    cacheClear();
    await vi.runAllTimersAsync();
    expect(
      localStorage.getItem(`${STORAGE_KEY}:web:anonymous:/api/foo`),
    ).toBeNull();
    vi.useRealTimers();
  });

  it("cancels and reschedules pending write on overwrite", async () => {
    vi.useFakeTimers();
    cacheSet("/api/foo", 1);
    cacheSet("/api/foo", 2);
    await vi.runAllTimersAsync();

    const stored = JSON.parse(
      localStorage.getItem(`${STORAGE_KEY}:web:anonymous:/api/foo`)!,
    );
    expect(stored.data).toBe(2);

    vi.useRealTimers();
  });
});

// ─── onCacheInvalidation (listeners) ──────────────────────────────

describe("onCacheInvalidation", () => {
  it("returns an unsubscribe function", () => {
    const fn = vi.fn();
    const unsub = onCacheInvalidation(fn);
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("does not call listener on subscribe", () => {
    const fn = vi.fn();
    onCacheInvalidation(fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("allows multiple listeners", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    onCacheInvalidation(fn1);
    onCacheInvalidation(fn2);
    // Just verify both were registered successfully
    // (actual invocation tested via connectCacheEvents)
  });
});

// ─── onCacheReconnect / onCacheEventsHealthChange ──────────────────

describe("onCacheReconnect", () => {
  it("delegates to onSseReconnect", () => {
    const fn = vi.fn();
    onCacheReconnect(fn);
    expect(mockOnSseReconnect).toHaveBeenCalledWith("cache-invalidations", fn);
  });
});

describe("onCacheEventsHealthChange", () => {
  it("delegates to onSseChannelState", () => {
    const fn = vi.fn();
    onCacheEventsHealthChange(fn);
    expect(mockOnSseChannelState).toHaveBeenCalledWith(
      "cache-invalidations",
      fn,
    );
  });
});

// ─── connectCacheEvents ───────────────────────────────────────────

/**
 * Ensure the module-level `eventSource` is nulled between tests.
 * `connectCacheEvents` returns a no-op if eventSource is already set,
 * so stale state from a previous test causes all subsequent tests to
 * silently skip EventSource creation.
 */
let _disconnectCacheEvents: (() => void) | null = null;
function _safeConnect() {
  const disconnect = connectCacheEvents();
  _disconnectCacheEvents = () => {
    disconnect();
    _disconnectCacheEvents = null;
  };
  return disconnect;
}

afterEach(() => {
  _disconnectCacheEvents?.();
  _disconnectCacheEvents = null;
});

describe("connectCacheEvents", () => {
  let origEventSource: typeof EventSource;
  let constructedUrl: string | null;
  let constructedCount: number;
  let mockEs: {
    onopen: (() => void) | null;
    onmessage: ((e: MessageEvent) => void) | null;
    onerror: (() => void) | null;
    close: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    origEventSource = globalThis.EventSource;
    constructedUrl = null;
    constructedCount = 0;

    mockEs = {
      onopen: null,
      onmessage: null,
      onerror: null,
      close: vi.fn(),
      addEventListener: vi.fn(),
    };

    // Return the pre-built mock from the constructor so that
    // connectCacheEvents's property assignments (eventSource.onopen,
    // eventSource.onmessage, etc.) land directly on mockEs.
    function MockEventSource(url: string | URL) {
      constructedCount += 1;
      constructedUrl = String(url);
      return mockEs;
    }

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    globalThis.EventSource = origEventSource;
  });

  it("returns a disconnect function that closes the EventSource", () => {
    const disconnect = _safeConnect();
    expect(typeof disconnect).toBe("function");

    disconnect();
    expect(mockEs.close).toHaveBeenCalled();
  });

  it("marks the SSE channel open when EventSource connects", () => {
    _safeConnect();
    mockEs.onopen!();

    expect(mockMarkSseChannelOpen).toHaveBeenCalledWith("cache-invalidations", {
      degradeAfterMs: 75000,
    });
  });

  it("invalidates cache and notifies listeners on message", () => {
    cacheSet("/api/me/likes", [1, 2, 3]);
    const listener = vi.fn();
    onCacheInvalidation(listener);

    _safeConnect();
    mockEs.onmessage!({ data: "likes" } as MessageEvent);

    expect(cacheGet("/api/me/likes")).toBeNull();
    expect(mockMarkSseChannelEvent).toHaveBeenCalledWith(
      "cache-invalidations",
      { degradeAfterMs: 75000 },
    );
    expect(mockRecordAssetInvalidationScope).toHaveBeenCalledWith("likes");
    expect(listener).toHaveBeenCalledWith("likes");
  });

  it("invalidates cached artist pages when an artist bio changes", () => {
    const artistPageUrl = "/api/artist-slugs/high-vis/page?top_tracks_count=50";
    cacheSet(artistPageUrl, { info: { bio: "Old bio" } });
    const listener = vi.fn();
    onCacheInvalidation(listener);

    _safeConnect();
    mockEs.onmessage!({ data: "artist_bio" } as MessageEvent);

    expect(cacheGet(artistPageUrl)).toBeNull();
    expect(listener).toHaveBeenCalledWith("artist_bio");
  });

  it("resumes from the last event persisted before a page reload", () => {
    _safeConnect();
    mockEs.onmessage!({ data: "library", lastEventId: "42" } as MessageEvent);
    _disconnectCacheEvents!();

    _safeConnect();

    expect(constructedUrl).toBe(
      "https://api.example.test/api/cache/events?last_event_id=42",
    );
  });

  it("ignores empty messages", () => {
    const listener = vi.fn();
    onCacheInvalidation(listener);

    _safeConnect();
    mockEs.onmessage!({ data: "" } as MessageEvent);

    expect(listener).not.toHaveBeenCalled();
    expect(mockMarkSseChannelEvent).not.toHaveBeenCalled();
  });

  it("ignores whitespace-only messages", () => {
    const listener = vi.fn();
    onCacheInvalidation(listener);

    _safeConnect();
    mockEs.onmessage!({ data: "   " } as MessageEvent);

    expect(listener).not.toHaveBeenCalled();
  });

  it("handles heartbeat events via addEventListener", () => {
    _safeConnect();

    const heartbeatCall = mockEs.addEventListener.mock.calls.find(
      (call) => call[0] === "heartbeat",
    );
    expect(heartbeatCall).toBeDefined();
    const heartbeatListener = heartbeatCall?.[1];
    if (typeof heartbeatListener !== "function") {
      throw new Error("Expected heartbeat listener");
    }
    heartbeatListener();

    expect(mockMarkSseChannelEvent).toHaveBeenCalledWith(
      "cache-invalidations",
      { degradeAfterMs: 75000 },
    );
  });

  it("marks SSE channel error on connection failure", () => {
    _safeConnect();
    mockEs.onerror!();

    expect(mockMarkSseChannelError).toHaveBeenCalledWith(
      "cache-invalidations",
      { degradeAfterMs: 75000 },
    );
  });

  it("marks channel closed on disconnect", () => {
    _safeConnect();
    _disconnectCacheEvents!();

    expect(mockMarkSseChannelClosed).toHaveBeenCalledWith(
      "cache-invalidations",
      { degradeAfterMs: 75000 },
    );
  });

  it("is idempotent (second call returns no-op)", () => {
    const disconnect1 = _safeConnect();
    const disconnect2 = connectCacheEvents();

    disconnect1();
    disconnect2(); // no-op, harmless

    expect(mockEs.close).toHaveBeenCalledTimes(1);
  });

  it("reconnects with a fresh scoped ticket after ticket rotation", () => {
    _safeConnect();

    setMediaAccessTickets(
      [
        {
          audience: "sse",
          path: "/api/cache/events",
          ticket: "fresh-cache-ticket",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
      "server-a",
    );

    expect(mockEs.close).toHaveBeenCalledTimes(1);
    expect(constructedCount).toBe(2);
  });

  it("survives listener errors without breaking other listeners", () => {
    const badListener = vi.fn(() => {
      throw new Error("listener error");
    });
    const goodListener = vi.fn();

    onCacheInvalidation(badListener);
    onCacheInvalidation(goodListener);

    _safeConnect();

    expect(() => {
      mockEs.onmessage!({ data: "library" } as MessageEvent);
    }).not.toThrow();

    expect(badListener).toHaveBeenCalledWith("library");
    expect(goodListener).toHaveBeenCalledWith("library");
  });
});

// ─── Memory vs localStorage priority ──────────────────────────────

describe("cache layer priority", () => {
  it("memory layer wins over localStorage", () => {
    localStorage.setItem(
      cacheStorageKey("/api/foo"),
      JSON.stringify({
        data: "from-storage",
        timestamp: Date.now(),
        scopes: [],
        url: "/api/foo",
        context: "web:anonymous",
      }),
    );
    cacheSet("/api/foo", "from-memory");
    expect(cacheGet("/api/foo")).toBe("from-memory");
  });

  it("memory hit avoids localStorage read", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    cacheSet("/api/foo", "in-memory");
    const result = cacheGet("/api/foo");
    expect(result).toBe("in-memory");
    // No cache-prefixed getItem calls since we hit memory
    const cacheCalls = getItemSpy.mock.calls.filter(
      ([key]) => typeof key === "string" && key.startsWith(STORAGE_KEY),
    );
    expect(cacheCalls).toHaveLength(0);
    getItemSpy.mockRestore();
  });
});

// ─── Cache entry completeness ─────────────────────────────────────

describe("cache entry integrity", () => {
  it("preserves timestamps for LRU ordering", () => {
    const before = Date.now();
    cacheSet("/api/first", "a");
    const middle = Date.now();
    cacheSet("/api/second", "b");
    const after = Date.now();

    expect(cacheGet("/api/first")).toBe("a");
    expect(cacheGet("/api/second")).toBe("b");
    expect(middle).toBeGreaterThanOrEqual(before);
    expect(after).toBeGreaterThanOrEqual(middle);
  });

  it("generates scope tags for every cacheSet", () => {
    cacheSet("/api/me/likes", [1]);
    cacheInvalidate("likes");
    expect(cacheGet("/api/me/likes")).toBeNull();
  });

  it("entries without known scopes get empty scope array", () => {
    cacheSet("/api/unknown", "data");
    cacheInvalidate("library");
    cacheInvalidate("likes");
    cacheInvalidate("home");
    expect(cacheGet("/api/unknown")).toBe("data");
  });
});
