import { useCallback, useEffect, useRef } from "react";

import { fetchRadioContinuation } from "@/lib/radio";
import {
  getPlaySourceSignature,
  RADIO_REFILL_BATCH_SIZE,
  RADIO_REFILL_THRESHOLD,
  type PlaybackIntelligenceRefs,
} from "./playback-intelligence-model";
import type { PlaySource, Track } from "./player-types";

interface UsePlaybackRadioRefillOptions {
  currentIndex: number;
  isPlaying: boolean;
  playSource: PlaySource | null;
  queue: Track[];
  refs: PlaybackIntelligenceRefs;
}

export function usePlaybackRadioRefill({
  currentIndex,
  isPlaying,
  playSource,
  queue,
  refs,
}: UsePlaybackRadioRefillOptions) {
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
    if (!isPlaying || !currentTrack) return;
    if (playSource?.type !== "radio" || !playSource.radio) return;

    const remainingUpcoming = queue.length - currentIndex - 1;
    if (remainingUpcoming > RADIO_REFILL_THRESHOLD) {
      signatureRef.current = null;
      return;
    }
    if (inFlightRef.current) return;

    const signature = [
      getPlaySourceSignature(playSource),
      currentTrack.id,
      queue.length,
    ].join("::");
    if (signatureRef.current === signature) return;
    signatureRef.current = signature;
    inFlightRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;

    fetchRadioContinuation(playSource, RADIO_REFILL_BATCH_SIZE, {
      signal: controller.signal,
    })
      .then((tracks) => {
        if (controller.signal.aborted) return;
        if (signatureRef.current !== signature) return;
        if (
          getPlaySourceSignature(refs.playSourceRef.current) !==
          getPlaySourceSignature(playSource)
        )
          return;
        refs.actionsRef.current.appendTracks(tracks);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("[player] radio refill failed:", error);
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
  }, [currentIndex, isPlaying, playSource, queue, refs]);

  return reset;
}
