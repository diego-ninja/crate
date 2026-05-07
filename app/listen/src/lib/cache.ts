import { apiSseUrl } from "@/lib/api";
import { isNative } from "@/lib/capacitor";
import { recordAssetInvalidationScope } from "@/lib/library-routes";
import {
  markSseChannelClosed,
  markSseChannelError,
  markSseChannelEvent,
  markSseChannelOpen,
  onSseChannelState,
  onSseReconnect,
  type SseChannelState,
} from "@/lib/sse";

// ── Cache Store ────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  scopes: string[];
}

const STORAGE_KEY = "crate-api-cache";
const memoryCache = new Map<string, CacheEntry>();
type ScheduledStorageWriteHandle = number | ReturnType<typeof setTimeout>;
const pendingStorageWrites = new Map<string, ScheduledStorageWriteHandle>();

/** Safety-net TTL for localStorage entries.
 *
 * Listen's cache is primarily invalidation-driven; this TTL only protects
 * against very old/corrupt local snapshots after a client has missed events
 * for a long time. Keep it long enough that daily app opens do not turn into
 * cold starts.
 */
const LOCALSTORAGE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const STORAGE_WRITE_TIMEOUT_MS = 250;

function _cancelPendingStorageWrite(url: string): void {
  const handle = pendingStorageWrites.get(url);
  if (handle == null) return;
  pendingStorageWrites.delete(url);
  if (typeof handle === "number" && typeof globalThis.cancelIdleCallback === "function") {
    globalThis.cancelIdleCallback(handle);
    return;
  }
  globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function _writeEntryToStorage(url: string): void {
  pendingStorageWrites.delete(url);
  const entry = memoryCache.get(url);
  if (!entry) return;

  try {
    localStorage.setItem(`${STORAGE_KEY}:${url}`, JSON.stringify(entry));
  } catch {
    _evictOldest(5);
    try {
      localStorage.setItem(`${STORAGE_KEY}:${url}`, JSON.stringify(entry));
    } catch {
      /* give up */
    }
  }
}

function _scheduleStorageWrite(url: string): void {
  _cancelPendingStorageWrite(url);

  const runWrite = () => _writeEntryToStorage(url);

  if (typeof globalThis.requestIdleCallback === "function") {
    const handle = globalThis.requestIdleCallback(runWrite, {
      timeout: STORAGE_WRITE_TIMEOUT_MS,
    });
    pendingStorageWrites.set(url, handle);
    return;
  }

  const handle = globalThis.setTimeout(runWrite, 0);
  pendingStorageWrites.set(url, handle);
}

/** Scope tags for API URLs — determines what invalidation events
 *  affect which cache entries. Every URL that goes through useApi
 *  should be covered here; unmapped URLs won't invalidate. */
export function scopesForUrl(url: string): string[] {
  const scopes: string[] = [];

  // Home — per-section scopes
  if (url === "/api/me/home/discovery") return ["home", "library", "follows", "history", "likes"];
  if (url === "/api/me/home/hero") return ["home", "library", "follows"];
  if (url === "/api/me/home/recently-played") return ["home", "history"];
  if (url === "/api/me/home/mixes") return ["home", "library"];
  if (url === "/api/me/home/suggested-albums") return ["home", "library"];
  if (url === "/api/me/home/recommended-tracks") return ["home", "library", "history"];
  if (url === "/api/me/home/radio-stations") return ["home", "follows"];
  if (url === "/api/me/home/favorite-artists") return ["home", "follows", "history"];
  if (url === "/api/me/home/essentials") return ["home", "follows"];
  // Home sections (compat / other home endpoints)
  if (url.startsWith("/api/me/home")) {
    scopes.push("home", "follows", "likes", "history", "library");
  }
  // User-specific data
  else if (url.startsWith("/api/me/likes")) scopes.push("likes");
  else if (url.startsWith("/api/me/follows")) scopes.push("follows");
  else if (url.startsWith("/api/me/albums")) scopes.push("saved_albums");
  else if (url.startsWith("/api/me/history")) scopes.push("history");
  else if (url.startsWith("/api/me/stats")) scopes.push("history");
  else if (url.startsWith("/api/me/upcoming")) scopes.push("upcoming", "follows", "library");
  else if (url.startsWith("/api/me/shows")) scopes.push("shows");
  // Playlists
  else if (url.startsWith("/api/playlists")) {
    scopes.push("playlists");
    const m = url.match(/^\/api\/playlists\/(\d+)/);
    if (m) scopes.push(`playlist:${m[1]}`);
  }
  // Curation
  else if (url.startsWith("/api/curation")) scopes.push("curation");
  // Artist detail — also invalidates on follows (follow button state)
  else if (url.match(/^\/api\/artists\/\d+/)) {
    const m = url.match(/^\/api\/artists\/(\d+)/);
    if (m) scopes.push(`artist:${m[1]}`);
    scopes.push("library", "follows");
  }
  else if (url.startsWith("/api/artist-slugs/")) scopes.push("library", "follows");
  // Album detail
  else if (url.match(/^\/api\/albums\/\d+/)) {
    const m = url.match(/^\/api\/albums\/(\d+)/);
    if (m) scopes.push(`album:${m[1]}`);
    scopes.push("library");
  }
  else if (url.match(/^\/api\/artist-slugs\/[^/]+\/albums\//)) scopes.push("library");
  // Artist/album listings
  else if (url.startsWith("/api/artists")) scopes.push("library");
  else if (url.startsWith("/api/albums")) scopes.push("library");
  // Search, browse, genres
  else if (url.startsWith("/api/search")) scopes.push("library");
  else if (url.startsWith("/api/browse")) scopes.push("library");
  else if (url.startsWith("/api/genres")) scopes.push("library");
  // Radio
  else if (url.startsWith("/api/radio")) scopes.push("library");
  // Shows
  else if (url.startsWith("/api/shows")) scopes.push("shows");
  else if (url.startsWith("/api/upcoming")) scopes.push("upcoming");
  // Jam rooms
  else if (url.startsWith("/api/jam")) scopes.push("jam");

  return scopes;
}

/** Get cached data for a URL. Returns null if not cached or expired. */
export function cacheGet<T>(url: string): T | null {
  const entry = memoryCache.get(url);
  if (entry) return entry.data as T;

  // Fallback to localStorage with TTL check
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${url}`);
    if (raw) {
      const parsed: CacheEntry<T> = JSON.parse(raw);
      // Discard entries older than the safety-net TTL
      if (Date.now() - parsed.timestamp > LOCALSTORAGE_MAX_AGE_MS) {
        localStorage.removeItem(`${STORAGE_KEY}:${url}`);
        return null;
      }
      memoryCache.set(url, parsed);
      return parsed.data;
    }
  } catch { /* ignore */ }

  return null;
}

/** Store data in cache with scope tags. */
export function cacheSet<T>(url: string, data: T): void {
  const scopes = scopesForUrl(url);
  const entry: CacheEntry<T> = { data, timestamp: Date.now(), scopes };
  memoryCache.set(url, entry);
  _scheduleStorageWrite(url);
}

/** Invalidate all cache entries matching a scope. */
export function cacheInvalidate(scope: string): void {
  const keysToRemove: string[] = [];

  for (const [key, entry] of memoryCache) {
    if (entry.scopes.includes(scope)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    _cancelPendingStorageWrite(key);
    memoryCache.delete(key);
    try { localStorage.removeItem(`${STORAGE_KEY}:${key}`); } catch { /* ignore */ }
  }
}

/** Clear entire cache. */
export function cacheClear(): void {
  for (const key of pendingStorageWrites.keys()) {
    _cancelPendingStorageWrite(key);
  }
  memoryCache.clear();
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(STORAGE_KEY));
    for (const k of keys) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

function _evictOldest(count: number): void {
  const entries = [...memoryCache.entries()]
    .sort((a, b) => a[1].timestamp - b[1].timestamp)
    .slice(0, count);
  for (const [key] of entries) {
    _cancelPendingStorageWrite(key);
    memoryCache.delete(key);
    try { localStorage.removeItem(`${STORAGE_KEY}:${key}`); } catch { /* ignore */ }
  }
}

// ── SSE Listener ───────────────────────────────────────────────

let eventSource: EventSource | null = null;
const invalidationListeners = new Set<(scope: string) => void>();
const CACHE_EVENTS_CHANNEL = "cache-invalidations";
const CACHE_EVENTS_DEGRADE_AFTER_MS = 75_000;

/** Subscribe to cache invalidation events. Returns unsubscribe function. */
export function onCacheInvalidation(fn: (scope: string) => void): () => void {
  invalidationListeners.add(fn);
  return () => invalidationListeners.delete(fn);
}

export function onCacheReconnect(fn: (state: SseChannelState) => void): () => void {
  return onSseReconnect(CACHE_EVENTS_CHANNEL, fn);
}

export function onCacheEventsHealthChange(fn: (state: SseChannelState) => void): () => void {
  return onSseChannelState(CACHE_EVENTS_CHANNEL, fn);
}

/** Connect to the SSE cache invalidation stream. Call once at app startup.
 *
 *  The SSE stream carries event IDs (``id: N``). On reconnect, the
 *  browser sends ``Last-Event-ID: N`` automatically, and the server
 *  replays everything the client missed. No custom reconnection
 *  logic needed — EventSource handles it. */
export function connectCacheEvents(): () => void {
  if (eventSource) return () => {};

  const url = apiSseUrl("/api/cache/events");

  try {
    eventSource = new EventSource(url, { withCredentials: !isNative });

    eventSource.onopen = () => {
      markSseChannelOpen(CACHE_EVENTS_CHANNEL, {
        degradeAfterMs: CACHE_EVENTS_DEGRADE_AFTER_MS,
      });
    };

    eventSource.onmessage = (event) => {
      const scope = event.data?.trim();
      if (!scope) return;
      markSseChannelEvent(CACHE_EVENTS_CHANNEL, {
        degradeAfterMs: CACHE_EVENTS_DEGRADE_AFTER_MS,
      });
      recordAssetInvalidationScope(scope);
      cacheInvalidate(scope);
      for (const fn of invalidationListeners) {
        try { fn(scope); } catch { /* ignore listener errors */ }
      }
    };

    eventSource.addEventListener("heartbeat", () => {
      markSseChannelEvent(CACHE_EVENTS_CHANNEL, {
        degradeAfterMs: CACHE_EVENTS_DEGRADE_AFTER_MS,
      });
    });

    eventSource.onerror = () => {
      markSseChannelError(CACHE_EVENTS_CHANNEL, {
        degradeAfterMs: CACHE_EVENTS_DEGRADE_AFTER_MS,
      });
      // EventSource auto-reconnects with Last-Event-ID. Just log.
      console.debug("[cache] SSE connection lost, reconnecting...");
    };
  } catch {
    // EventSource not supported or blocked
  }

  return () => {
    markSseChannelClosed(CACHE_EVENTS_CHANNEL, {
      degradeAfterMs: CACHE_EVENTS_DEGRADE_AFTER_MS,
    });
    eventSource?.close();
    eventSource = null;
  };
}
