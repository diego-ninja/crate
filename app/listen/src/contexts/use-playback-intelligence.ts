import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  type PlaybackIntelligenceOptions,
  type PlaybackIntelligenceRefs,
} from "./playback-intelligence-model";
import { usePlaybackContinuation } from "./use-playback-continuation";
import { usePlaybackRadioRefill } from "./use-playback-radio-refill";
import { usePlaybackSuggestions } from "./use-playback-suggestions";

export function usePlaybackIntelligence({
  queue,
  currentIndex,
  isPlaying,
  playSource,
  shuffle,
  infinitePlaybackEnabled,
  smartPlaylistSuggestionsEnabled,
  smartPlaylistSuggestionsCadence,
  recentlyPlayed,
  actions,
}: PlaybackIntelligenceOptions) {
  const currentIndexRef = useRef(currentIndex);
  const playSourceRef = useRef(playSource);
  const queueRef = useRef(queue);
  const recentlyPlayedRef = useRef(recentlyPlayed);
  // Keep a stable reference to actions so effects don't re-run when the
  // context re-memoizes them. We only ever call via `.current`.
  const actionsRef = useRef(actions);
  const refs = useMemo<PlaybackIntelligenceRefs>(
    () => ({
      currentIndexRef,
      playSourceRef,
      queueRef,
      recentlyPlayedRef,
      actionsRef,
    }),
    [actionsRef, currentIndexRef, playSourceRef, queueRef, recentlyPlayedRef],
  );

  useEffect(() => {
    currentIndexRef.current = currentIndex;
    playSourceRef.current = playSource;
    queueRef.current = queue;
    recentlyPlayedRef.current = recentlyPlayed;
    actionsRef.current = actions;
  }, [actions, currentIndex, playSource, queue, recentlyPlayed]);

  const resetRadioRefill = usePlaybackRadioRefill({
    currentIndex,
    isPlaying,
    playSource,
    queue,
    refs,
  });
  const { continueInfinitePlayback, reset: resetContinuation } =
    usePlaybackContinuation({
      currentIndex,
      infinitePlaybackEnabled,
      playSource,
      queue,
      refs,
      shuffle,
    });
  const resetSuggestions = usePlaybackSuggestions({
    currentIndex,
    playSource,
    queue,
    refs,
    shuffle,
    smartPlaylistSuggestionsCadence,
    smartPlaylistSuggestionsEnabled,
  });

  const resetPlaybackIntelligence = useCallback(() => {
    resetRadioRefill();
    resetContinuation();
    resetSuggestions();
  }, [resetContinuation, resetRadioRefill, resetSuggestions]);

  return {
    continueInfinitePlayback,
    resetPlaybackIntelligence,
  };
}
