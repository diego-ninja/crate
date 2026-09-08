import { isCapacitorRuntime, usesConfigurableServer } from "@/lib/platform";
import { getApiAuthHeaders } from "@/lib/auth-session";
import { getCurrentServer, SERVER_STORE_EVENT } from "@/lib/server-store";
import {
  clearMediaAccessTickets,
  getMediaAccessTicket,
  getMediaAccessTargets,
  invalidateMediaAccessAudience,
  invalidateMediaAccessTicket,
  signalMediaAccessResume,
  setMediaAccessTickets,
  type MediaAccessAudience,
  type MediaAccessTarget,
  type MediaAccessTickets,
} from "@/lib/media-access";

const MEDIA_ACCESS_BATCH_SIZE = 128;
const queuedMediaAccessTargets = new Map<
  string,
  Map<string, MediaAccessTarget>
>();
const scheduledMediaAccessScopes = new Set<string>();
const mediaAccessRefreshPromises = new Map<string, Promise<boolean>>();
const inFlightMediaAccessTargets = new Map<string, Set<string>>();
const ensuredMediaAccessPromises = new Map<string, Promise<string>>();

export class MediaAccessTicketError extends Error {
  readonly audience: MediaAccessAudience;
  readonly path: string;

  constructor(audience: MediaAccessAudience, path: string) {
    super(`Could not acquire ${audience} access for ${path}`);
    this.name = "MediaAccessTicketError";
    this.audience = audience;
    this.path = path;
  }
}

function mediaAccessTargetKey(target: MediaAccessTarget): string {
  return `${target.audience}:${target.path}`;
}

function scheduleMediaAccessFlush(scope: string): void {
  if (
    scheduledMediaAccessScopes.has(scope) ||
    mediaAccessRefreshPromises.has(scope)
  ) {
    return;
  }
  scheduledMediaAccessScopes.add(scope);
  queueMicrotask(() => {
    scheduledMediaAccessScopes.delete(scope);
    void flushMediaAccessTargets(scope);
  });
}

export function queueMediaAccessTarget(
  audience: MediaAccessAudience,
  path: string,
  scope: string,
): void {
  const key = mediaAccessTargetKey({ audience, path });
  if (inFlightMediaAccessTargets.get(scope)?.has(key)) return;
  const targets = queuedMediaAccessTargets.get(scope) ?? new Map();
  const target = { audience, path };
  targets.set(key, target);
  queuedMediaAccessTargets.set(scope, targets);
  scheduleMediaAccessFlush(scope);
}

async function requestMediaAccessTickets(
  server: NonNullable<ReturnType<typeof getCurrentServer>>,
  targets: MediaAccessTarget[],
): Promise<boolean> {
  const response = await fetch(`${server.url}/api/auth/media-access`, {
    method: "POST",
    credentials: "omit",
    headers: {
      ...getApiAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ targets }),
  }).catch(() => null);
  if (!response?.ok) return false;
  const payload = (await response.json().catch(() => null)) as {
    tickets?: MediaAccessTickets;
  } | null;
  if (!Array.isArray(payload?.tickets)) return false;
  if (getCurrentServer()?.id !== server.id) return false;
  setMediaAccessTickets(payload.tickets, server.id);
  return true;
}

async function flushMediaAccessTargets(scope: string): Promise<boolean> {
  const existing = mediaAccessRefreshPromises.get(scope);
  if (existing) return existing;
  const server = getCurrentServer();
  if (!server?.token || server.id !== scope) return false;
  const queued = queuedMediaAccessTargets.get(scope);
  if (!queued?.size) return true;
  const targets = Array.from(queued.values()).slice(0, MEDIA_ACCESS_BATCH_SIZE);
  for (const target of targets) queued.delete(mediaAccessTargetKey(target));
  const inFlight = inFlightMediaAccessTargets.get(scope) ?? new Set<string>();
  for (const target of targets) inFlight.add(mediaAccessTargetKey(target));
  inFlightMediaAccessTargets.set(scope, inFlight);

  const promise = requestMediaAccessTickets(server, targets).finally(() => {
    for (const target of targets) inFlight.delete(mediaAccessTargetKey(target));
    if (inFlight.size === 0) inFlightMediaAccessTargets.delete(scope);
    mediaAccessRefreshPromises.delete(scope);
    if (queued.size > 0) scheduleMediaAccessFlush(scope);
  });
  mediaAccessRefreshPromises.set(scope, promise);
  return promise;
}

export async function refreshMediaAccessTickets(
  targets?: MediaAccessTarget[],
): Promise<boolean> {
  if (!usesConfigurableServer) return true;
  const server = getCurrentServer();
  if (!server?.token) {
    clearMediaAccessTickets();
    return false;
  }
  const requested = targets ?? getMediaAccessTargets(server.id);
  if (requested.length === 0) return true;
  for (const target of requested) {
    queueMediaAccessTarget(target.audience, target.path, server.id);
  }
  return flushMediaAccessTargets(server.id);
}

export interface MediaAccessUrlResolvers {
  resolveApiUrl(path: string): string;
  isApiUrl(url: string): boolean;
  withMediaAccessTicket(url: string, audience: MediaAccessAudience): string;
}

export async function ensureMediaAccessUrl(
  url: string,
  audience: MediaAccessAudience,
  options: { forceRefresh?: boolean },
  resolvers: MediaAccessUrlResolvers,
): Promise<string> {
  const baseUrl = /^https?:\/\//i.test(url)
    ? url
    : resolvers.resolveApiUrl(url);
  if (!resolvers.isApiUrl(baseUrl)) return baseUrl;
  if (!usesConfigurableServer) {
    return resolvers.withMediaAccessTicket(baseUrl, audience);
  }

  const server = getCurrentServer();
  if (!server?.token || !server.id) {
    return resolvers.withMediaAccessTicket(baseUrl, audience);
  }

  let parsed: URL;
  let serverOrigin: URL;
  try {
    parsed = new URL(baseUrl, server.url);
    serverOrigin = new URL(server.url);
  } catch {
    return baseUrl;
  }
  parsed.searchParams.delete("token");
  parsed.searchParams.delete("media_ticket");
  if (
    parsed.origin !== serverOrigin.origin ||
    !parsed.pathname.startsWith("/api/")
  ) {
    return parsed.toString();
  }
  if (options.forceRefresh) {
    invalidateMediaAccessTicket(audience, parsed.pathname, server.id);
  }
  const currentTicket = getMediaAccessTicket(
    audience,
    parsed.pathname,
    server.id,
  );
  if (currentTicket) {
    parsed.searchParams.set("media_ticket", currentTicket);
    return parsed.toString();
  }

  const key = `${server.id}:${audience}:${parsed.pathname}:${
    options.forceRefresh ? "refresh" : "ensure"
  }`;
  const path = parsed.pathname;
  let ticketPromise = ensuredMediaAccessPromises.get(key);
  if (!ticketPromise) {
    const pending = (async () => {
      const target = { audience, path };
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const refreshed = await refreshMediaAccessTickets([target]);
        const currentServer = getCurrentServer();
        const ticket =
          refreshed && currentServer?.id === server.id
            ? getMediaAccessTicket(audience, path, server.id)
            : null;
        if (ticket) return ticket;
        if (!refreshed) break;
      }
      throw new MediaAccessTicketError(audience, path);
    })();
    ticketPromise = pending.finally(() => {
      if (ensuredMediaAccessPromises.get(key) === ticketPromise) {
        ensuredMediaAccessPromises.delete(key);
      }
    });
    ensuredMediaAccessPromises.set(key, ticketPromise);
  }
  const ticket = await ticketPromise;
  parsed.searchParams.set("media_ticket", ticket);
  return parsed.toString();
}

export function startMediaAccessTicketRefresh(): () => void {
  if (!usesConfigurableServer || typeof window === "undefined") return () => {};
  const serverIdentity = () => {
    const server = getCurrentServer();
    return server ? `${server.id}\u0000${server.url}` : "";
  };
  let activeServerIdentity = serverIdentity();
  const recoverAfterResume = () => {
    const server = getCurrentServer();
    if (server?.id) invalidateMediaAccessAudience("artwork", server.id);
    signalMediaAccessResume();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    if (isCapacitorRuntime) return;
    recoverAfterResume();
  };
  const interval = window.setInterval(
    () => void refreshMediaAccessTickets(),
    45_000,
  );
  const handleServerChange = () => {
    const nextServerIdentity = serverIdentity();
    if (nextServerIdentity !== activeServerIdentity) {
      clearMediaAccessTickets();
      activeServerIdentity = nextServerIdentity;
    }
    void refreshMediaAccessTickets();
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("crate:app-resumed", recoverAfterResume);
  window.addEventListener("crate:network-restored", recoverAfterResume);
  window.addEventListener(SERVER_STORE_EVENT, handleServerChange);
  return () => {
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("crate:app-resumed", recoverAfterResume);
    window.removeEventListener("crate:network-restored", recoverAfterResume);
    window.removeEventListener(SERVER_STORE_EVENT, handleServerChange);
  };
}
