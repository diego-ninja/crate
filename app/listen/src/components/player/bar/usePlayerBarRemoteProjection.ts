import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { PlayerConnectValue } from "@/contexts/player-context";
import type { ActiveConnectSession } from "@/lib/crate-connect";
import { formatCrateDeviceName } from "@/lib/listen-device";
import type { RemotePlaybackState } from "@/lib/remote-playback-state";

type RemoteProjectionOptions = {
  isPlaying: boolean;
  displayedTime: number;
  displayedDuration: number;
  volume: number;
  connect: PlayerConnectValue;
  currentConnectDeviceId: string;
  legacyConnectEnabled: boolean;
  activeConnectDeviceId: string | null;
  activeConnectSession: ActiveConnectSession | null;
  activeConnectState: RemotePlaybackState | null;
  activeConnectStateFetchedAt: number | null;
  activeConnectDeviceLabel: string | null;
  runRefreshConnectSession: () => void;
};

type OptimisticRemoteStateOptions = {
  isRemoteConnectActive: boolean;
  remoteConnectState: RemotePlaybackState | null;
  activeConnectSession: ActiveConnectSession | null;
  runRefreshConnectSession: () => void;
};

type OptimisticRemoteState = {
  optimisticRemoteTimeRef: MutableRefObject<number | null>;
  optimisticRemoteVolumeRef: MutableRefObject<number | null>;
  optimisticRevision: number;
  setOptimisticRemoteTime: (value: number | null) => void;
  setOptimisticRemoteVolume: (value: number | null) => void;
};

type DerivedRemoteState = {
  isRemoteConnectActive: boolean;
  remoteConnectState: RemotePlaybackState | null;
  v2RemoteConnectActive: boolean;
};

function deriveRemoteState({
  connect,
  legacyConnectEnabled,
  currentConnectDeviceId,
  activeConnectDeviceId,
}: Pick<
  RemoteProjectionOptions,
  | "connect"
  | "legacyConnectEnabled"
  | "currentConnectDeviceId"
  | "activeConnectDeviceId"
>): DerivedRemoteState {
  const legacyRemoteConnectActive = Boolean(
    legacyConnectEnabled &&
      activeConnectDeviceId &&
      activeConnectDeviceId !== currentConnectDeviceId,
  );
  const v2RemoteConnectActive = Boolean(
    connect.transport === "ws" && connect.isRemoteActive && connect.remoteState,
  );
  return {
    isRemoteConnectActive: legacyRemoteConnectActive || v2RemoteConnectActive,
    remoteConnectState: v2RemoteConnectActive ? connect.remoteState : null,
    v2RemoteConnectActive,
  };
}

function resolveRemoteConnectState(
  derived: DerivedRemoteState,
  activeConnectState: RemotePlaybackState | null,
): DerivedRemoteState {
  return {
    ...derived,
    remoteConnectState: derived.v2RemoteConnectActive
      ? derived.remoteConnectState
      : activeConnectState,
  };
}

function resolveRemoteDeviceLabel({
  connect,
  isRemoteConnectActive,
  v2RemoteConnectActive,
  activeConnectState,
  activeConnectDeviceLabel,
}: Pick<RemoteProjectionOptions, "connect" | "activeConnectDeviceLabel"> &
  Pick<
    DerivedRemoteState,
    "isRemoteConnectActive" | "v2RemoteConnectActive"
  > & {
    activeConnectState: RemotePlaybackState | null;
  }): string | null {
  if (!isRemoteConnectActive) return null;
  if (!v2RemoteConnectActive) return activeConnectDeviceLabel;
  const activeConnectInstance =
    connect.transport === "ws"
      ? connect.connectedInstances.find(
          (instance) => instance.instance_id === connect.activeInstanceId,
        )
      : null;
  return formatCrateDeviceName({
    app_platform:
      activeConnectInstance?.app_platform ?? activeConnectState?.app_platform,
    device_label:
      activeConnectInstance?.device_label ?? activeConnectState?.device_label,
    device_type:
      activeConnectInstance?.device_type ?? activeConnectState?.device_type,
  });
}

function projectRemoteDisplayedTime({
  isRemoteConnectActive,
  remoteConnectState,
  optimisticRemoteTime,
  v2RemoteConnectActive,
  serverClockOffsetMs,
  activeConnectStateFetchedAt,
}: {
  isRemoteConnectActive: boolean;
  remoteConnectState: RemotePlaybackState | null;
  optimisticRemoteTime: number | null;
  v2RemoteConnectActive: boolean;
  serverClockOffsetMs: number;
  activeConnectStateFetchedAt: number | null;
}): number {
  if (!isRemoteConnectActive || !remoteConnectState) return 0;
  if (optimisticRemoteTime !== null) return optimisticRemoteTime;
  const baseMs = Math.max(0, remoteConnectState.position_ms || 0);
  if (remoteConnectState.status !== "playing") return baseMs / 1000;
  if (v2RemoteConnectActive && remoteConnectState.position_updated_at) {
    const serverAnchor = Date.parse(remoteConnectState.position_updated_at);
    if (Number.isFinite(serverAnchor)) {
      const projected =
        baseMs + Math.max(0, Date.now() + serverClockOffsetMs - serverAnchor);
      const durationMs = remoteConnectState.duration_ms || 0;
      return (
        (durationMs > 0 ? Math.min(projected, durationMs) : projected) / 1000
      );
    }
  }
  if (activeConnectStateFetchedAt === null) return baseMs / 1000;
  const elapsedMs = Math.max(0, Date.now() - activeConnectStateFetchedAt);
  const projected = baseMs + elapsedMs;
  const durationMs = remoteConnectState.duration_ms || 0;
  return (durationMs > 0 ? Math.min(projected, durationMs) : projected) / 1000;
}

function useOptimisticRemoteState({
  isRemoteConnectActive,
  remoteConnectState,
  activeConnectSession,
  runRefreshConnectSession,
}: OptimisticRemoteStateOptions): OptimisticRemoteState {
  const optimisticRemoteTimeRef = useRef<number | null>(null);
  const optimisticRemoteVolumeRef = useRef<number | null>(null);
  const [optimisticRevision, setOptimisticRevision] = useState(0);
  const setOptimisticRemoteTime = useCallback((value: number | null) => {
    optimisticRemoteTimeRef.current = value;
    setOptimisticRevision((revision) => revision + 1);
  }, []);
  const setOptimisticRemoteVolume = useCallback((value: number | null) => {
    optimisticRemoteVolumeRef.current = value;
    setOptimisticRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    if (!isRemoteConnectActive) {
      optimisticRemoteTimeRef.current = null;
      optimisticRemoteVolumeRef.current = null;
    }
  }, [isRemoteConnectActive]);

  useEffect(() => {
    if (!isRemoteConnectActive || remoteConnectState?.status !== "playing")
      return;
    const intervalId = window.setInterval(() => {
      setOptimisticRevision((revision) => revision + 1);
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [isRemoteConnectActive, remoteConnectState?.status]);

  useEffect(() => {
    if (!isRemoteConnectActive) return;
    const intervalId = window.setInterval(runRefreshConnectSession, 2500);
    return () => window.clearInterval(intervalId);
  }, [isRemoteConnectActive, runRefreshConnectSession]);

  useEffect(() => {
    optimisticRemoteTimeRef.current = null;
    optimisticRemoteVolumeRef.current = null;
  }, [
    activeConnectSession?.playback_session_id,
    activeConnectSession?.state_revision,
  ]);

  return {
    optimisticRemoteTimeRef,
    optimisticRemoteVolumeRef,
    optimisticRevision,
    setOptimisticRemoteTime,
    setOptimisticRemoteVolume,
  };
}

export function usePlayerBarRemoteProjection({
  isPlaying,
  displayedTime,
  displayedDuration,
  volume,
  connect,
  currentConnectDeviceId,
  legacyConnectEnabled,
  activeConnectDeviceId,
  activeConnectSession,
  activeConnectState,
  activeConnectStateFetchedAt,
  activeConnectDeviceLabel,
  runRefreshConnectSession,
}: RemoteProjectionOptions) {
  const derivedRemoteState = resolveRemoteConnectState(
    deriveRemoteState({
      connect,
      legacyConnectEnabled,
      currentConnectDeviceId,
      activeConnectDeviceId,
    }),
    activeConnectState,
  );
  const { isRemoteConnectActive, remoteConnectState, v2RemoteConnectActive } =
    derivedRemoteState;
  const optimistic = useOptimisticRemoteState({
    isRemoteConnectActive,
    remoteConnectState,
    activeConnectSession,
    runRefreshConnectSession,
  });
  const remoteConnectDeviceLabel = resolveRemoteDeviceLabel({
    connect,
    isRemoteConnectActive,
    v2RemoteConnectActive,
    activeConnectState: remoteConnectState,
    activeConnectDeviceLabel,
  });
  const effectiveIsPlaying = isRemoteConnectActive
    ? remoteConnectState?.status === "playing"
    : isPlaying;
  const remoteDuration =
    typeof remoteConnectState?.duration_ms === "number"
      ? remoteConnectState.duration_ms / 1000
      : 0;
  const optimisticRemoteTime = optimistic.optimisticRemoteTimeRef.current;
  const remoteDisplayedTime = useMemo(
    () =>
      projectRemoteDisplayedTime({
        isRemoteConnectActive,
        remoteConnectState,
        optimisticRemoteTime,
        v2RemoteConnectActive,
        serverClockOffsetMs: connect.serverClockOffsetMs,
        activeConnectStateFetchedAt,
      }),
    [
      activeConnectStateFetchedAt,
      connect.serverClockOffsetMs,
      isRemoteConnectActive,
      optimisticRemoteTime,
      optimistic.optimisticRevision,
      remoteConnectState,
      v2RemoteConnectActive,
    ],
  );

  return {
    ...derivedRemoteState,
    legacyConnectEnabled,
    activeConnectDeviceId,
    activeConnectSession,
    runRefreshConnectSession,
    remoteConnectDeviceLabel,
    effectiveIsPlaying,
    effectiveDisplayedTime: isRemoteConnectActive
      ? remoteDisplayedTime
      : displayedTime,
    effectiveDisplayedDuration:
      isRemoteConnectActive && remoteDuration > 0
        ? remoteDuration
        : displayedDuration,
    effectiveVolume:
      isRemoteConnectActive &&
      optimistic.optimisticRemoteVolumeRef.current !== null
        ? optimistic.optimisticRemoteVolumeRef.current
        : volume,
    ...optimistic,
  };
}
