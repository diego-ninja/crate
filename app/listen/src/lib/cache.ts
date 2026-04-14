import { apiUrl, getAuthToken } from "@/lib/api";
import { isNative } from "@/lib/capacitor";

// ── Cache Store ────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  scopes: string[];
}

const STORAGE_KEY = "crate-api-cache";
const memoryCache = new Map<string, CacheEntry>();

/** Scope tags for API URLs — determines what invalidation events affect which cache entries. */
function scopesForUrl(url: string): string[] {
  const scopes: string[] = [];

  // Home — depends on follows, likes, history, library
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
  // Artist detail
  else if (url.match(/^\/api\/artists\/\d+/)) {
    const m = url.match(/^\/api\/artists\/(\d+)/);
    if (m) scopes.push(`artist:${m[1]}`);
    scopes.push("library");
  }
  // Album detail
  else if (url.match(/^\/api\/albums\/\d+/)) {
    const m = url.match(/^\/api\/albums\/(\d+)/);
    if (m) scopes.push(`album:${m[1]}`);
    scopes.push("library");
  }
  // Artist/album listings
  else if (url.startsWith("/api/artists")) scopes.push("library");
  else if (url.startsWith("/api/albums")) scopes.push("library");
  // Search, browse, genres
  else if (url.startsWith("/api/browse")) scopes.push("library");
  else if (url.startsWith("/api/genres")) scopes.push("library");
  // Radio
  else if (url.startsWith("/api/radio")) scopes.push("library");
  // Shows
  else if (url.startsWith("/api/shows")) scopes.push("shows");

  return scopes;
}

/** Get cached data for a URL. Returns null if not cached. */
export function cacheGet<T>(url: string): T | null {
  const entry = memoryCache.get(url);
  if (entry) return entry.data as T;

  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${url}`);
    if (raw) {
      const parsed: CacheEntry<T> = JSON.parse(raw);
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

  // Persist to localStorage (async, non-blocking)
  try {
    localStorage.setItem(`${STORAGE_KEY}:${url}`, JSON.stringify(entry));
  } catch {
    // Storage full — evict oldest entries
    _evictOldest(5);
    try {
      localStorage.setItem(`${STORAGE_KEY}:${url}`, JSON.stringify(entry));
    } catch { /* give up */ }
  }
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
    memoryCache.delete(key);
    try { localStorage.removeItem(`${STORAGE_KEY}:${key}`); } catch { /* ignore */ }
  }
}

/** Clear entire cache. */
export function cacheClear(): void {
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
    memoryCache.delete(key);
    try { localStorage.removeItem(`${STORAGE_KEY}:${key}`); } catch { /* ignore */ }
  }
}

// ── SSE Listener ───────────────────────────────────────────────

let eventSource: EventSource | null = null;
const invalidationListeners = new Set<(scope: string) => void>();

/** Subscribe to cache invalidation events. Returns unsubscribe function. */
export function onCacheInvalidation(fn: (scope: string) => void): () => void {
  invalidationListeners.add(fn);
  return () => invalidationListeners.delete(fn);
}

/** Connect to the SSE cache invalidation stream. Call once at app startup. */
export function connectCacheEvents(): () => void {
  if (eventSource) return () => {};

  const base = isNative ? (import.meta.env.VITE_API_URL || "") : "";
  const token = getAuthToken();
  const url = token
    ? `${base}/api/cache/events?token=${encodeURIComponent(token)}`
    : `${base}/api/cache/events`;

  try {
    eventSource = new EventSource(apiUrl("/api/cache/events"));
    // For native, EventSource doesn't send cookies — use token URL
    if (isNative && token) {
      eventSource.close();
      eventSource = new EventSource(url);
    }

    eventSource.onmessage = (event) => {
      const scope = event.data?.trim();
      if (!scope) return;
      cacheInvalidate(scope);
      for (const fn of invalidationListeners) {
        try { fn(scope); } catch { /* ignore listener errors */ }
      }
    };

    eventSource.onerror = () => {
      // EventSource auto-reconnects. Just log.
      console.debug("[cache] SSE connection lost, reconnecting...");
    };
  } catch {
    // EventSource not supported or blocked
  }

  return () => {
    eventSource?.close();
    eventSource = null;
  };
}
