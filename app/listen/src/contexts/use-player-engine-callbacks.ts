import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { PlaySource, Track } from "@/contexts/player-types";
import { getStreamUrl } from "@/contexts/player-utils";
import {
  getCurrentTrackDuration as gpGetCurrentTrackDuration,
  isCurrentTrackFullyBuffered,
  seekTo as gpSeekTo,
  type GaplessPlayerCallbacks,
} from "@/lib/gapless-player";
import { isOnline as isRuntimeOnline } from "@/lib/capacitor";

interface UsePlayerEngineCallbacksParams {
  callbacksRef: MutableRefObject<GaplessPlayerCallbacks>;
  crossfadeTimerRef: MutableRefObject<number | null>;
  currentIndexRef: MutableRefObject<number>;
  currentTrackRef: MutableRefObject<Track | undefined>;
  playSourceRef: MutableRefObject<PlaySource | null>;
  durationRef: MutableRefObject<number>;
  effectiveCrossfadeMsRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  bufferingIntentRef: MutableRefObject<boolean>;
  pendingRestoreTimeRef: MutableRefObject<number>;
  resumeAfterReloadRef: MutableRefObject<boolean>;
  engineTrackMapRef: MutableRefObject<Map<string, Track[]>>;
  queueRef: MutableRefObject<Track[]>;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  clearPrevRestartLatch: () => void;
  clearStallTimer: () => void;
  scheduleStallProtection: () => void;
  cancelRestoreAutoplay: () => void;
  tryRestoreAutoplay: () => void;
  cancelSoftInterruption: () => void;
  beginSoftInterruption: (reason: "offline" | "stream") => void;
  isSoftInterrupted: () => boolean;
  ensureTrackerSession: (track: Track | undefined, source: PlaySource | null) => void;
  startTrackerSession: (track: Track, source: PlaySource | null) => void;
  flushCurrentPlayEvent: (reason: "completed" | "skipped" | "interrupted", track?: Track) => void;
  markSeekPosition: (seconds: number) => void;
  recordProgress: (seconds: number) => void;
  pullFromEngine: (sourceQueue?: Track[]) => { resolvedTrack: Track | undefined };
  setAnalyserVersion: Dispatch<SetStateAction<number>>;
  setCrossfadeTransition: Dispatch<SetStateAction<{
    outgoing: Track;
    incoming: Track;
    durationMs: number;
    startedAt: number;
    outgoingDurationSeconds: number;
  } | null>>;
}

export function usePlayerEngineCallbacks({
  callbacksRef,
  crossfadeTimerRef,
  currentIndexRef,
  currentTrackRef,
  playSourceRef,
  durationRef,
  effectiveCrossfadeMsRef,
  isPlayingRef,
  bufferingIntentRef,
  pendingRestoreTimeRef,
  resumeAfterReloadRef,
  engineTrackMapRef,
  queueRef,
  commitCurrentTime,
  commitDuration,
  commitIsPlaying,
  commitIsBuffering,
  clearPrevRestartLatch,
  clearStallTimer,
  scheduleStallProtection,
  cancelRestoreAutoplay,
  tryRestoreAutoplay,
  cancelSoftInterruption,
  beginSoftInterruption,
  isSoftInterrupted,
  ensureTrackerSession,
  startTrackerSession,
  flushCurrentPlayEvent,
  markSeekPosition,
  recordProgress,
  pullFromEngine,
  setAnalyserVersion,
  setCrossfadeTransition,
}: UsePlayerEngineCallbacksParams) {
  callbacksRef.current = {
    onTimeUpdate: (positionMs, trackIndex) => {
      const positionSeconds = positionMs / 1000;
      clearStallTimer();
      commitCurrentTime(positionSeconds);
      recordProgress(positionSeconds);
      if (trackIndex !== currentIndexRef.current && trackIndex >= 0) {
        pullFromEngine();
      }
    },
    onDurationChange: (durationMs) => {
      commitDuration(Math.max(durationMs / 1000, 0));
    },
    onLoad: (_path, _fullyLoaded, durationMs) => {
      const durationSeconds = Math.max(durationMs / 1000, 0);
      if (durationSeconds > 0) {
        commitDuration(durationSeconds);
      }
      clearPrevRestartLatch();
      if (pendingRestoreTimeRef.current > 0) {
        gpSeekTo(pendingRestoreTimeRef.current * 1000);
        commitCurrentTime(pendingRestoreTimeRef.current);
        markSeekPosition(pendingRestoreTimeRef.current);
        pendingRestoreTimeRef.current = 0;
      }
      if (!isPlayingRef.current) {
        commitIsBuffering(false);
      }
      bufferingIntentRef.current = false;
      clearStallTimer();
      tryRestoreAutoplay();
    },
    onPlayRequest: () => {
      bufferingIntentRef.current = true;
    },
    onPlay: () => {
      resumeAfterReloadRef.current = false;
      cancelRestoreAutoplay();
      cancelSoftInterruption();
      commitIsPlaying(true);
      commitIsBuffering(false);
      bufferingIntentRef.current = false;
      ensureTrackerSession(currentTrackRef.current, playSourceRef.current);
    },
    onPause: () => {
      if (bufferingIntentRef.current && isPlayingRef.current) {
        commitIsBuffering(true);
        return;
      }
      if (isSoftInterrupted()) {
        commitIsPlaying(false);
        commitIsBuffering(true);
        return;
      }
      clearStallTimer();
      commitIsPlaying(false);
      commitIsBuffering(false);
      bufferingIntentRef.current = false;
    },
    onPrev: () => {
      clearPrevRestartLatch();
      commitCurrentTime(0);
      commitDuration(Math.max(gpGetCurrentTrackDuration() / 1000, 0));
      pullFromEngine();
      bufferingIntentRef.current = false;
      commitIsBuffering(false);
      clearStallTimer();
    },
    onNext: (fromPath, toPath) => {
      clearPrevRestartLatch();
      const outgoingDurationSeconds = durationRef.current;

      commitCurrentTime(0);
      commitDuration(Math.max(gpGetCurrentTrackDuration() / 1000, 0));
      pullFromEngine();

      const crossfadeMs = effectiveCrossfadeMsRef.current;
      if (crossfadeMs > 0) {
        const outgoing = engineTrackMapRef.current.get(fromPath)?.[0];
        const incoming = engineTrackMapRef.current.get(toPath)?.[0];
        if (outgoing && incoming) {
          if (crossfadeTimerRef.current != null) {
            window.clearTimeout(crossfadeTimerRef.current);
          }
          setCrossfadeTransition({
            outgoing,
            incoming,
            durationMs: crossfadeMs,
            startedAt: performance.now(),
            outgoingDurationSeconds,
          });
          crossfadeTimerRef.current = window.setTimeout(() => {
            setCrossfadeTransition(null);
            crossfadeTimerRef.current = null;
          }, crossfadeMs);
        }
      }
    },
    onTrackFinished: (path) => {
      const bucket = engineTrackMapRef.current.get(path);
      const endedTrack =
        bucket?.[0] ??
        queueRef.current.find((track) => getStreamUrl(track) === path);
      if (!endedTrack) return;

      flushCurrentPlayEvent("completed", endedTrack);

      const incoming = currentTrackRef.current;
      if (incoming) {
        startTrackerSession(incoming, playSourceRef.current);
      }
    },
    onAllFinished: () => {
      resumeAfterReloadRef.current = false;
      cancelRestoreAutoplay();
      cancelSoftInterruption();
      commitIsPlaying(false);
      commitIsBuffering(false);
      bufferingIntentRef.current = false;
    },
    onError: (path, err) => {
      const currentTrack = currentTrackRef.current;
      const currentPath = currentTrack ? getStreamUrl(currentTrack) : null;
      if (currentPath && path && path !== currentPath) {
        console.warn("[gapless] preload error ignored (non-current track):", path, err);
        return;
      }
      if (isCurrentTrackFullyBuffered()) {
        console.warn("[gapless] error ignored (current track fully buffered):", path, err);
        return;
      }
      console.error("[gapless] error:", err);
      cancelRestoreAutoplay();
      void isRuntimeOnline().then((online) => {
        beginSoftInterruption(online ? "stream" : "offline");
      });
    },
    onBuffering: () => {
      if (bufferingIntentRef.current || isPlayingRef.current) {
        commitIsBuffering(true);
      }
      scheduleStallProtection();
    },
    onAnalyserReady: () => {
      setAnalyserVersion((version) => version + 1);
    },
  };

  useEffect(() => () => {
    if (crossfadeTimerRef.current != null) {
      window.clearTimeout(crossfadeTimerRef.current);
      crossfadeTimerRef.current = null;
    }
  }, [crossfadeTimerRef]);
}
