/**
 * Multi-Crate server configuration — Capacitor-only.
 *
 * Listen Web is always a first-party surface for a single Crate instance
 * (the same one that serves the web app). Capacitor builds, in contrast,
 * are a single APK that can be pointed at ANY Crate instance the user
 * operates. That means we need:
 *
 *   - a place to remember the servers a user has added
 *   - per-server auth tokens (each instance issues its own)
 *   - a "current server" concept for the whole app
 *   - live reactivity when the current server changes
 *
 * Everything lives in localStorage. The shape is intentionally small so
 * a future export/import flow is trivial.
 */
import { isNative } from "@/lib/capacitor";

const SERVERS_KEY = "crate-servers";
const CURRENT_KEY = "crate-current-server";
const LEGACY_TOKEN_KEY = "crate-auth-token";

export const SERVER_STORE_EVENT = "crate-server-store-change";

export interface ServerConfig {
  /** Stable id. UUID-ish, generated at creation. */
  id: string;
  /** User-facing label, defaults to hostname. */
  label: string;
  /** Base URL without trailing slash, e.g. https://api.foo.com. */
  url: string;
  /** Bearer token for this server, or null if not logged in yet. */
  token: string | null;
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalise a user-typed URL: strip trailing slashes, default scheme to
 * https if missing. We do NOT try to be clever about paths — if the
 * user pastes a URL with /api in it, we leave it; the API client still
 * prefixes paths that start with /api so this is safe.
 */
export function normaliseServerUrl(input: string): string {
  let url = input.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "");
}

export function deriveLabel(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.replace(/^api\./, "");
  } catch {
    return url;
  }
}

export function getServers(): ServerConfig[] {
  if (!isNative) return [];
  try {
    return safeJsonParse<ServerConfig[]>(localStorage.getItem(SERVERS_KEY), []);
  } catch {
    return [];
  }
}

export function getCurrentServerId(): string | null {
  if (!isNative) return null;
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function getCurrentServer(): ServerConfig | null {
  const id = getCurrentServerId();
  if (!id) return null;
  return getServers().find((s) => s.id === id) ?? null;
}

function writeServers(servers: ServerConfig[]): void {
  try {
    localStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
  } catch { /* ignore */ }
}

function dispatchChange(): void {
  try {
    window.dispatchEvent(new CustomEvent(SERVER_STORE_EVENT));
  } catch { /* ignore (SSR) */ }
}

export function addServer(url: string, label?: string): ServerConfig {
  const normalised = normaliseServerUrl(url);
  // Don't duplicate a server we already know about — return the
  // existing entry so the caller can keep its token.
  const existing = getServers().find((s) => s.url === normalised);
  if (existing) return existing;
  const server: ServerConfig = {
    id: generateId(),
    label: (label || deriveLabel(normalised)).trim() || deriveLabel(normalised),
    url: normalised,
    token: null,
  };
  writeServers([...getServers(), server]);
  dispatchChange();
  return server;
}

export function removeServer(id: string): void {
  const servers = getServers().filter((s) => s.id !== id);
  writeServers(servers);
  if (getCurrentServerId() === id) {
    try {
      // Fall back to the first remaining server, or no active server.
      if (servers[0]) localStorage.setItem(CURRENT_KEY, servers[0].id);
      else localStorage.removeItem(CURRENT_KEY);
    } catch { /* ignore */ }
  }
  dispatchChange();
}

export function setCurrentServerId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
    dispatchChange();
  } catch { /* ignore */ }
}

export function setCurrentServerToken(token: string | null): void {
  const id = getCurrentServerId();
  if (!id) return;
  const servers = getServers().map((s) => (s.id === id ? { ...s, token } : s));
  writeServers(servers);
  dispatchChange();
}

export function updateServerLabel(id: string, label: string): void {
  const trimmed = label.trim();
  if (!trimmed) return;
  const servers = getServers().map((s) => (s.id === id ? { ...s, label: trimmed } : s));
  writeServers(servers);
  dispatchChange();
}

/**
 * Migrate a pre-multi-server install: if there's a token under the old
 * global TOKEN_KEY and no servers yet, seed the store with the build-time
 * VITE_API_URL and reuse the token. Runs once at first access; subsequent
 * calls are cheap.
 */
export function migrateLegacyToken(defaultUrl: string): void {
  if (!isNative) return;
  if (getServers().length > 0) return;
  try {
    const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (!legacyToken || !defaultUrl) return;
    const seeded = addServer(defaultUrl);
    const patched = getServers().map((s) =>
      s.id === seeded.id ? { ...s, token: legacyToken } : s,
    );
    writeServers(patched);
    setCurrentServerId(seeded.id);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch { /* ignore */ }
}
