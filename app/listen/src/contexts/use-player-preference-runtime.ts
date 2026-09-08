import { useEffect } from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import {
  getEffectivePlaybackDeliveryPolicy,
  getInfinitePlaybackPreference,
  getPlaybackDeliveryPolicyPreference,
  getSmartCrossfadePreference,
  getSmartPlaylistSuggestionsCadencePreference,
  getSmartPlaylistSuggestionsPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";
import { preparePlaybackDelivery } from "@/lib/playback-delivery";

type PlaybackPreferenceRuntimeOptions = {
  currentIndex: number;
  playbackDeliveryPolicy: PlaybackDeliveryPreference;
  playSource: PlaySource | null;
  queue: Track[];
  repeat: RepeatMode;
  setInfinitePlaybackEnabled: (enabled: boolean) => void;
  setPlaybackDeliveryPolicy: (policy: PlaybackDeliveryPreference) => void;
  setSmartCrossfadeEnabled: (enabled: boolean) => void;
  setSmartPlaylistSuggestionsCadence: (cadence: number) => void;
  setSmartPlaylistSuggestionsEnabled: (enabled: boolean) => void;
  shuffle: boolean;
  smartCrossfadeEnabled: boolean;
  syncEffectiveCrossfade: () => void;
};

type PlaybackPreferenceEventDetail = {
  infinitePlaybackEnabled?: boolean;
  playbackDeliveryPolicy?: PlaybackDeliveryPreference;
  smartCrossfadeEnabled?: boolean;
  smartPlaylistSuggestionsCadence?: number;
  smartPlaylistSuggestionsEnabled?: boolean;
};

export function usePlayerPreferenceRuntime({
  currentIndex,
  playbackDeliveryPolicy,
  playSource,
  queue,
  repeat,
  setInfinitePlaybackEnabled,
  setPlaybackDeliveryPolicy,
  setSmartCrossfadeEnabled,
  setSmartPlaylistSuggestionsCadence,
  setSmartPlaylistSuggestionsEnabled,
  shuffle,
  smartCrossfadeEnabled,
  syncEffectiveCrossfade,
}: PlaybackPreferenceRuntimeOptions) {
  useEffect(() => {
    const onPrefsChanged = (event: Event) => {
      const detail = (event as CustomEvent<PlaybackPreferenceEventDetail>)
        .detail;
      syncEffectiveCrossfade();
      setSmartCrossfadeEnabled(
        typeof detail?.smartCrossfadeEnabled === "boolean"
          ? detail.smartCrossfadeEnabled
          : getSmartCrossfadePreference(),
      );
      setInfinitePlaybackEnabled(
        typeof detail?.infinitePlaybackEnabled === "boolean"
          ? detail.infinitePlaybackEnabled
          : getInfinitePlaybackPreference(),
      );
      setPlaybackDeliveryPolicy(
        detail?.playbackDeliveryPolicy ?? getPlaybackDeliveryPolicyPreference(),
      );
      setSmartPlaylistSuggestionsEnabled(
        typeof detail?.smartPlaylistSuggestionsEnabled === "boolean"
          ? detail.smartPlaylistSuggestionsEnabled
          : getSmartPlaylistSuggestionsPreference(),
      );
      setSmartPlaylistSuggestionsCadence(
        typeof detail?.smartPlaylistSuggestionsCadence === "number"
          ? detail.smartPlaylistSuggestionsCadence
          : getSmartPlaylistSuggestionsCadencePreference(),
      );
    };

    window.addEventListener(
      PLAYER_PLAYBACK_PREFS_EVENT,
      onPrefsChanged as EventListener,
    );
    return () => {
      window.removeEventListener(
        PLAYER_PLAYBACK_PREFS_EVENT,
        onPrefsChanged as EventListener,
      );
    };
  }, [
    setInfinitePlaybackEnabled,
    setPlaybackDeliveryPolicy,
    setSmartCrossfadeEnabled,
    setSmartPlaylistSuggestionsCadence,
    setSmartPlaylistSuggestionsEnabled,
    syncEffectiveCrossfade,
  ]);

  useEffect(() => {
    syncEffectiveCrossfade();
  }, [
    currentIndex,
    playSource,
    queue,
    repeat,
    shuffle,
    smartCrossfadeEnabled,
    syncEffectiveCrossfade,
  ]);

  useEffect(() => {
    preparePlaybackDelivery(
      queue,
      currentIndex,
      getEffectivePlaybackDeliveryPolicy(playbackDeliveryPolicy),
    );
  }, [currentIndex, playbackDeliveryPolicy, queue]);
}
