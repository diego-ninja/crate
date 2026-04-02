import { useCallback, useEffect, useRef } from "react";

import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { PlaySource, Track } from "@/contexts/player-types";
import { areTracksFromSameAlbum, getTrackCacheKey } from "@/contexts/player-utils";
import { fetchInfiniteContinuation, fetchRadioContinuation } from "@/lib/radio";

const RADIO_REFILL_THRESHOLD = 3;
const RADIO_REFILL_BATCH_SIZE = 30;
const SMART_PLAYLIST_SUGGESTION_BATCH_SIZE = 12;

function getPlaySourceSignature(source: PlaySource | null): string | null {
  if (!source) return null;
  return [
    source.type,
    source.name,
    source.radio?.seedType ?? "",
    source.radio?.seedId ?? "",
    source.radio?.seedPath ?? "",
  ].join("::");
}

function collectUniqueTracks(candidates: Track[], queue: Track[], recent: Track[]): Track[] {
  const existingKeys = new Set(
    [...queue, ...recent].map((track) => getTrackCacheKey(track)),
  );
  const uniqueTracks: Track[] = [];
  for (const track of candidates) {
    const key = getTrackCacheKey(track);
    if (!key || existingKeys.has(key)) continue;
    existingKeys.add(key);
    uniqueTracks.push(track);
  }
  return uniqueTracks;
}


interface UsePlaybackIntelligenceOptions {
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  playSource: PlaySource | null;
  shuffle: boolean;
  infinitePlaybackEnabled: boolean;
  smartPlaylistSuggestionsEnabled: boolean;
  smartPlaylistSuggestionsCadence: number;
  recentlyPlayed: Track[];
  shouldAutoplayRef: MutableRefObject<boolean>;
  setQueue: Dispatch<SetStateAction<Track[]>>;
  setCurrentIndex: Dispatch<SetStateAction<number>>;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  setDuration: Dispatch<SetStateAction<number>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setIsBuffering: Dispatch<SetStateAction<boolean>>;
}

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
  shouldAutoplayRef,
  setQueue,
  setCurrentIndex,
  setCurrentTime,
  setDuration,
  setIsPlaying,
  setIsBuffering,
}: UsePlaybackIntelligenceOptions) {
  const radioRefillInFlightRef = useRef(false);
  const radioRefillSignatureRef = useRef<string | null>(null);
  const continuationInFlightRef = useRef(false);
  const continuationSignatureRef = useRef<string | null>(null);
  const playlistSuggestionInFlightRef = useRef(false);
  const playlistSuggestionSignatureRef = useRef<string | null>(null);
  const radioRefillAbortRef = useRef<AbortController | null>(null);
  const continuationPrefetchAbortRef = useRef<AbortController | null>(null);
  const continuationManualAbortRef = useRef<AbortController | null>(null);
  const playlistSuggestionAbortRef = useRef<AbortController | null>(null);
  const currentIndexRef = useRef(currentIndex);
  const playSourceRef = useRef(playSource);
  const queueRef = useRef(queue);
  const recentlyPlayedRef = useRef(recentlyPlayed);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
    playSourceRef.current = playSource;
    queueRef.current = queue;
    recentlyPlayedRef.current = recentlyPlayed;
  }, [currentIndex, playSource, queue, recentlyPlayed]);

  const resetPlaybackIntelligence = useCallback(() => {
    radioRefillAbortRef.current?.abort();
    continuationPrefetchAbortRef.current?.abort();
    continuationManualAbortRef.current?.abort();
    playlistSuggestionAbortRef.current?.abort();
    radioRefillAbortRef.current = null;
    continuationPrefetchAbortRef.current = null;
    continuationManualAbortRef.current = null;
    playlistSuggestionAbortRef.current = null;
    radioRefillInFlightRef.current = false;
    continuationInFlightRef.current = false;
    playlistSuggestionInFlightRef.current = false;
    radioRefillSignatureRef.current = null;
    continuationSignatureRef.current = null;
    playlistSuggestionSignatureRef.current = null;
    shouldAutoplayRef.current = false;
  }, []);

  useEffect(() => {
    const currentTrack = queue[currentIndex];
    if (!isPlaying || !currentTrack) return;
    if (playSource?.type !== "radio" || !playSource.radio) return;

    const remainingUpcoming = queue.length - currentIndex - 1;
    if (remainingUpcoming > RADIO_REFILL_THRESHOLD) {
      radioRefillSignatureRef.current = null;
      return;
    }
    if (radioRefillInFlightRef.current) return;

    const signature = [
      getPlaySourceSignature(playSource),
      currentTrack.id,
      queue.length,
    ].join("::");
    if (radioRefillSignatureRef.current === signature) return;
    radioRefillSignatureRef.current = signature;
    radioRefillInFlightRef.current = true;
    const controller = new AbortController();
    radioRefillAbortRef.current = controller;

    fetchRadioContinuation(playSource, RADIO_REFILL_BATCH_SIZE, { signal: controller.signal })
      .then((tracks) => {
        if (controller.signal.aborted) return;
        if (radioRefillSignatureRef.current !== signature) return;
        if (getPlaySourceSignature(playSourceRef.current) !== getPlaySourceSignature(playSource)) return;
        setQueue((prev) => {
          if (radioRefillSignatureRef.current !== signature) return prev;
          if (getPlaySourceSignature(playSourceRef.current) !== getPlaySourceSignature(playSource)) return prev;
          const uniqueTracks = collectUniqueTracks(tracks, prev, recentlyPlayedRef.current);
          return uniqueTracks.length > 0 ? [...prev, ...uniqueTracks] : prev;
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("[player] radio refill failed:", error);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          radioRefillInFlightRef.current = false;
        }
        if (radioRefillAbortRef.current === controller) {
          radioRefillAbortRef.current = null;
        }
      });

    return () => {
      controller.abort();
      if (radioRefillAbortRef.current === controller) {
        radioRefillAbortRef.current = null;
      }
      radioRefillInFlightRef.current = false;
    };
  }, [currentIndex, isPlaying, playSource, queue.length, setQueue]);

  useEffect(() => {
    const currentTrack = queue[currentIndex];
    const supportsContinuation =
      infinitePlaybackEnabled &&
      !shuffle &&
      !!currentTrack &&
      (playSource?.type === "album" || playSource?.type === "playlist") &&
      !!playSource?.radio?.seedId;

    if (!supportsContinuation) return;

    const remainingUpcoming = queue.length - currentIndex - 1;
    if (remainingUpcoming > RADIO_REFILL_THRESHOLD) {
      continuationSignatureRef.current = null;
      return;
    }
    if (continuationInFlightRef.current) return;

    const sessionSignature = getPlaySourceSignature(playSource);
    const signature = [sessionSignature, currentTrack?.id ?? "", queue.length].join("::");
    if (continuationSignatureRef.current === signature) return;
    continuationSignatureRef.current = signature;
    continuationInFlightRef.current = true;
    const controller = new AbortController();
    continuationPrefetchAbortRef.current = controller;

    fetchInfiniteContinuation(playSource!, RADIO_REFILL_BATCH_SIZE, { signal: controller.signal })
      .then((tracks) => {
        if (controller.signal.aborted) return;
        if (!tracks.length) return;
        if (continuationSignatureRef.current !== signature) return;
        if (getPlaySourceSignature(playSourceRef.current) !== sessionSignature) return;
        setQueue((prev) => {
          if (continuationSignatureRef.current !== signature) return prev;
          if (getPlaySourceSignature(playSourceRef.current) !== sessionSignature) return prev;
          const uniqueTracks = collectUniqueTracks(tracks, prev, recentlyPlayedRef.current);
          return uniqueTracks.length > 0 ? [...prev, ...uniqueTracks] : prev;
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("[player] continuation refill failed:", error);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          continuationInFlightRef.current = false;
        }
        if (continuationPrefetchAbortRef.current === controller) {
          continuationPrefetchAbortRef.current = null;
        }
      });

    return () => {
      controller.abort();
      if (continuationPrefetchAbortRef.current === controller) {
        continuationPrefetchAbortRef.current = null;
      }
      continuationInFlightRef.current = false;
    };
  }, [currentIndex, infinitePlaybackEnabled, playSource, queue.length, setQueue, shuffle]);

  useEffect(() => {
    const currentTrack = queue[currentIndex];
    const nextTrack = queue[currentIndex + 1];
    const supportsSmartInclusion =
      smartPlaylistSuggestionsEnabled &&
      !shuffle &&
      !!currentTrack &&
      playSource?.type === "playlist" &&
      !!playSource?.radio?.seedId;

    if (!supportsSmartInclusion) {
      playlistSuggestionSignatureRef.current = null;
      return;
    }
    if (currentTrack?.isSuggested) {
      playlistSuggestionSignatureRef.current = null;
      return;
    }
    if (areTracksFromSameAlbum(currentTrack, nextTrack)) {
      playlistSuggestionSignatureRef.current = null;
      return;
    }

    const playedOriginalCount = queue
      .slice(0, currentIndex + 1)
      .filter((track) => !track.isSuggested).length;

    if (
      playedOriginalCount === 0 ||
      playedOriginalCount % smartPlaylistSuggestionsCadence !== 0
    ) {
      playlistSuggestionSignatureRef.current = null;
      return;
    }

    if (nextTrack?.isSuggested) {
      playlistSuggestionSignatureRef.current = [
        playSource?.radio?.seedId ?? "",
        playedOriginalCount,
        currentTrack?.id ?? "",
      ].join("::");
      return;
    }

    if (playlistSuggestionInFlightRef.current) return;

    const signature = [
      playSource?.radio?.seedId ?? "",
      playedOriginalCount,
      currentTrack?.id ?? "",
      queue.length,
    ].join("::");
    if (playlistSuggestionSignatureRef.current === signature) return;
    playlistSuggestionSignatureRef.current = signature;
    playlistSuggestionInFlightRef.current = true;
    const controller = new AbortController();
    playlistSuggestionAbortRef.current = controller;

    fetchInfiniteContinuation(playSource!, SMART_PLAYLIST_SUGGESTION_BATCH_SIZE, { signal: controller.signal })
      .then((tracks) => {
        if (controller.signal.aborted) return;
        if (!tracks.length) return;
        if (playlistSuggestionSignatureRef.current !== signature) return;
        const expectedSeedId = playSource?.radio?.seedId ?? null;
        setQueue((prev) => {
          if (playlistSuggestionSignatureRef.current !== signature) return prev;
          const latestSource = playSourceRef.current;
          const insertionIndex = currentIndexRef.current + 1;
          if (
            latestSource?.type !== "playlist" ||
            latestSource?.radio?.seedId !== expectedSeedId ||
            insertionIndex <= 0 ||
            insertionIndex > prev.length
          ) {
            return prev;
          }

          const existingKeys = new Set(
            [...prev, ...recentlyPlayedRef.current].map((track) => getTrackCacheKey(track)),
          );
          const suggestion = tracks.find((track) => {
            const key = getTrackCacheKey(track);
            if (!key || existingKeys.has(key)) return false;
            return true;
          });
          if (!suggestion) return prev;
          if (prev[insertionIndex]?.isSuggested) return prev;

          const nextQueue = [...prev];
          nextQueue.splice(insertionIndex, 0, {
            ...suggestion,
            isSuggested: true,
            suggestionSource: "playlist",
          });
          return nextQueue;
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("[player] playlist suggestion failed:", error);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          playlistSuggestionInFlightRef.current = false;
        }
        if (playlistSuggestionAbortRef.current === controller) {
          playlistSuggestionAbortRef.current = null;
        }
      });

    return () => {
      controller.abort();
      if (playlistSuggestionAbortRef.current === controller) {
        playlistSuggestionAbortRef.current = null;
      }
      playlistSuggestionInFlightRef.current = false;
    };
  }, [
    currentIndex,
    playSource,
    queue,
    setQueue,
    shuffle,
    smartPlaylistSuggestionsCadence,
    smartPlaylistSuggestionsEnabled,
  ]);

  const continueInfinitePlayback = useCallback(() => {
    if (
      !infinitePlaybackEnabled ||
      shuffle ||
      (playSource?.type !== "album" && playSource?.type !== "playlist") ||
      !playSource?.radio?.seedId
    ) {
      return false;
    }
    if (continuationInFlightRef.current) {
      return false;
    }

    const sessionSignature = getPlaySourceSignature(playSource);
    const requestSignature = [sessionSignature, currentIndexRef.current, queueRef.current.length, "manual"].join("::");

    shouldAutoplayRef.current = false;
    setIsPlaying(false);
    setIsBuffering(true);
    continuationSignatureRef.current = requestSignature;
    continuationInFlightRef.current = true;
    continuationManualAbortRef.current?.abort();
    const controller = new AbortController();
    continuationManualAbortRef.current = controller;

    fetchInfiniteContinuation(playSource, RADIO_REFILL_BATCH_SIZE, { signal: controller.signal })
      .then((tracks) => {
        if (controller.signal.aborted) return;
        if (continuationSignatureRef.current !== requestSignature) {
          setIsBuffering(false);
          shouldAutoplayRef.current = false;
          return;
        }
        if (getPlaySourceSignature(playSourceRef.current) !== sessionSignature) {
          setIsBuffering(false);
          shouldAutoplayRef.current = false;
          return;
        }
        if (!tracks.length) {
          setIsBuffering(false);
          shouldAutoplayRef.current = false;
          return;
        }

        const uniqueTracks = collectUniqueTracks(tracks, queueRef.current, recentlyPlayedRef.current);
        if (uniqueTracks.length === 0) {
          setIsBuffering(false);
          shouldAutoplayRef.current = false;
          return;
        }

        setQueue((prev) => {
          if (continuationSignatureRef.current !== requestSignature) return prev;
          if (getPlaySourceSignature(playSourceRef.current) !== sessionSignature) return prev;
          const stillUnique = collectUniqueTracks(uniqueTracks, prev, recentlyPlayedRef.current);
          return stillUnique.length > 0 ? [...prev, ...stillUnique] : prev;
        });

        shouldAutoplayRef.current = true;
        setCurrentIndex((index) => {
          if (continuationSignatureRef.current !== requestSignature) return index;
          if (getPlaySourceSignature(playSourceRef.current) !== sessionSignature) return index;
          return index + 1;
        });
        setCurrentTime(0);
        setDuration(0);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("[player] continuation after end failed:", error);
        if (continuationSignatureRef.current === requestSignature) {
          setIsBuffering(false);
          shouldAutoplayRef.current = false;
        }
      })
      .finally(() => {
        if (continuationManualAbortRef.current === controller) {
          continuationManualAbortRef.current = null;
        }
        if (!controller.signal.aborted) {
          continuationInFlightRef.current = false;
        }
        if (continuationSignatureRef.current === requestSignature) {
          continuationSignatureRef.current = null;
        }
      });

    return true;
  }, [
    infinitePlaybackEnabled,
    playSource,
    setCurrentIndex,
    setCurrentTime,
    setDuration,
    setIsBuffering,
    setIsPlaying,
    setQueue,
    shuffle,
    shouldAutoplayRef,
  ]);

  return {
    continueInfinitePlayback,
    resetPlaybackIntelligence,
  };
}
