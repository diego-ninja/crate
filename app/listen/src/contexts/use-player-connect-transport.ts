import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { AuthUser } from "@/contexts/auth-context";
import type { PlayerConnectValue } from "@/contexts/player-context";
import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { clampIndex } from "@/contexts/player-queue-helpers";
import { useCrateConnectCommands } from "@/contexts/use-crate-connect-commands";
import { usePlayerConnectV2Sync } from "@/contexts/use-player-connect-v2-sync";
import type { PlayerConnectV2SyncRuntime } from "@/contexts/use-player-connect-v2-sync";
import {
  remotePlaybackQueue,
  remoteTrackToPlayerTrack,
  type PlaybackStatePayload,
  type RemotePlaybackState,
} from "@/lib/remote-playback-state";

export { hasRemoteConnectOwner } from "@/contexts/use-player-connect-v2-sync";

interface Ref<T> {
  current: T;
}

type ConnectPublishOptions = { claimActive?: boolean };
type PublishConnectState = (options?: ConnectPublishOptions) => Promise<void>;
type BuildConnectSnapshotPayload = (
  snapshotKind: "light" | "structural",
  options?: ConnectPublishOptions,
) => PlaybackStatePayload;

interface UsePlayerConnectTransportOptions {
  authUser: AuthUser | null;
  buildConnectSnapshotPayload: BuildConnectSnapshotPayload;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  connectEnabled: boolean;
  connectV1Enabled: boolean;
  connectV2Enabled: boolean;
  connectV2PublishRef: Ref<PublishConnectState | null>;
  currentTimeRef: Ref<number>;
  currentIndex: number;
  isBuffering: boolean;
  isPlaying: boolean;
  isPlayingRef: Ref<boolean>;
  pendingRestoreTimeRef: Ref<number>;
  playSource: PlaySource | null;
  playSourceRef: Ref<PlaySource | null>;
  pushToEngine: (
    queue: Track[],
    index: number,
    options?: { autoplay?: boolean; positionMs?: number },
  ) => void;
  queue: Track[];
  queueRef: Ref<Track[]>;
  repeat: RepeatMode;
  repeatRef: Ref<RepeatMode>;
  requireUserGestureToResume: () => void;
  publishConnectState: PublishConnectState;
  setPlaySource: Dispatch<SetStateAction<PlaySource | null>>;
  setRepeatState: Dispatch<SetStateAction<RepeatMode>>;
  setShuffleState: Dispatch<SetStateAction<boolean>>;
  setVolume: (volume: number) => void;
  shuffle: boolean;
  shuffleRef: Ref<boolean>;
  suppressNextConnectClaimRef: Ref<boolean>;
  unshuffledQueueRef: Ref<Track[] | null>;
  volume: number;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
}

const noConnectTransfer = () => false;
const noConnectRemoteCommand = () => false;

export interface PlayerConnectTransportRuntime {
  clearTransferPlaybackGuard: () => void;
  connectValue: PlayerConnectValue;
}

export function usePlayerConnectTransport({
  authUser,
  buildConnectSnapshotPayload,
  commitCurrentTime,
  commitDuration,
  connectEnabled,
  connectV1Enabled,
  connectV2Enabled,
  connectV2PublishRef,
  currentIndex,
  currentTimeRef,
  isBuffering,
  isPlaying,
  isPlayingRef,
  pendingRestoreTimeRef,
  playSource,
  playSourceRef,
  pushToEngine,
  queue,
  queueRef,
  repeat,
  repeatRef,
  requireUserGestureToResume,
  publishConnectState,
  setPlaySource,
  setRepeatState,
  setShuffleState,
  setVolume,
  shuffle,
  shuffleRef,
  suppressNextConnectClaimRef,
  unshuffledQueueRef,
  volume,
  pause,
  resume,
  next,
  prev,
  seek,
}: UsePlayerConnectTransportOptions): PlayerConnectTransportRuntime {
  const applyConnectStateToLocalQueue = useCallback(
    (state: RemotePlaybackState, startPlaying: boolean) => {
      const tracks = remotePlaybackQueue(state);
      if (!tracks.length) return false;
      const nextIndex = clampIndex(state.current_index, tracks.length);
      const nextRepeat =
        state.repeat_mode === "one" || state.repeat_mode === "all"
          ? state.repeat_mode
          : "off";
      const nextShuffle = Boolean(state.shuffle);
      const nextSource =
        state.play_source ||
        (tracks.length > 1
          ? { type: "queue" as const, name: "Queue" }
          : {
              type: "track" as const,
              name: tracks[nextIndex]?.title || "Track",
            });

      if (startPlaying) {
        suppressNextConnectClaimRef.current = true;
      }
      repeatRef.current = nextRepeat;
      shuffleRef.current = nextShuffle;
      playSourceRef.current = nextSource;
      unshuffledQueueRef.current = state.unshuffled_queue
        ? state.unshuffled_queue.map(remoteTrackToPlayerTrack)
        : null;
      setRepeatState(nextRepeat);
      setShuffleState(nextShuffle);
      setPlaySource(nextSource);
      const positionSeconds = Math.max(0, (state.position_ms || 0) / 1000);
      pendingRestoreTimeRef.current = positionSeconds;
      pushToEngine(tracks, nextIndex, {
        autoplay: startPlaying,
        positionMs: Math.max(0, state.position_ms || 0),
      });
      commitCurrentTime(positionSeconds);
      commitDuration(Math.max(0, (state.duration_ms || 0) / 1000));
      return true;
    },
    [
      commitCurrentTime,
      commitDuration,
      pendingRestoreTimeRef,
      playSourceRef,
      pushToEngine,
      repeatRef,
      setPlaySource,
      setRepeatState,
      setShuffleState,
      shuffleRef,
      suppressNextConnectClaimRef,
      unshuffledQueueRef,
    ],
  );

  const handleConnectTransferIn = useCallback(
    (state: RemotePlaybackState, startPlaying: boolean) => {
      applyConnectStateToLocalQueue(state, startPlaying);
    },
    [applyConnectStateToLocalQueue],
  );

  const connectV2: PlayerConnectV2SyncRuntime = usePlayerConnectV2Sync({
    applyConnectStateToLocalQueue,
    authUserId: authUser?.id,
    buildConnectSnapshotPayload,
    connectV2Enabled,
    connectV2PublishRef,
    currentIndex,
    currentTimeRef,
    isPlaying,
    isPlayingRef,
    next,
    pause,
    playSource,
    prev,
    publishConnectState,
    queue,
    queueRef,
    repeat,
    requireUserGestureToResume,
    resume,
    seek,
    setVolume,
    shuffle,
    volume,
  });

  useCrateConnectCommands({
    authUser,
    enabled: connectV1Enabled,
    isBuffering,
    isPlaying,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
    onTransferIn: handleConnectTransferIn,
  });

  const connectValue = useMemo<PlayerConnectValue>(
    () => ({
      activeInstanceId: connectV2.activeInstanceId,
      connectedInstances: connectV2.connectedInstances,
      enabled: connectEnabled,
      isRemoteActive: connectV2.isRemoteActive,
      playbackInstanceId: connectV2.playbackInstanceId,
      remoteState: connectV2.remoteState,
      requestTransfer: connectV2Enabled
        ? connectV2.requestTransfer
        : noConnectTransfer,
      sendRemoteCommand: connectV2Enabled
        ? connectV2.sendRemoteCommand
        : noConnectRemoteCommand,
      serverClockOffsetMs: connectV2.serverClockOffsetMs,
      transport: connectEnabled ? (connectV2Enabled ? "ws" : "legacy") : null,
    }),
    [connectEnabled, connectV2, connectV2Enabled],
  );

  return {
    clearTransferPlaybackGuard: connectV2.clearTransferPlaybackGuard,
    connectValue,
  };
}
