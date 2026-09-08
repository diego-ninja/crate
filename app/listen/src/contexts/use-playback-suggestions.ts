import { useCallback, useEffect, useRef } from "react";

import { areTracksFromSameAlbum } from "@/contexts/player-utils";
import { fetchInfiniteContinuation } from "@/lib/radio";
import {
  SMART_PLAYLIST_SUGGESTION_BATCH_SIZE,
  type PlaybackIntelligenceRefs,
} from "./playback-intelligence-model";
import type { PlaySource, Track } from "./player-types";

interface UsePlaybackSuggestionsOptions {
  currentIndex: number;
  playSource: PlaySource | null;
  queue: Track[];
  refs: PlaybackIntelligenceRefs;
  shuffle: boolean;
  smartPlaylistSuggestionsCadence: number;
  smartPlaylistSuggestionsEnabled: boolean;
}

export function usePlaybackSuggestions({
  currentIndex,
  playSource,
  queue,
  refs,
  shuffle,
  smartPlaylistSuggestionsCadence,
  smartPlaylistSuggestionsEnabled,
}: UsePlaybackSuggestionsOptions) {
  const inFlightRef = useRef(false);
  const signatureRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    signatureRef.current = null;
  }, []);

  useEffect(() => {
    const currentTrack = queue[currentIndex];
    const nextTrack = queue[currentIndex + 1];
    const suggestionSource = playSource;
    const supportsSmartInclusion =
      smartPlaylistSuggestionsEnabled &&
      !shuffle &&
      !!currentTrack &&
      suggestionSource?.type === "playlist" &&
      !!suggestionSource?.radio?.seedId;

    if (!supportsSmartInclusion || !suggestionSource) {
      signatureRef.current = null;
      return;
    }
    if (currentTrack?.isSuggested) {
      signatureRef.current = null;
      return;
    }
    if (areTracksFromSameAlbum(currentTrack, nextTrack)) {
      signatureRef.current = null;
      return;
    }

    const playedOriginalCount = queue
      .slice(0, currentIndex + 1)
      .filter((track) => !track.isSuggested).length;

    if (
      playedOriginalCount === 0 ||
      playedOriginalCount % smartPlaylistSuggestionsCadence !== 0
    ) {
      signatureRef.current = null;
      return;
    }

    if (nextTrack?.isSuggested) {
      signatureRef.current = [
        suggestionSource.radio?.seedId ?? "",
        playedOriginalCount,
        currentTrack?.id ?? "",
      ].join("::");
      return;
    }

    if (inFlightRef.current) return;

    const signature = [
      suggestionSource.radio?.seedId ?? "",
      playedOriginalCount,
      currentTrack?.id ?? "",
      queue.length,
    ].join("::");
    if (signatureRef.current === signature) return;
    signatureRef.current = signature;
    inFlightRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    const expectedSeedId = suggestionSource.radio?.seedId ?? null;

    fetchInfiniteContinuation(
      suggestionSource,
      SMART_PLAYLIST_SUGGESTION_BATCH_SIZE,
      { signal: controller.signal },
    )
      .then((tracks) => {
        if (controller.signal.aborted || !tracks.length) return;
        if (signatureRef.current !== signature) return;
        const latestSource = refs.playSourceRef.current;
        if (
          latestSource?.type !== "playlist" ||
          latestSource?.radio?.seedId !== expectedSeedId
        )
          return;

        refs.actionsRef.current.insertSuggestionAfterCurrent(tracks);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("[player] playlist suggestion failed:", error);
      })
      .finally(() => {
        if (!controller.signal.aborted) inFlightRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
      });

    return () => {
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
      inFlightRef.current = false;
    };
  }, [
    currentIndex,
    playSource,
    queue,
    refs,
    shuffle,
    smartPlaylistSuggestionsCadence,
    smartPlaylistSuggestionsEnabled,
  ]);

  return reset;
}
