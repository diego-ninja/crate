import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useApi } from "@/hooks/use-api";
import { useMediaAccessVersion } from "@/hooks/use-media-access-version";
import { AUTH_TOKEN_EVENT, api, apiSseUrl } from "@/lib/api";
import { onCacheInvalidation } from "@/lib/cache";
import {
  getSseChannelState,
  markSseChannelClosed,
  markSseChannelError,
  markSseChannelEvent,
  markSseChannelOpen,
  onSseChannelState,
} from "@/lib/sse";
import type { HomeDiscoveryPayload } from "@/components/home/home-model";

const HOME_DISCOVERY_SSE_CHANNEL = "home-discovery";
const HOME_DISCOVERY_DEGRADE_AFTER_MS = 75_000;
const HOME_DISCOVERY_DEGRADED_REFRESH_MS = 60_000;

function snapshotVersion(
  payload: HomeDiscoveryPayload | null | undefined,
): number {
  return Number(payload?.snapshot?.version || 0);
}

export function useHomeDiscoveryStream() {
  const mediaAccessVersion = useMediaAccessVersion();
  const {
    data: discovery,
    error: discoveryError,
    loading: discoveryLoading,
    refetch: refetchDiscovery,
  } = useApi<HomeDiscoveryPayload>("/api/me/home/discovery", "GET", undefined, {
    reactive: false,
    revalidateIfCached: "idle",
    idleRevalidateMs: 12_000,
  });
  const [liveDiscovery, setLiveDiscovery] =
    useState<HomeDiscoveryPayload | null>(null);
  const [authTokenRevision, setAuthTokenRevision] = useState(0);
  const refreshingLiveDiscoveryRef = useRef(false);
  const lastDegradedRefreshAtRef = useRef(0);

  const applyDiscoveryPayload = useCallback(
    (next: HomeDiscoveryPayload | null) => {
      if (!next) return;
      startTransition(() => {
        setLiveDiscovery((current) =>
          snapshotVersion(next) >= snapshotVersion(current) ? next : current,
        );
      });
    },
    [],
  );

  useEffect(() => {
    if (discovery) applyDiscoveryPayload(discovery);
  }, [applyDiscoveryPayload, discovery]);

  const refreshLiveDiscovery = useCallback(
    async (fresh = false) => {
      if (refreshingLiveDiscoveryRef.current) return;
      if (
        typeof navigator !== "undefined" &&
        "onLine" in navigator &&
        !navigator.onLine
      )
        return;
      refreshingLiveDiscoveryRef.current = true;
      try {
        const payload = await api<HomeDiscoveryPayload>(
          fresh ? "/api/me/home/discovery?fresh=1" : "/api/me/home/discovery",
        );
        applyDiscoveryPayload(payload);
      } catch {
        // Keep the last good snapshot; the stream may still recover on its own.
      } finally {
        refreshingLiveDiscoveryRef.current = false;
      }
    },
    [applyDiscoveryPayload],
  );

  useEffect(() => {
    const onAuthTokenUpdated = () => {
      setAuthTokenRevision((value) => value + 1);
    };
    window.addEventListener(AUTH_TOKEN_EVENT, onAuthTokenUpdated);
    return () =>
      window.removeEventListener(AUTH_TOKEN_EVENT, onAuthTokenUpdated);
  }, []);

  useEffect(() => {
    const source = new EventSource(
      apiSseUrl("/api/me/home/discovery-stream?initial=0"),
    );
    source.onopen = () => {
      const { reconnected } = markSseChannelOpen(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
      if (reconnected) void refreshLiveDiscovery();
    };
    source.onmessage = (event) => {
      markSseChannelEvent(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
      try {
        applyDiscoveryPayload(JSON.parse(event.data) as HomeDiscoveryPayload);
      } catch {
        // Ignore malformed snapshots and keep the last good payload.
      }
    };
    source.addEventListener("heartbeat", () => {
      markSseChannelEvent(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
    });
    source.onerror = () => {
      markSseChannelError(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
    };
    return () => {
      markSseChannelClosed(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
      source.close();
    };
  }, [
    applyDiscoveryPayload,
    authTokenRevision,
    mediaAccessVersion,
    refreshLiveDiscovery,
  ]);

  useEffect(() => {
    return onSseChannelState(HOME_DISCOVERY_SSE_CHANNEL, (state) => {
      if (!state.degraded) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;
      if (
        typeof navigator !== "undefined" &&
        "onLine" in navigator &&
        !navigator.onLine
      )
        return;
      const now = Date.now();
      if (
        now - lastDegradedRefreshAtRef.current <
        HOME_DISCOVERY_DEGRADED_REFRESH_MS
      )
        return;
      lastDegradedRefreshAtRef.current = now;
      void refreshLiveDiscovery();
    });
  }, [refreshLiveDiscovery]);

  useEffect(() => {
    const maybeRecoverFromDegradedStream = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;
      if (
        typeof navigator !== "undefined" &&
        "onLine" in navigator &&
        !navigator.onLine
      )
        return;
      const state = getSseChannelState(HOME_DISCOVERY_SSE_CHANNEL);
      if (!state?.degraded) return;
      void refreshLiveDiscovery();
    };
    window.addEventListener("online", maybeRecoverFromDegradedStream);
    document.addEventListener(
      "visibilitychange",
      maybeRecoverFromDegradedStream,
    );
    return () => {
      window.removeEventListener("online", maybeRecoverFromDegradedStream);
      document.removeEventListener(
        "visibilitychange",
        maybeRecoverFromDegradedStream,
      );
    };
  }, [refreshLiveDiscovery]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const scheduleFreshRefresh = () => {
      if (refreshTimer != null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshLiveDiscovery(true);
      }, 250);
    };
    const unsubscribe = onCacheInvalidation((scope) => {
      if (
        scope === "home" ||
        scope === "library" ||
        scope === "global_catalog" ||
        scope === "upcoming" ||
        scope.startsWith("home:user:") ||
        scope.startsWith("artist:") ||
        scope.startsWith("album:") ||
        scope.startsWith("playlist:")
      ) {
        scheduleFreshRefresh();
      }
    });
    return () => {
      unsubscribe();
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
    };
  }, [refreshLiveDiscovery]);

  return {
    currentDiscovery: liveDiscovery ?? discovery,
    discoveryError,
    discoveryLoading,
    refreshLiveDiscovery,
    refetchDiscovery,
  };
}
