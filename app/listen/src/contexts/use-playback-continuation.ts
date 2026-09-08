import { useCallback, useEffect, useRef } from "react";

import { fetchInfiniteContinuation } from "@/lib/radio";
import {
  collectUniqueTracks,
  getPlaySourceSignature,
  RADIO_REFILL_BATCH_SIZE,
  RADIO_REFILL_THRESHOLD,
  type PlaybackIntelligenceRefs,
} from "./playback-intelligence-model";
import type { PlaySource, Track } from "./player-types";

interface UsePlaybackContinuationOptions {
  currentIndex: number;
  infinitePlaybackEnabled: boolean;
  playSource: PlaySource | null;
  queue: Track[];
  refs: PlaybackIntelligenceRefs;
  shuffle: boolean;
}

export function usePlaybackContinuation({
  currentIndex,
  infinitePlaybackEnabled,
  playSource,
  queue,
  refs,
  shuffle,
}: UsePlaybackContinuationOptions) {
  const inFlightRef = useRef(false);
  const signatureRef = useRef<string | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const manualAbortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    prefetchAbortRef.current?.abort();
    manualAbortRef.current?.abort();
    prefetchAbortRef.current = null;
    manualAbortRef.current = null;
    inFlightRef.current = false;
    signatureRef.current = null;
  }, []);

  useEffect(() => {
    const currentTrack = queue[currentIndex];
    const continuationSource = playSource;
    const supportsContinuation =
      infinitePlaybackEnabled &&
      !shuffle &&
      !!currentTrack &&
      (continuationSource?.type === "album" ||
        continuationSource?.type === "playlist") &&
      !!continuationSource?.radio?.seedId;

    if (!supportsContinuation || !continuationSource) return;

    const remainingUpcoming = queue.length - currentIndex - 1;
    if (remainingUpcoming > RADIO_REFILL_THRESHOLD) {
      signatureRef.current = null;
      return;
    }
    if (inFlightRef.current) return;

    const sessionSignature = getPlaySourceSignature(continuationSource);
    const signature = [
      sessionSignature,
      currentTrack?.id ?? "",
      queue.length,
    ].join("::");
    if (signatureRef.current === signature) return;
    signatureRef.current = signature;
    inFlightRef.current = true;
    const controller = new AbortController();
    prefetchAbortRef.current = controller;

    fetchInfiniteContinuation(continuationSource, RADIO_REFILL_BATCH_SIZE, {
      signal: controller.signal,
    })
      .then((tracks) => {
        if (controller.signal.aborted || !tracks.length) return;
        if (signatureRef.current !== signature) return;
        if (
          getPlaySourceSignature(refs.playSourceRef.current) !==
          sessionSignature
        )
          return;
        refs.actionsRef.current.appendTracks(tracks);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("[player] continuation refill failed:", error);
      })
      .finally(() => {
        if (!controller.signal.aborted) inFlightRef.current = false;
        if (prefetchAbortRef.current === controller) {
          prefetchAbortRef.current = null;
        }
      });

    return () => {
      controller.abort();
      if (prefetchAbortRef.current === controller) {
        prefetchAbortRef.current = null;
      }
      inFlightRef.current = false;
    };
  }, [currentIndex, infinitePlaybackEnabled, playSource, queue, refs, shuffle]);

  const continueInfinitePlayback = useCallback(() => {
    if (
      !infinitePlaybackEnabled ||
      shuffle ||
      (playSource?.type !== "album" && playSource?.type !== "playlist") ||
      !playSource?.radio?.seedId
    ) {
      return false;
    }
    if (inFlightRef.current) return false;

    const sessionSignature = getPlaySourceSignature(playSource);
    const requestSignature = [
      sessionSignature,
      refs.currentIndexRef.current,
      refs.queueRef.current.length,
      "manual",
    ].join("::");

    refs.actionsRef.current.setBuffering(true);
    signatureRef.current = requestSignature;
    inFlightRef.current = true;
    manualAbortRef.current?.abort();
    const controller = new AbortController();
    manualAbortRef.current = controller;

    fetchInfiniteContinuation(playSource, RADIO_REFILL_BATCH_SIZE, {
      signal: controller.signal,
    })
      .then((tracks) => {
        if (controller.signal.aborted) return;
        if (signatureRef.current !== requestSignature) {
          refs.actionsRef.current.setBuffering(false);
          return;
        }
        if (
          getPlaySourceSignature(refs.playSourceRef.current) !==
          sessionSignature
        ) {
          refs.actionsRef.current.setBuffering(false);
          return;
        }
        if (!tracks.length) {
          refs.actionsRef.current.setBuffering(false);
          return;
        }

        const uniqueTracks = collectUniqueTracks(
          tracks,
          refs.queueRef.current,
          refs.recentlyPlayedRef.current,
        );
        if (uniqueTracks.length === 0) {
          refs.actionsRef.current.setBuffering(false);
          return;
        }

        refs.actionsRef.current.appendAndAdvance(uniqueTracks);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("[player] continuation after end failed:", error);
        if (signatureRef.current === requestSignature) {
          refs.actionsRef.current.setBuffering(false);
        }
      })
      .finally(() => {
        if (manualAbortRef.current === controller) {
          manualAbortRef.current = null;
        }
        if (!controller.signal.aborted) inFlightRef.current = false;
        if (signatureRef.current === requestSignature) {
          signatureRef.current = null;
        }
      });

    return true;
  }, [infinitePlaybackEnabled, playSource, refs, shuffle]);

  return { continueInfinitePlayback, reset };
}
