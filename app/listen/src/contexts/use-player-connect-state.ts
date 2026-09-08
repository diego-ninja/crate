import { useCallback, useRef } from "react";

import type { AuthUser } from "@/contexts/auth-context";
import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { usePlayerAuthSync } from "@/contexts/use-player-auth-sync";
import { useRemotePlaybackState } from "@/contexts/use-remote-playback-state";
import { useCrateConnectEnabled } from "@/hooks/use-crate-connect-enabled";
import { CRATE_CONNECT_V2_TRANSPORT_ENABLED } from "@/lib/crate-connect";
import {
  buildPlaybackStatePayload,
  type PlaybackStatePayload,
} from "@/lib/remote-playback-state";

interface Ref<T> {
  current: T;
}

export type ConnectPublishOptions = { claimActive?: boolean };
export type PublishConnectState = (
  options?: ConnectPublishOptions,
) => Promise<void>;

interface UsePlayerConnectStateOptions {
  authUser: AuthUser | null;
  currentTrack: Track | undefined;
  isPlaying: boolean;
  queue: Track[];
  currentIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  playSource: PlaySource | null;
  queueRef: Ref<Track[]>;
  currentIndexRef: Ref<number>;
  currentTimeRef: Ref<number>;
  durationRef: Ref<number>;
  isPlayingRef: Ref<boolean>;
  shuffleRef: Ref<boolean>;
  repeatRef: Ref<RepeatMode>;
  playSourceRef: Ref<PlaySource | null>;
  unshuffledQueueRef: Ref<Track[] | null>;
}

export function usePlayerConnectState({
  authUser,
  currentTrack,
  isPlaying,
  queue,
  currentIndex,
  shuffle,
  repeat,
  playSource,
  queueRef,
  currentIndexRef,
  currentTimeRef,
  durationRef,
  isPlayingRef,
  shuffleRef,
  repeatRef,
  playSourceRef,
  unshuffledQueueRef,
}: UsePlayerConnectStateOptions) {
  const connectEnabled = useCrateConnectEnabled();
  const connectV2Enabled = connectEnabled && CRATE_CONNECT_V2_TRANSPORT_ENABLED;
  const connectV1Enabled =
    connectEnabled && !CRATE_CONNECT_V2_TRANSPORT_ENABLED;
  const suppressNextConnectClaimRef = useRef(false);
  const connectV2PublishRef = useRef<PublishConnectState | null>(null);

  usePlayerAuthSync({
    authUser,
    currentTrack,
    isPlaying,
  });

  const buildConnectSnapshotPayload = useCallback(
    (
      snapshotKind: "light" | "structural",
      options?: ConnectPublishOptions,
    ): PlaybackStatePayload =>
      buildPlaybackStatePayload({
        currentIndex: currentIndexRef.current,
        currentTime: currentTimeRef.current,
        duration: durationRef.current,
        isPlaying: isPlayingRef.current,
        playSource: playSourceRef.current,
        queue: queueRef.current,
        repeat: repeatRef.current,
        shuffle: shuffleRef.current,
        snapshotKind,
        unshuffledQueue: unshuffledQueueRef.current,
        claimActive: options?.claimActive,
      }),
    [
      currentIndexRef,
      currentTimeRef,
      durationRef,
      isPlayingRef,
      playSourceRef,
      queueRef,
      repeatRef,
      shuffleRef,
      unshuffledQueueRef,
    ],
  );

  const { publishStructuralNow: publishConnectStateV1 } =
    useRemotePlaybackState({
      authUser,
      enabled: connectV1Enabled,
      queue,
      currentIndex,
      isPlaying,
      shuffle,
      repeat,
      playSource,
      queueRef,
      currentIndexRef,
      currentTimeRef,
      durationRef,
      isPlayingRef,
      shuffleRef,
      repeatRef,
      playSourceRef,
      unshuffledQueueRef,
      suppressNextActiveClaimRef: suppressNextConnectClaimRef,
    });

  const publishConnectState = useCallback(
    async (options?: ConnectPublishOptions) => {
      if (connectV2Enabled) {
        await connectV2PublishRef.current?.(options);
        return;
      }
      await publishConnectStateV1(options);
    },
    [connectV2Enabled, publishConnectStateV1],
  );

  return {
    authUser,
    connectEnabled,
    connectV1Enabled,
    connectV2Enabled,
    connectV2PublishRef,
    suppressNextConnectClaimRef,
    buildConnectSnapshotPayload,
    publishConnectState,
  };
}
