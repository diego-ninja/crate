import { apiSseUrl } from "@/lib/api";
import { getStoredAuthUserId } from "@/lib/auth-user-storage";
import { usesConfigurableServer } from "@/lib/platform";
import { recordAssetInvalidationScope } from "@/lib/library-routes";
import { subscribeMediaAccessTickets } from "@/lib/media-access";
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
  url: string;
  context: string;
}

const STORAGE_KEY = "crate-api-cache:v2";
const CACHE_EVENT_ID_STORAGE_KEY = "crate-cache-events:last-event-id:v1";
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

function cacheContext(): string {
  try {
    const serverId = localStorage.getItem("crate-current-server") || "web";
    const userId = getStoredAuthUserId() || "anonymous";
    return `${serverId}:${userId}`;
  } catch {
    return "web:anonymous";
  }
}

function scopedCacheKey(url: string, context = cacheContext()): string {
  return `${context}\u0000${url}`;
}

function storageCacheKey(url: string, context = cacheContext()): string {
  return `${STORAGE_KEY}:${context}:${url}`;
}

function _cancelPendingStorageWrite(cacheKey: string): void {
  const handle = pendingStorageWrites.get(cacheKey);
  if (handle == null) return;
  pendingStorageWrites.delete(cacheKey);
  if (
    typeof handle === "number" &&
    typeof globalThis.cancelIdleCallback === "function"
  ) {
    globalThis.cancelIdleCallback(handle);
    return;
  }
  globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function _writeEntryToStorage(cacheKey: string): void {
  pendingStorageWrites.delete(cacheKey);
  const entry = memoryCache.get(cacheKey);
  if (!entry) return;

  try {
    localStorage.setItem(
      storageCacheKey(entry.url, entry.context),
      JSON.stringify(entry),
    );
  } catch {
    _evictOldest(5);
    try {
      localStorage.setItem(
        storageCacheKey(entry.url, entry.context),
        JSON.stringify(entry),
      );
    } catch {
      /* give up */
    }
  }
}

function _scheduleStorageWrite(cacheKey: string): void {
  _cancelPendingStorageWrite(cacheKey);

  const runWrite = () => _writeEntryToStorage(cacheKey);

  if (typeof globalThis.requestIdleCallback === "function") {
    const handle = globalThis.requestIdleCallback(runWrite, {
      timeout: STORAGE_WRITE_TIMEOUT_MS,
    });
    pendingStorageWrites.set(cacheKey, handle);
    return;
  }

  const handle = globalThis.setTimeout(runWrite, 0);
  pendingStorageWrites.set(cacheKey, handle);
}

/** Scope tags for API URLs — determines what invalidation events
 *  affect which cache entries. Every URL that goes through useApi
 *  should be covered here; unmapped URLs won't invalidate. */
export function scopesForUrl(url: string): string[] {
  const scopes: string[] = [];

  // Home — per-section scopes
  if (url === "/api/me/home/discovery")
    return ["home", "library", "global_catalog", "follows", "history", "likes"];
  if (url === "/api/me/home/hero") return ["home", "library", "follows"];
  if (url === "/api/me/home/recently-played") return ["home", "history"];
  if (url === "/api/me/home/mixes") return ["home", "library"];
  if (url === "/api/me/home/suggested-albums") return ["home", "library"];
  if (url === "/api/me/home/recommended-tracks")
    return ["home", "library", "history"];
  if (url === "/api/me/home/radio-stations") return ["home", "follows"];
  if (url === "/api/me/home/favorite-artists")
    return ["home", "follows", "history"];
  if (url === "/api/me/home/essentials") return ["home", "follows"];
  // Home sections (compat / other home endpoints)
  if (url.startsWith("/api/me/home")) {
    scopes.push("home", "follows", "likes", "history", "library");
  }
  // User-specific data
  else if (url.startsWith("/api/me/likes")) scopes.push("likes");
  else if (url.startsWith("/api/me/follows")) scopes.push("follows");
  else if (url.startsWith("/api/me/albums")) scopes.push("saved_albums");
  else if (url.startsWith("/api/catalog/me/follows"))
    scopes.push("follows", "library");
  else if (url.startsWith("/api/catalog/me/artists"))
    scopes.push("follows", "library");
  else if (url.startsWith("/api/catalog/me/albums"))
    scopes.push("saved_albums", "library");
  else if (url.match(/^\/api\/catalog\/artists\/[^/]+\/page(?:\?|$)/))
    scopes.push("artist_bio", "library");
  else if (url.startsWith("/api/me/history")) scopes.push("history");
  else if (url.startsWith("/api/me/stats")) scopes.push("history");
  else if (url.startsWith("/api/users/") && url.includes("/stats"))
    scopes.push("history");
  else if (url.startsWith("/api/stats/dashboard")) scopes.push("history");
  else if (url.startsWith("/api/me/upcoming"))
    scopes.push("upcoming", "follows", "library");
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
    if (url.match(/^\/api\/artists\/\d+(?:\?.*)?$/)) scopes.push("artist_bio");
  } else if (url.match(/^\/api\/artists\/by-entity\/[^/]+(?:\?|$)/))
    scopes.push("library", "follows", "artist_bio");
  else if (url.startsWith("/api/artist-slugs/")) {
    scopes.push("library", "follows");
    if (url.match(/^\/api\/artist-slugs\/[^/]+(?:\/page)?(?:\?|$)/))
      scopes.push("artist_bio");
  }
  // Album detail
  else if (url.match(/^\/api\/albums\/\d+/)) {
    const m = url.match(/^\/api\/albums\/(\d+)/);
    if (m) scopes.push(`album:${m[1]}`);
    scopes.push("library");
  } else if (url.match(/^\/api\/artist-slugs\/[^/]+\/albums\//))
    scopes.push("library");
  // Track detail/EQ surfaces
  else if (url.match(/^\/api\/tracks\/\d+\/eq/)) {
    const m = url.match(/^\/api\/tracks\/(\d+)\/eq/);
    if (m) scopes.push(`track:${m[1]}`, `track:eq:${m[1]}`);
    scopes.push("library");
  } else if (url.match(/^\/api\/tracks\/by-entity\/[^/]+\/eq/)) {
    scopes.push("library");
  }
  // Artist/album listings
  else if (url.startsWith("/api/artists")) scopes.push("library");
  else if (url.startsWith("/api/albums")) scopes.push("library");
  // Search, browse, genres
  else if (url.startsWith("/api/catalog")) scopes.push("library");
  else if (url.startsWith("/api/browse")) scopes.push("library");
  else if (url.match(/^\/api\/genres\/[^/?]+(?:\?|$)/))
    scopes.push("library", "shows", "upcoming");
  else if (url.startsWith("/api/genres")) scopes.push("library");
  // Radio
  else if (url === "/api/radio/stations")
    scopes.push("library", "follows", "history");
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
  const context = cacheContext();
  const cacheKey = scopedCacheKey(url, context);
  const entry = memoryCache.get(cacheKey);
  if (entry) return entry.data as T;

  // Fallback to localStorage with TTL check
  try {
    const raw = localStorage.getItem(storageCacheKey(url, context));
    if (raw) {
      const parsed: CacheEntry<T> = JSON.parse(raw);
      // Discard entries older than the safety-net TTL
      if (Date.now() - parsed.timestamp > LOCALSTORAGE_MAX_AGE_MS) {
        localStorage.removeItem(storageCacheKey(url, context));
        return null;
      }
      memoryCache.set(cacheKey, parsed);
      return parsed.data;
    }
  } catch {
    /* ignore */
  }

  return null;
}

/** Store data in cache with scope tags. */
export function cacheSet<T>(url: string, data: T): void {
  const context = cacheContext();
  const scopes = scopesForUrl(url);
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    scopes,
    url,
    context,
  };
  const cacheKey = scopedCacheKey(url, context);
  memoryCache.set(cacheKey, entry);
  _scheduleStorageWrite(cacheKey);
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
    const entry = memoryCache.get(key);
    _cancelPendingStorageWrite(key);
    memoryCache.delete(key);
    try {
      if (entry) {
        localStorage.removeItem(storageCacheKey(entry.url, entry.context));
      }
    } catch {
      /* ignore */
    }
  }
}

/** Clear entire cache. */
export function cacheClear(): void {
  for (const cacheKey of pendingStorageWrites.keys()) {
    _cancelPendingStorageWrite(cacheKey);
  }
  memoryCache.clear();
  try {
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith(STORAGE_KEY),
    );
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

function _evictOldest(count: number): void {
  const entries = [...memoryCache.entries()]
    .sort((a, b) => a[1].timestamp - b[1].timestamp)
    .slice(0, count);
  for (const [key, entry] of entries) {
    _cancelPendingStorageWrite(key);
    memoryCache.delete(key);
    try {
      localStorage.removeItem(storageCacheKey(entry.url, entry.context));
    } catch {
      /* ignore */
    }
  }
}

// ── SSE Listener ───────────────────────────────────────────────

let eventSource: EventSource | null = null;
const invalidationListeners = new Set<(scope: string) => void>();
const CACHE_EVENTS_CHANNEL = "cache-invalidations";
const CACHE_EVENTS_DEGRADE_AFTER_MS = 75_000;

function persistedCacheEventId(): string | null {
  try {
    const eventId = localStorage.getItem(CACHE_EVENT_ID_STORAGE_KEY)?.trim();
    return eventId && /^\d+$/.test(eventId) ? eventId : null;
  } catch {
    return null;
  }
}

function persistCacheEventId(eventId: string | undefined): void {
  if (!eventId) return;
  const normalized = eventId.trim();
  if (!/^\d+$/.test(normalized)) return;
  try {
    localStorage.setItem(CACHE_EVENT_ID_STORAGE_KEY, normalized);
  } catch {
    /* cache invalidation still works for the current page */
  }
}

/** Subscribe to cache invalidation events. Returns unsubscribe function. */
export function onCacheInvalidation(fn: (scope: string) => void): () => void {
  invalidationListeners.add(fn);
  return () => invalidationListeners.delete(fn);
}

export function onCacheReconnect(
  fn: (state: SseChannelState) => void,
): () => void {
  return onSseReconnect(CACHE_EVENTS_CHANNEL, fn);
}

export function onCacheEventsHealthChange(
  fn: (state: SseChannelState) => void,
): () => void {
  return onSseChannelState(CACHE_EVENTS_CHANNEL, fn);
}

/** Connect to the SSE cache invalidation stream. Call once at app startup.
 *
 *  The SSE stream carries event IDs (``id: N``). On reconnect, the
 *  browser sends ``Last-Event-ID: N`` automatically while the page is
 *  alive. We also persist the cursor so a full page reload can resume
 *  without replaying invalidations already applied by the previous page. */
export function connectCacheEvents(): () => void {
  if (eventSource) return () => {};

  let disposed = false;
  const open = () => {
    const lastEventId = persistedCacheEventId();
    const path = lastEventId
      ? `/api/cache/events?last_event_id=${encodeURIComponent(lastEventId)}`
      : "/api/cache/events";
    const url = apiSseUrl(path);

    try {
      eventSource = new EventSource(url, {
        withCredentials: !usesConfigurableServer,
      });

      eventSource.onopen = () => {
        markSseChannelOpen(CACHE_EVENTS_CHANNEL, {
          degradeAfterMs: CACHE_EVENTS_DEGRADE_AFTER_MS,
        });
      };

      eventSource.onmessage = (event) => {
        const scope = event.data?.trim();
        if (!scope) return;
        persistCacheEventId(event.lastEventId);
        markSseChannelEvent(CACHE_EVENTS_CHANNEL, {
          degradeAfterMs: CACHE_EVENTS_DEGRADE_AFTER_MS,
        });
        recordAssetInvalidationScope(scope);
        cacheInvalidate(scope);
        for (const fn of invalidationListeners) {
          try {
            fn(scope);
          } catch {
            /* ignore listener errors */
          }
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
        console.debug("[cache] SSE connection lost, reconnecting...");
      };
    } catch {
      eventSource = null;
    }
  };

  open();
  const unsubscribeTickets = subscribeMediaAccessTickets(() => {
    if (disposed) return;
    eventSource?.close();
    eventSource = null;
    open();
  });

  return () => {
    disposed = true;
    unsubscribeTickets();
    markSseChannelClosed(CACHE_EVENTS_CHANNEL, {
      degradeAfterMs: CACHE_EVENTS_DEGRADE_AFTER_MS,
    });
    eventSource?.close();
    eventSource = null;
  };
}
