import { useCallback, useEffect, useMemo, useRef } from "react";

import { useCrateConnectWs } from "@/hooks/use-crate-connect-ws";
import { connectPlayerStateToRemotePlaybackState } from "@/lib/crate-connect-state";
import {
  type PlaybackStatePayload,
  type RemotePlaybackState,
} from "@/lib/remote-playback-state";
import type { PlaySource, RepeatMode, Track } from "./player-types";
import type { RemoteCommandType } from "@/hooks/crate-connect-ws-model";

interface Ref<T> {
  current: T;
}

type ConnectPublishOptions = { claimActive?: boolean };
type PublishConnectState = (options?: ConnectPublishOptions) => Promise<void>;
type BuildConnectSnapshotPayload = (
  snapshotKind: "light" | "structural",
  options?: ConnectPublishOptions,
) => PlaybackStatePayload;
type ConnectWsRuntime = ReturnType<typeof useCrateConnectWs>;

interface UsePlayerConnectV2SyncOptions {
  applyConnectStateToLocalQueue: (
    state: RemotePlaybackState,
    startPlaying: boolean,
  ) => boolean;
  authUserId: number | null | undefined;
  buildConnectSnapshotPayload: BuildConnectSnapshotPayload;
  connectV2Enabled: boolean;
  connectV2PublishRef: Ref<PublishConnectState | null>;
  currentIndex: number;
  currentTimeRef: Ref<number>;
  isPlaying: boolean;
  isPlayingRef: Ref<boolean>;
  playSource: PlaySource | null;
  publishConnectState: PublishConnectState;
  queue: Track[];
  queueRef: Ref<Track[]>;
  repeat: RepeatMode;
  requireUserGestureToResume: () => void;
  shuffle: boolean;
  volume: number;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
}

interface ConnectedInstanceLike {
  instance_id: string;
}

export function hasRemoteConnectOwner(
  enabled: boolean,
  activeInstanceId: string | null,
  playbackInstanceId: string | null,
  connectedInstances: readonly ConnectedInstanceLike[],
): boolean {
  return (
    enabled &&
    Boolean(activeInstanceId) &&
    connectedInstances.some(
      (instance) => instance.instance_id === activeInstanceId,
    ) &&
    Boolean(playbackInstanceId) &&
    activeInstanceId !== playbackInstanceId
  );
}

export interface PlayerConnectV2SyncRuntime {
  activeInstanceId: ConnectWsRuntime["activeInstanceId"];
  connectedInstances: ConnectWsRuntime["connectedInstances"];
  clearTransferPlaybackGuard: () => void;
  isRemoteActive: boolean;
  playbackInstanceId: ConnectWsRuntime["playbackInstanceId"] | null;
  remoteState: RemotePlaybackState | null;
  requestTransfer: ConnectWsRuntime["requestTransfer"];
  sendRemoteCommand: (
    type: RemoteCommandType,
    payload?: Record<string, unknown>,
  ) => boolean;
  serverClockOffsetMs: ConnectWsRuntime["serverClockOffsetMs"];
}

export function usePlayerConnectV2Sync({
  applyConnectStateToLocalQueue,
  authUserId,
  buildConnectSnapshotPayload,
  connectV2Enabled,
  connectV2PublishRef,
  currentIndex,
  currentTimeRef,
  isPlaying,
  isPlayingRef,
  playSource,
  publishConnectState,
  queue,
  queueRef,
  repeat,
  requireUserGestureToResume,
  shuffle,
  volume,
  pause,
  resume,
  next,
  prev,
  seek,
  setVolume,
}: UsePlayerConnectV2SyncOptions): PlayerConnectV2SyncRuntime {
  const clearTransferPlaybackGuardRef = useRef<number | null>(null);
  const clearTransferPlaybackGuard = useCallback(() => {
    if (clearTransferPlaybackGuardRef.current === null) return;
    window.clearTimeout(clearTransferPlaybackGuardRef.current);
    clearTransferPlaybackGuardRef.current = null;
  }, []);
  const scheduleTransferPlaybackGuard = useCallback(() => {
    clearTransferPlaybackGuard();
    const startedAtSeconds = currentTimeRef.current;
    clearTransferPlaybackGuardRef.current = window.setTimeout(() => {
      clearTransferPlaybackGuardRef.current = null;
      const advancedEnough = currentTimeRef.current > startedAtSeconds + 0.25;
      if (isPlayingRef.current && advancedEnough) return;
      requireUserGestureToResume();
    }, 2500);
  }, [
    clearTransferPlaybackGuard,
    currentTimeRef,
    isPlayingRef,
    requireUserGestureToResume,
  ]);

  const handleConnectV2TransferIncoming = useCallback(
    (payload: { state?: unknown }) => {
      const remoteState = connectPlayerStateToRemotePlaybackState(
        payload.state as Parameters<
          typeof connectPlayerStateToRemotePlaybackState
        >[0],
      );
      if (!remoteState) return false;
      return applyConnectStateToLocalQueue(remoteState, false);
    },
    [applyConnectStateToLocalQueue],
  );

  const handleConnectV2RemoteCommand = useCallback(
    (
      type: RemoteCommandType,
      payload: { payload?: Record<string, unknown> | null },
    ) => {
      if (type === "pause") {
        pause();
        return;
      }
      if (type === "resume") {
        resume();
        return;
      }
      if (type === "next_track") {
        next();
        return;
      }
      if (type === "previous_track") {
        prev();
        return;
      }
      if (type === "volume") {
        const rawVolume = payload.payload?.volume;
        if (typeof rawVolume === "number" && Number.isFinite(rawVolume)) {
          setVolume(Math.max(0, Math.min(1, rawVolume)));
        }
        return;
      }
      const rawPosition =
        payload.payload?.position_ms ?? payload.payload?.positionMs;
      if (typeof rawPosition === "number" && Number.isFinite(rawPosition)) {
        seek(Math.max(0, rawPosition / 1000));
        void publishConnectState();
      }
    },
    [next, pause, prev, publishConnectState, resume, seek, setVolume],
  );

  const {
    activeInstanceId,
    connectedInstances,
    playbackInstanceId,
    playerState,
    requestTransfer,
    serverClockOffsetMs,
    sendMessage,
    sendSnapshot,
    sendVolume,
  } = useCrateConnectWs({
    authUserId,
    callbacks: {
      onBecameInactive: pause,
      onRemoteCommand: handleConnectV2RemoteCommand,
      onTransferCommitted: () => {
        resume();
        void publishConnectState({ claimActive: true });
        scheduleTransferPlaybackGuard();
      },
      onTransferIncoming: handleConnectV2TransferIncoming,
    },
    enabled: connectV2Enabled,
  });
  const isActive = activeInstanceId === playbackInstanceId;
  const isRemoteActive = hasRemoteConnectOwner(
    connectV2Enabled,
    activeInstanceId,
    playbackInstanceId,
    connectedInstances,
  );
  const remoteState = useMemo(
    () => connectPlayerStateToRemotePlaybackState(playerState),
    [playerState],
  );
  const sendRemoteCommand = useCallback(
    (type: RemoteCommandType, payload?: Record<string, unknown>) =>
      sendMessage({ payload: payload ?? {}, type, version: null }),
    [sendMessage],
  );
  const publishConnectV2State = useCallback(
    async (options?: ConnectPublishOptions) => {
      if (!authUserId || !connectV2Enabled || !queueRef.current.length) return;
      const payload = buildConnectSnapshotPayload(
        options?.claimActive ? "structural" : "light",
        options,
      );
      if (options?.claimActive) {
        sendMessage({
          payload: { position_ms: payload.position_ms },
          type: "claim_active",
          version: null,
        });
        sendMessage({
          payload: payload as unknown as Record<string, unknown>,
          type: "update_snapshot",
          version: null,
        });
        return;
      }
      if (!isActive) return;
      sendSnapshot(payload);
    },
    [
      authUserId,
      buildConnectSnapshotPayload,
      connectV2Enabled,
      isActive,
      queueRef,
      sendMessage,
      sendSnapshot,
    ],
  );
  useEffect(() => {
    connectV2PublishRef.current = connectV2Enabled
      ? publishConnectV2State
      : null;
  }, [connectV2Enabled, connectV2PublishRef, publishConnectV2State]);

  const structuralRevisionRef = useRef<string | null>(null);
  const claimedPlaybackRef = useRef<string | null>(null);
  useEffect(() => {
    if (!authUserId || !connectV2Enabled || !isPlaying || !queue.length) return;
    if (activeInstanceId && activeInstanceId !== playbackInstanceId) return;
    const payload = buildConnectSnapshotPayload("structural", {
      claimActive: true,
    });
    const claimKey = [
      payload.queue_revision,
      payload.current_index,
      payload.track_id ?? payload.track_entity_uid ?? payload.track_path ?? "",
      payload.status,
    ].join(":");
    if (claimKey === claimedPlaybackRef.current) return;
    claimedPlaybackRef.current = claimKey;
    sendMessage({
      payload: { position_ms: payload.position_ms },
      type: "claim_active",
      version: null,
    });
    sendMessage({
      payload: payload as unknown as Record<string, unknown>,
      type: "update_snapshot",
      version: null,
    });
  }, [
    activeInstanceId,
    authUserId,
    buildConnectSnapshotPayload,
    connectV2Enabled,
    playbackInstanceId,
    currentIndex,
    isPlaying,
    queue,
    sendMessage,
  ]);

  useEffect(() => {
    if (!connectV2Enabled || !isActive || !queue.length) return;
    const payload = buildConnectSnapshotPayload("structural");
    if (payload.queue_revision === structuralRevisionRef.current) return;
    structuralRevisionRef.current = payload.queue_revision;
    sendSnapshot(payload);
  }, [
    buildConnectSnapshotPayload,
    connectV2Enabled,
    currentIndex,
    isActive,
    playSource,
    queue,
    repeat,
    sendSnapshot,
    shuffle,
  ]);

  useEffect(() => {
    if (!connectV2Enabled || !isActive || !queueRef.current.length) return;
    sendSnapshot(buildConnectSnapshotPayload("light"));
  }, [
    buildConnectSnapshotPayload,
    connectV2Enabled,
    isActive,
    isPlaying,
    queueRef,
    sendSnapshot,
  ]);

  useEffect(() => {
    if (!connectV2Enabled || !isActive) return;
    sendVolume(volume);
  }, [connectV2Enabled, isActive, sendVolume, volume]);

  useEffect(() => {
    if (!connectV2Enabled || !isActive) return;
    const intervalId = window.setInterval(() => {
      if (!queueRef.current.length) return;
      sendSnapshot(buildConnectSnapshotPayload("light"));
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [
    buildConnectSnapshotPayload,
    connectV2Enabled,
    isActive,
    queueRef,
    sendSnapshot,
  ]);

  return {
    activeInstanceId: connectV2Enabled ? activeInstanceId : null,
    connectedInstances: connectV2Enabled ? connectedInstances : [],
    clearTransferPlaybackGuard,
    isRemoteActive,
    playbackInstanceId: connectV2Enabled ? playbackInstanceId : null,
    remoteState: connectV2Enabled ? remoteState : null,
    requestTransfer,
    sendRemoteCommand,
    serverClockOffsetMs: connectV2Enabled ? serverClockOffsetMs : 0,
  };
}
