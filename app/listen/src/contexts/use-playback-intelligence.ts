import { useCallback, useEffect, useRef } from "react";

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
    source.radio?.seedStorageId ?? "",
    source.radio?.seedPath ?? "",
    source.radio?.shapedSessionId ?? "",
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

/**
 * Actions the PlayerContext exposes to the intelligence hook. Verb-oriented
 * so the hook doesn't need to know about React setters — the context owns
 * state mutations and only exposes domain primitives.
 */
export interface PlaybackIntelligenceActions {
  /** Append tracks to the end of the queue, de-duplicated against queue + recent. */
  appendTracks: (tracks: Track[]) => void;
  /**
   * Insert a suggestion (marked isSuggested) right after the current index.
   * No-op if the slot is already a suggestion or duplicate.
   */
  insertSuggestionAfterCurrent: (candidates: Track[]) => void;
  /**
   * Append tracks AND advance cursor to the first appended one (playback
   * continues into newly fetched tracks). Used when the user hits next
   * at the end of an infinite-playback album/playlist.
   */
  appendAndAdvance: (tracks: Track[]) => void;
  /** Show the buffering spinner without committing a new track. */
  setBuffering: (buffering: boolean) => void;
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
  actions: PlaybackIntelligenceActions;
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
  actions,
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
  // Keep a stable reference to actions so effects don't re-run when the
  // context re-memoizes them. We only ever call via `.current`.
  const actionsRef = useRef(actions);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
    playSourceRef.current = playSource;
    queueRef.current = queue;
    recentlyPlayedRef.current = recentlyPlayed;
    actionsRef.current = actions;
  }, [actions, currentIndex, playSource, queue, recentlyPlayed]);

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
  }, []);

  // ── Radio refill: when a radio session has ≤3 tracks left, fetch more.
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
        actionsRef.current.appendTracks(tracks);
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
  }, [currentIndex, isPlaying, playSource, queue, queue.length]);

  // ── Infinite playback prefetch: when an album/playlist is near its end
  // and infinite mode is on, prefetch continuation tracks.
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
        actionsRef.current.appendTracks(tracks);
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
  }, [currentIndex, infinitePlaybackEnabled, playSource, queue, queue.length, shuffle]);

  // ── Smart playlist suggestions: inject one tasteful recommendation
  // every N original tracks played in a playlist session.
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
    const expectedSeedId = playSource?.radio?.seedId ?? null;

    fetchInfiniteContinuation(playSource!, SMART_PLAYLIST_SUGGESTION_BATCH_SIZE, { signal: controller.signal })
      .then((tracks) => {
        if (controller.signal.aborted) return;
        if (!tracks.length) return;
        if (playlistSuggestionSignatureRef.current !== signature) return;
        const latestSource = playSourceRef.current;
        if (latestSource?.type !== "playlist" || latestSource?.radio?.seedId !== expectedSeedId) return;

        actionsRef.current.insertSuggestionAfterCurrent(tracks);
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
    shuffle,
    smartPlaylistSuggestionsCadence,
    smartPlaylistSuggestionsEnabled,
  ]);

  /**
   * Called when the user hits next at the end of an infinite-playback
   * album/playlist. Kicks off a continuation fetch and advances cursor
   * once tracks are appended. Returns true if the request was dispatched,
   * false if the current session doesn't support infinite continuation.
   */
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

    actionsRef.current.setBuffering(true);
    continuationSignatureRef.current = requestSignature;
    continuationInFlightRef.current = true;
    continuationManualAbortRef.current?.abort();
    const controller = new AbortController();
    continuationManualAbortRef.current = controller;

    fetchInfiniteContinuation(playSource, RADIO_REFILL_BATCH_SIZE, { signal: controller.signal })
      .then((tracks) => {
        if (controller.signal.aborted) return;
        if (continuationSignatureRef.current !== requestSignature) {
          actionsRef.current.setBuffering(false);
          return;
        }
        if (getPlaySourceSignature(playSourceRef.current) !== sessionSignature) {
          actionsRef.current.setBuffering(false);
          return;
        }
        if (!tracks.length) {
          actionsRef.current.setBuffering(false);
          return;
        }

        const uniqueTracks = collectUniqueTracks(tracks, queueRef.current, recentlyPlayedRef.current);
        if (uniqueTracks.length === 0) {
          actionsRef.current.setBuffering(false);
          return;
        }

        actionsRef.current.appendAndAdvance(uniqueTracks);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("[player] continuation after end failed:", error);
        if (continuationSignatureRef.current === requestSignature) {
          actionsRef.current.setBuffering(false);
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
  }, [infinitePlaybackEnabled, playSource, shuffle]);

  return {
    continueInfinitePlayback,
    resetPlaybackIntelligence,
  };
}
