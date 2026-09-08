import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONNECT_SESSION_EVENT,
  fetchActiveConnectSnapshot,
  fetchConnectDevices,
} from "@/lib/crate-connect";
import type { ActiveConnectSession } from "@/lib/crate-connect";
import { formatCrateDeviceName } from "@/lib/listen-device";
import type { RemotePlaybackState } from "@/lib/remote-playback-state";

type UsePlayerBarConnectSessionOptions = {
  legacyConnectEnabled: boolean;
};

export function usePlayerBarConnectSession({
  legacyConnectEnabled,
}: UsePlayerBarConnectSessionOptions) {
  const [activeConnectSession, setActiveConnectSession] =
    useState<ActiveConnectSession | null>(null);
  const [activeConnectState, setActiveConnectState] =
    useState<RemotePlaybackState | null>(null);
  const [activeConnectStateFetchedAt, setActiveConnectStateFetchedAt] =
    useState<number | null>(null);
  const [activeConnectDeviceLabel, setActiveConnectDeviceLabel] = useState<
    string | null
  >(null);

  const refreshConnectSession = useCallback(() => {
    let cancelled = false;
    if (!legacyConnectEnabled) {
      setActiveConnectSession(null);
      setActiveConnectState(null);
      setActiveConnectStateFetchedAt(null);
      setActiveConnectDeviceLabel(null);
      return () => {
        cancelled = true;
      };
    }
    void Promise.all([
      fetchActiveConnectSnapshot().catch(() => ({
        session: null,
        state: null,
      })),
      fetchConnectDevices().catch(() => ({ devices: [] })),
    ]).then(([snapshot, devices]) => {
      if (cancelled) return;
      const session = snapshot.session;
      setActiveConnectSession(session);
      setActiveConnectState(snapshot.state ?? null);
      setActiveConnectStateFetchedAt(snapshot.state ? Date.now() : null);
      const activeDeviceId = session?.active_device_id;
      const activeDevice = devices.devices.find(
        (device) => device.device_id === activeDeviceId,
      );
      setActiveConnectDeviceLabel(
        activeDevice
          ? formatCrateDeviceName(activeDevice)
          : activeDeviceId
            ? "Crate device"
            : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [legacyConnectEnabled]);
  const refreshConnectSessionCleanupRef = useRef<(() => void) | null>(null);
  const runRefreshConnectSession = useCallback(() => {
    refreshConnectSessionCleanupRef.current?.();
    refreshConnectSessionCleanupRef.current = refreshConnectSession();
  }, [refreshConnectSession]);

  useEffect(() => {
    runRefreshConnectSession();
    return () => {
      refreshConnectSessionCleanupRef.current?.();
      refreshConnectSessionCleanupRef.current = null;
    };
  }, [runRefreshConnectSession]);

  useEffect(() => {
    window.addEventListener(CONNECT_SESSION_EVENT, runRefreshConnectSession);
    window.addEventListener("focus", runRefreshConnectSession);
    return () => {
      window.removeEventListener(
        CONNECT_SESSION_EVENT,
        runRefreshConnectSession,
      );
      window.removeEventListener("focus", runRefreshConnectSession);
    };
  }, [runRefreshConnectSession]);

  const updateActiveConnectStatus = useCallback(
    (status: "paused" | "playing") => {
      setActiveConnectSession((previous) =>
        previous ? { ...previous, status } : previous,
      );
    },
    [],
  );

  return {
    activeConnectDeviceId: activeConnectSession?.active_device_id ?? null,
    activeConnectSession,
    activeConnectState,
    activeConnectStateFetchedAt,
    activeConnectDeviceLabel,
    runRefreshConnectSession,
    updateActiveConnectStatus,
  };
}
