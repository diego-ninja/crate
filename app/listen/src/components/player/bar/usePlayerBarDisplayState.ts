import { useMemo } from "react";
import type { PlaySource, Track } from "@/contexts/player-types";
import { useTrackInfo } from "@/hooks/use-track-info";
import { useTrackPlayback } from "@/hooks/use-track-playback";
import {
  getTrackQualityFallback,
  getTrackQualityFromInfo,
  mergeTrackQualityParts,
} from "@/lib/track-info";
import {
  getTrackQualityFromPlaybackQuality,
  playbackResolutionShowsDeliveryQuality,
} from "@/lib/track-playback";
import {
  getEffectivePlaybackDeliveryPolicy,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";
import {
  getQualityBadge,
  shouldFetchTrackQualityInfo,
  type QualityBadge,
} from "@/components/player/bar/player-bar-utils";
import { getPlaySourceLabel } from "@/components/player/player-source";
import {
  remotePlaybackQueue,
  type RemotePlaybackState,
} from "@/lib/remote-playback-state";

type DisplayStateOptions = {
  currentTrack: Track | undefined;
  queue: Track[];
  currentIndex: number;
  playSource: PlaySource | null;
  remoteConnectState: RemotePlaybackState | null;
  isRemoteConnectActive: boolean;
  legacyConnectEnabled: boolean;
};

type DisplayState = {
  displayTrack: Track | undefined;
  displayQueue: Track[];
  displayCurrentIndex: number;
  displayPlaySource: PlaySource | null;
};

type DisplayQuality = {
  qualityBadge: QualityBadge | null;
  showsDeliveryQuality: boolean;
};

function getDisplayState({
  currentTrack,
  queue,
  currentIndex,
  playSource,
  remoteConnectState,
  isRemoteConnectActive,
  legacyConnectEnabled,
}: DisplayStateOptions): DisplayState {
  const remoteDisplayQueue = remoteConnectState
    ? remotePlaybackQueue(remoteConnectState)
    : [];
  const remoteDisplayIndex = remoteDisplayQueue.length
    ? Math.max(
        0,
        Math.min(
          remoteConnectState?.current_index ?? 0,
          remoteDisplayQueue.length - 1,
        ),
      )
    : 0;
  const shouldDisplayConnectSnapshot =
    remoteDisplayQueue.length > 0 &&
    (isRemoteConnectActive || (legacyConnectEnabled && !currentTrack));

  return {
    displayTrack: shouldDisplayConnectSnapshot
      ? remoteDisplayQueue[remoteDisplayIndex]
      : currentTrack,
    displayQueue: shouldDisplayConnectSnapshot ? remoteDisplayQueue : queue,
    displayCurrentIndex: shouldDisplayConnectSnapshot
      ? remoteDisplayIndex
      : currentIndex,
    displayPlaySource:
      shouldDisplayConnectSnapshot && remoteConnectState?.play_source
        ? remoteConnectState.play_source
        : playSource,
  };
}

function getDisplayQuality(
  displayTrack: Track | undefined,
  currentTrackInfo: ReturnType<typeof useTrackInfo>["info"],
  currentTrackPlayback: ReturnType<typeof useTrackPlayback>["resolution"],
): DisplayQuality {
  if (!displayTrack) {
    return { qualityBadge: null, showsDeliveryQuality: false };
  }

  const sourceTrackQuality = mergeTrackQualityParts(
    getTrackQualityFallback(displayTrack),
    getTrackQualityFromInfo(currentTrackInfo),
    getTrackQualityFromPlaybackQuality(currentTrackPlayback?.source),
  );
  const showsDeliveryQuality =
    playbackResolutionShowsDeliveryQuality(currentTrackPlayback);
  const activeTrackQuality =
    currentTrackPlayback && showsDeliveryQuality
      ? mergeTrackQualityParts(
          sourceTrackQuality,
          getTrackQualityFromPlaybackQuality(currentTrackPlayback.delivery, {
            preferCodec: true,
          }),
        )
      : sourceTrackQuality;

  return {
    qualityBadge: getQualityBadge({
      id: displayTrack.id,
      path: displayTrack.path,
      ...(activeTrackQuality ?? {}),
    }),
    showsDeliveryQuality,
  };
}

type UsePlayerBarDisplayStateOptions = DisplayStateOptions & {
  playbackDeliveryPolicy: PlaybackDeliveryPreference;
};

export function usePlayerBarDisplayState({
  playbackDeliveryPolicy,
  currentTrack,
  queue,
  currentIndex,
  playSource,
  remoteConnectState,
  isRemoteConnectActive,
  legacyConnectEnabled,
}: UsePlayerBarDisplayStateOptions) {
  const displayState = useMemo(
    () =>
      getDisplayState({
        currentTrack,
        queue,
        currentIndex,
        playSource,
        remoteConnectState,
        isRemoteConnectActive,
        legacyConnectEnabled,
      }),
    [
      currentIndex,
      currentTrack,
      isRemoteConnectActive,
      legacyConnectEnabled,
      playSource,
      queue,
      remoteConnectState,
    ],
  );
  const displayTrackForQueries = displayState.displayTrack;
  const shouldResolveTrackInfo = shouldFetchTrackQualityInfo(
    displayTrackForQueries,
  );
  const { info: currentTrackInfo } = useTrackInfo(displayTrackForQueries, {
    enabled: shouldResolveTrackInfo,
  });
  const { resolution: currentTrackPlayback } = useTrackPlayback(
    displayTrackForQueries,
    getEffectivePlaybackDeliveryPolicy(playbackDeliveryPolicy),
    { enabled: !!displayState.displayTrack },
  );
  const displayQuality = getDisplayQuality(
    displayState.displayTrack,
    currentTrackInfo,
    currentTrackPlayback,
  );
  const shapedRadioSessionId =
    displayState.displayPlaySource?.radio?.shapedSessionId;

  return {
    ...displayState,
    ...displayQuality,
    shapedRadioSessionId,
    isShapedRadioTrack: !!(
      shapedRadioSessionId && displayState.displayTrack?.libraryTrackId
    ),
    sourceLabel: getPlaySourceLabel(displayState.displayPlaySource),
  };
}
