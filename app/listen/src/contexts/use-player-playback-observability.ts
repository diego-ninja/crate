import { useCallback, useEffect } from "react";

import type { Track } from "@/contexts/player-types";
import { usePlayEventTracker } from "@/contexts/use-play-event-tracker";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";
import {
  getEffectivePlaybackDeliveryPolicy,
  getPlaybackDeliveryPolicyPreference,
  subscribeToPlaybackDeliveryNetworkChanges,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";
import { recordStablePlayback } from "@/lib/playback-network-quality";
import { getPlaybackDeliveryProvenance } from "@/lib/playback-provenance";
import {
  getPlaybackQoeRuntime,
  installPlaybackQoeFlush,
  recordPlaybackQoe,
  type PlaybackQoeEventName,
} from "@/lib/playback-qoe";

interface Ref<T> {
  current: T;
}

interface UsePlayerPlaybackObservabilityOptions {
  currentTrackRef: Ref<Track | null | undefined>;
  currentTimeRef: Ref<number>;
  durationRef: Ref<number>;
  playbackDeliveryPolicy: PlaybackDeliveryPreference;
  setPlaybackDeliveryPolicy: (policy: PlaybackDeliveryPreference) => void;
}

export function usePlayerPlaybackObservability({
  currentTrackRef,
  currentTimeRef,
  durationRef,
  playbackDeliveryPolicy,
  setPlaybackDeliveryPolicy,
}: UsePlayerPlaybackObservabilityOptions) {
  const getPlaybackSnapshot = useCallback(
    () => ({
      currentTime: currentTimeRef.current,
      duration: durationRef.current,
    }),
    [currentTimeRef, durationRef],
  );

  const {
    startSession: startTrackerSession,
    ensureSession: ensureTrackerSession,
    flushCurrentPlayEvent,
    rotateSession: rotateTrackerSession,
    markSeekPosition,
    recordProgress,
  } = usePlayEventTracker(getPlaybackSnapshot);

  const recordPlaybackQualityProgress = useCallback((seconds: number) => {
    recordStablePlayback(seconds);
  }, []);

  const recordCurrentPlaybackQoe = useCallback(
    (
      event: PlaybackQoeEventName,
      details: {
        durationMs?: number;
        bufferedAheadSeconds?: number;
        attempt?: number;
      } = {},
    ) => {
      const track = currentTrackRef.current;
      if (!track) return;
      const policy = getEffectivePlaybackDeliveryPolicy(playbackDeliveryPolicy);
      const provenance = getPlaybackDeliveryProvenance(track);
      recordPlaybackQoe({
        event,
        origin:
          provenance?.origin ??
          (track.origin === "remote" ? "remote" : "local"),
        requestedPolicy: provenance?.requestedPolicy ?? policy,
        effectivePolicy: provenance?.effectivePolicy ?? policy,
        runtime: getPlaybackQoeRuntime(),
        engine: shouldUseAndroidNativePlayer() ? "media3" : "gapless",
        ...details,
      });
    },
    [currentTrackRef, playbackDeliveryPolicy],
  );

  useEffect(() => {
    return subscribeToPlaybackDeliveryNetworkChanges(() => {
      setPlaybackDeliveryPolicy(getPlaybackDeliveryPolicyPreference());
    });
  }, [setPlaybackDeliveryPolicy]);

  useEffect(() => installPlaybackQoeFlush(), []);

  return {
    startTrackerSession,
    ensureTrackerSession,
    flushCurrentPlayEvent,
    rotateTrackerSession,
    markSeekPosition,
    recordProgress,
    recordPlaybackQualityProgress,
    recordCurrentPlaybackQoe,
  };
}

export type PlayerPlaybackObservability = ReturnType<
  typeof usePlayerPlaybackObservability
>;
