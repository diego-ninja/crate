import { useMemo } from "react";
import type { CrossfadeTransition } from "@/contexts/player-context";
import type { Track } from "@/contexts/player-types";
import type { PlaybackTargetContext } from "@/lib/playback-targets";

type IsLiked = (
  trackId?: number | null,
  trackEntityUid?: string | null,
  trackPath?: string | null,
  globalTrackUid?: string | null,
) => boolean;

type UsePlayerBarComputedStateOptions = {
  crossfadeTransition: CrossfadeTransition | null;
  isDesktop: boolean;
  fsOpen: boolean;
  isRemoteConnectActive: boolean;
  isBuffering: boolean;
  effectiveDisplayedTime: number;
  effectiveDisplayedDuration: number;
  effectiveVolume: number;
  displayTrack: Track | undefined;
  displayQueue: Track[];
  displayCurrentIndex: number;
  legacyConnectEnabled: boolean;
  activeConnectDeviceId: string | null;
  activeConnectSession: PlaybackTargetContext["activeConnectSession"];
  connect: PlaybackTargetContext["connect"];
  pause: PlaybackTargetContext["pause"];
  publishConnectState: PlaybackTargetContext["publishConnectState"];
  isLiked: IsLiked;
};

export function usePlayerBarComputedState({
  crossfadeTransition,
  isDesktop,
  fsOpen,
  isRemoteConnectActive,
  isBuffering,
  effectiveDisplayedTime,
  effectiveDisplayedDuration,
  effectiveVolume,
  displayTrack,
  displayQueue,
  displayCurrentIndex,
  legacyConnectEnabled,
  activeConnectDeviceId,
  activeConnectSession,
  connect,
  pause,
  publishConnectState,
  isLiked,
}: UsePlayerBarComputedStateOptions) {
  const playbackTargetContext = useMemo<PlaybackTargetContext>(
    () => ({
      currentTrack: displayTrack,
      currentTime: effectiveDisplayedTime,
      currentIndex: displayCurrentIndex,
      queue: displayQueue,
      volume: effectiveVolume,
      activeConnectDeviceId: legacyConnectEnabled
        ? activeConnectDeviceId
        : null,
      activeConnectSession: legacyConnectEnabled ? activeConnectSession : null,
      connect,
      pause,
      publishConnectState,
    }),
    [
      activeConnectDeviceId,
      activeConnectSession,
      connect,
      displayCurrentIndex,
      displayQueue,
      displayTrack,
      effectiveDisplayedTime,
      effectiveVolume,
      legacyConnectEnabled,
      pause,
      publishConnectState,
    ],
  );

  const liked = isLiked(
    displayTrack?.libraryTrackId ?? null,
    displayTrack?.entityUid ?? null,
    displayTrack ? displayTrack.path || displayTrack.id : "",
    displayTrack?.globalTrackUid ?? null,
  );

  return {
    displayCrossfadeTransition: isRemoteConnectActive
      ? null
      : crossfadeTransition,
    effectiveIsBuffering: isRemoteConnectActive ? false : isBuffering,
    hidePlayerBarForMobileFullscreen: !isDesktop && fsOpen,
    liked,
    playbackTargetContext,
    progressPct:
      effectiveDisplayedDuration > 0
        ? Math.max(
            0,
            Math.min(
              100,
              (effectiveDisplayedTime / effectiveDisplayedDuration) * 100,
            ),
          )
        : 0,
  };
}
