/**
 * Multi-Crate server configuration — configurable native shells.
 *
 * Listen Web is always a first-party surface for a single Crate instance
 * (the same one that serves the web app). Capacitor and Tauri builds, in
 * contrast, can be pointed at a Crate instance the user operates. That means
 * we need:
 *
 *   - a place to remember the servers a user has added
 *   - per-server auth tokens (each instance issues its own)
 *   - a "current server" concept for the whole app
 *   - live reactivity when the current server changes
 *
 * Public server descriptors live in localStorage. Capacitor credentials live
 * in the platform keystore/keychain and are loaded into memory before React
 * renders. Tauri keeps the existing storage contract until its native store
 * migration is implemented separately.
 */
import {
  clearRuntimeServerSecrets,
  getRuntimeServerSecret,
  loadNativeServerSecrets,
  removeQueuedSecret,
  removeRuntimeServerSecret,
  queueSecretWrite,
  setRuntimeServerSecret,
  type ServerSecret,
} from "@/lib/server-store-secrets";
import { isCapacitorRuntime, usesConfigurableServer } from "@/lib/platform";

export { waitForPendingSecureSessionWrites } from "@/lib/server-store-secrets";

const SERVERS_KEY = "crate-servers:v1";
const CURRENT_KEY = "crate-current-server";
const LEGACY_TOKEN_KEY = "crate-auth-token";
const ALLOW_INSECURE_LOOPBACK =
  import.meta.env.DEV &&
  import.meta.env.VITE_ALLOW_INSECURE_LOOPBACK === "true";

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
  /** ISO timestamp for the current access token expiry, when known. */
  tokenExpiresAt: string | null;
  /** Long-lived refresh token for this server, or null when unavailable. */
  refreshToken: string | null;
}

interface StoredServerConfig {
  id: string;
  label: string;
  url: string;
  tokenExpiresAt: string | null;
  token?: string | null;
  refreshToken?: string | null;
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
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return `srv-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
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

export function isAllowedServerUrl(
  input: string,
  options: { allowInsecureLoopback?: boolean } = {},
): boolean {
  try {
    const url = new URL(input);
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:" || !options.allowInsecureLoopback)
      return false;
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
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
  if (!usesConfigurableServer) return [];
  try {
    return safeJsonParse<StoredServerConfig[]>(
      localStorage.getItem(SERVERS_KEY),
      [],
    ).map((server) => ({
      ...server,
      token: isCapacitorRuntime
        ? getRuntimeServerSecret(server.id).token
        : server.token ?? null,
      tokenExpiresAt: server.tokenExpiresAt ?? null,
      refreshToken: isCapacitorRuntime
        ? getRuntimeServerSecret(server.id).refreshToken
        : server.refreshToken ?? null,
    }));
  } catch {
    return [];
  }
}

export function getCurrentServerId(): string | null {
  if (!usesConfigurableServer) return null;
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
    const persisted: StoredServerConfig[] = servers.map((server) => ({
      id: server.id,
      label: server.label,
      url: server.url,
      tokenExpiresAt: server.tokenExpiresAt,
      ...(isCapacitorRuntime
        ? {}
        : {
            token: server.token,
            refreshToken: server.refreshToken,
          }),
    }));
    localStorage.setItem(SERVERS_KEY, JSON.stringify(persisted));
  } catch {
    /* ignore */
  }
}

export async function bootstrapNativeSessionStore(): Promise<void> {
  if (!isCapacitorRuntime) return;
  const records = safeJsonParse<StoredServerConfig[]>(
    localStorage.getItem(SERVERS_KEY),
    [],
  );
  let nextSecrets: Map<string, ServerSecret>;
  try {
    nextSecrets = await loadNativeServerSecrets(records);
  } catch {
    throw new Error("Native session migration failed");
  }
  clearRuntimeServerSecrets();
  for (const [serverId, secret] of nextSecrets) {
    setRuntimeServerSecret(serverId, secret);
  }
  writeServers(
    records.map((server) => ({
      id: server.id,
      label: server.label,
      url: server.url,
      token: nextSecrets.get(server.id)?.token ?? null,
      tokenExpiresAt: server.tokenExpiresAt ?? null,
      refreshToken: nextSecrets.get(server.id)?.refreshToken ?? null,
    })),
  );
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

function dispatchChange(): void {
  try {
    window.dispatchEvent(new CustomEvent(SERVER_STORE_EVENT));
  } catch {
    /* ignore (SSR) */
  }
}

export function addServer(url: string, label?: string): ServerConfig {
  const normalised = normaliseServerUrl(url);
  if (
    !isAllowedServerUrl(normalised, {
      allowInsecureLoopback: ALLOW_INSECURE_LOOPBACK,
    })
  ) {
    throw new Error("Crate servers must use HTTPS");
  }
  // Don't duplicate a server we already know about — return the
  // existing entry so the caller can keep its token.
  const existing = getServers().find((s) => s.url === normalised);
  if (existing) return existing;
  const server: ServerConfig = {
    id: generateId(),
    label: (label || deriveLabel(normalised)).trim() || deriveLabel(normalised),
    url: normalised,
    token: null,
    tokenExpiresAt: null,
    refreshToken: null,
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
    } catch {
      /* ignore */
    }
  }
  removeRuntimeServerSecret(id);
  removeQueuedSecret(id);
  dispatchChange();
}

export function setCurrentServerId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
    dispatchChange();
  } catch {
    /* ignore */
  }
}

export function setCurrentServerToken(
  token: string | null,
  tokenExpiresAt?: string | null,
): void {
  const id = getCurrentServerId();
  if (!id) return;
  if (isCapacitorRuntime) {
    const current = getRuntimeServerSecret(id);
    const nextSecret = { ...current, token };
    setRuntimeServerSecret(id, nextSecret);
    queueSecretWrite(id, nextSecret);
  }
  const servers = getServers().map((s) =>
    s.id === id
      ? {
          ...s,
          token,
          tokenExpiresAt:
            tokenExpiresAt === undefined ? s.tokenExpiresAt : tokenExpiresAt,
        }
      : s,
  );
  writeServers(servers);
  dispatchChange();
}

export function setCurrentServerRefreshToken(
  refreshToken: string | null,
): void {
  const id = getCurrentServerId();
  if (!id) return;
  if (isCapacitorRuntime) {
    const current = getRuntimeServerSecret(id);
    const nextSecret = { ...current, refreshToken };
    setRuntimeServerSecret(id, nextSecret);
    queueSecretWrite(id, nextSecret);
  }
  const servers = getServers().map((s) =>
    s.id === id ? { ...s, refreshToken } : s,
  );
  writeServers(servers);
  dispatchChange();
}

export function setCurrentServerAuthTokens(
  token: string | null,
  refreshToken?: string | null,
  tokenExpiresAt?: string | null,
): void {
  const id = getCurrentServerId();
  if (!id) return;
  if (isCapacitorRuntime) {
    const current = getRuntimeServerSecret(id);
    const nextSecret = {
      token,
      refreshToken:
        refreshToken === undefined ? current.refreshToken : refreshToken,
    };
    setRuntimeServerSecret(id, nextSecret);
    queueSecretWrite(id, nextSecret);
  }
  const servers = getServers().map((s) =>
    s.id === id
      ? {
          ...s,
          token,
          tokenExpiresAt:
            tokenExpiresAt === undefined ? s.tokenExpiresAt : tokenExpiresAt,
          refreshToken:
            refreshToken === undefined ? s.refreshToken : refreshToken,
        }
      : s,
  );
  writeServers(servers);
  dispatchChange();
}

export function updateServerLabel(id: string, label: string): void {
  const trimmed = label.trim();
  if (!trimmed) return;
  const servers = getServers().map((s) =>
    s.id === id ? { ...s, label: trimmed } : s,
  );
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
  if (!usesConfigurableServer) return;
  if (getServers().length > 0) return;
  try {
    const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (!legacyToken || !defaultUrl) return;
    const seeded = addServer(defaultUrl);
    if (isCapacitorRuntime) {
      const migrationRecord: StoredServerConfig = {
        id: seeded.id,
        label: seeded.label,
        url: seeded.url,
        token: legacyToken,
        tokenExpiresAt: null,
        refreshToken: null,
      };
      localStorage.setItem(SERVERS_KEY, JSON.stringify([migrationRecord]));
      setCurrentServerId(seeded.id);
      return;
    }
    const patched = getServers().map((s) =>
      s.id === seeded.id
        ? { ...s, token: legacyToken, tokenExpiresAt: null, refreshToken: null }
        : s,
    );
    writeServers(patched);
    setCurrentServerId(seeded.id);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function seedDefaultServer(defaultUrl: string): void {
  if (!usesConfigurableServer) return;
  if (getServers().length > 0) return;
  const normalised = normaliseServerUrl(defaultUrl);
  if (!normalised) return;
  const seeded = addServer(normalised);
  setCurrentServerId(seeded.id);
}
