import type { MediaAccessAudience } from "@/lib/media-access";
import type { ServerConfig } from "@/lib/server-store";

export interface ApiUrlResolverDependencies {
  apiUrl: (path: string) => string;
  getApiBase: () => string;
  getCurrentServer: () => ServerConfig | null;
  getMediaAccessTicket: (
    audience: MediaAccessAudience,
    path: string,
    scope: string,
  ) => string | null;
  queueMediaAccessTarget: (
    audience: MediaAccessAudience,
    path: string,
    scope: string,
  ) => void;
  usesConfigurableServer: boolean;
}

export interface ApiUrlResolver {
  apiAssetUrl: (path: string) => string;
  apiSseUrl: (path: string) => string;
  apiStreamUrl: (path: string) => string;
  apiWsUrl: (path: string) => string;
  isApiUrl: (url: string) => boolean;
  isUsableMediaAssetUrl: (url: string | null | undefined) => boolean;
  requiresMediaAccessTicket: (url: string | null | undefined) => boolean;
  resolveMaybeApiAssetUrl: (url: string | null | undefined) => string | null;
  resolveMaybeApiStreamUrl: (url: string | null | undefined) => string | null;
  withMediaAccessTicket: (url: string, audience: MediaAccessAudience) => string;
}

export function createApiUrlResolver(
  dependencies: ApiUrlResolverDependencies,
): ApiUrlResolver {
  const isAbsoluteHttpUrl = (url: string): boolean => /^https?:\/\//i.test(url);

  const isApiUrl = (url: string): boolean => {
    try {
      const parsed = new URL(
        url,
        typeof window !== "undefined"
          ? window.location.origin
          : "https://crate.local",
      );
      return parsed.pathname.startsWith("/api/");
    } catch {
      return url.startsWith("/api/") || url.startsWith("api/");
    }
  };

  const isPublicCacheableApiAsset = (url: string): boolean => {
    try {
      const parsed = new URL(
        url,
        typeof window !== "undefined"
          ? window.location.origin
          : "https://crate.local",
      );
      return parsed.pathname === "/api/network/external-artist/photo";
    } catch {
      return false;
    }
  };

  const withoutMediaCredentials = (url: string): string => {
    const absolute = isAbsoluteHttpUrl(url);
    const base =
      typeof window !== "undefined"
        ? window.location.origin
        : "https://crate.local";
    try {
      const parsed = new URL(url, base);
      parsed.searchParams.delete("token");
      parsed.searchParams.delete("media_ticket");
      if (absolute) return parsed.toString();
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return url;
    }
  };

  const withMediaAccessTicket = (
    url: string,
    audience: MediaAccessAudience,
  ): string => {
    const absolute = /^(?:https?|wss?):\/\//i.test(url);
    const base =
      typeof window !== "undefined"
        ? window.location.origin
        : "https://crate.local";
    try {
      const parsed = new URL(url, base);
      parsed.searchParams.delete("token");
      parsed.searchParams.delete("media_ticket");
      const server = dependencies.usesConfigurableServer
        ? dependencies.getCurrentServer()
        : null;
      const serverOrigin = server?.url ? new URL(server.url) : null;
      const targetsCurrentServer =
        !absolute ||
        !serverOrigin ||
        (parsed.host === serverOrigin.host &&
          (parsed.protocol === "https:" || parsed.protocol === "wss:") ===
            (serverOrigin.protocol === "https:"));
      const ticket =
        targetsCurrentServer && server?.token && server.id
          ? dependencies.getMediaAccessTicket(
              audience,
              parsed.pathname,
              server.id,
            )
          : null;
      if (!ticket && targetsCurrentServer && server?.token && server.id) {
        dependencies.queueMediaAccessTarget(
          audience,
          parsed.pathname,
          server.id,
        );
      }
      if (ticket) parsed.searchParams.set("media_ticket", ticket);
      if (absolute) return parsed.toString();
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return url.replace(/([?&])token=[^&]*&?/g, "$1").replace(/[?&]$/, "");
    }
  };

  const apiSseUrl = (path: string): string =>
    withMediaAccessTicket(dependencies.apiUrl(path), "sse");

  const apiAssetUrl = (path: string): string => {
    const baseUrl = isAbsoluteHttpUrl(path) ? path : dependencies.apiUrl(path);
    if (!isApiUrl(baseUrl)) return baseUrl;
    if (isPublicCacheableApiAsset(baseUrl)) {
      return withoutMediaCredentials(baseUrl);
    }
    return withMediaAccessTicket(baseUrl, "artwork");
  };

  const apiStreamUrl = (path: string): string => {
    const baseUrl = isAbsoluteHttpUrl(path) ? path : dependencies.apiUrl(path);
    if (!isApiUrl(baseUrl)) return baseUrl;
    return withMediaAccessTicket(baseUrl, "stream");
  };

  const resolveMaybeApiAssetUrl = (
    url: string | null | undefined,
  ): string | null => {
    if (!url) return null;
    if (
      url.startsWith("data:") ||
      url.startsWith("blob:") ||
      url.startsWith("file:") ||
      url.startsWith("capacitor:")
    ) {
      return url;
    }
    if (url.startsWith("/api/")) return apiAssetUrl(url);
    if (url.startsWith("api/")) return apiAssetUrl(`/${url}`);

    const base = dependencies.getApiBase();
    if (base && url.startsWith(`${base}/api/`)) {
      return apiAssetUrl(url.slice(base.length));
    }

    if (
      typeof window !== "undefined" &&
      url.startsWith(`${window.location.origin}/api/`)
    ) {
      return apiAssetUrl(url.slice(window.location.origin.length));
    }

    if (isAbsoluteHttpUrl(url)) {
      try {
        const parsed = new URL(url);
        if (parsed.pathname.startsWith("/api/")) return apiAssetUrl(url);
      } catch {
        // Leave malformed external URLs untouched.
      }
    }

    return url;
  };

  const requiresMediaAccessTicket = (
    url: string | null | undefined,
  ): boolean => {
    if (!url || !dependencies.usesConfigurableServer || !isApiUrl(url)) {
      return false;
    }
    if (isPublicCacheableApiAsset(url)) return false;
    try {
      const server = dependencies.getCurrentServer();
      const parsed = new URL(url, server?.url || "https://crate.local");
      if (server?.url && parsed.origin !== new URL(server.url).origin) {
        return false;
      }
      return parsed.pathname.startsWith("/api/");
    } catch {
      return url.startsWith("/api/") || url.startsWith("api/");
    }
  };

  const isUsableMediaAssetUrl = (url: string | null | undefined): boolean => {
    if (!url) return false;
    if (
      url.startsWith("data:") ||
      url.startsWith("blob:") ||
      url.startsWith("file:") ||
      url.startsWith("capacitor:")
    ) {
      return true;
    }
    if (!requiresMediaAccessTicket(url)) return true;

    try {
      const parsed = new URL(
        url,
        dependencies.getCurrentServer()?.url || "https://crate.local",
      );
      return (
        parsed.searchParams.has("media_ticket") ||
        parsed.searchParams.has("token")
      );
    } catch {
      return false;
    }
  };

  const resolveMaybeApiStreamUrl = (
    url: string | null | undefined,
  ): string | null => {
    if (!url) return null;
    if (
      url.startsWith("blob:") ||
      url.startsWith("file:") ||
      url.startsWith("capacitor:") ||
      url.startsWith("content:")
    ) {
      return url;
    }
    if (url.startsWith("/api/")) return apiStreamUrl(url);
    if (url.startsWith("api/")) return apiStreamUrl(`/${url}`);
    if (isAbsoluteHttpUrl(url) && isApiUrl(url)) return apiStreamUrl(url);
    return url;
  };

  const apiWsUrl = (path: string): string => {
    const base = dependencies.getApiBase();
    const baseOrigin = base
      ? base.replace(/^http/i, "ws")
      : window.location.origin.replace(/^http/i, "ws");
    return withMediaAccessTicket(`${baseOrigin}${path}`, "ws");
  };

  return {
    apiAssetUrl,
    apiSseUrl,
    apiStreamUrl,
    apiWsUrl,
    isApiUrl,
    isUsableMediaAssetUrl,
    requiresMediaAccessTicket,
    resolveMaybeApiAssetUrl,
    resolveMaybeApiStreamUrl,
    withMediaAccessTicket,
  };
}
