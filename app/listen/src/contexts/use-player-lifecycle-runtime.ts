import { useCallback, useEffect, useState } from "react";

import { AUTH_RUNTIME_RESET_EVENT } from "@/contexts/auth-runtime";
import type { Track } from "@/contexts/player-types";
import { PLAYBACK_NEEDS_USER_GESTURE_EVENT } from "@/contexts/use-soft-interruption";
import { destroyPlayer as gpDestroyPlayer } from "@/lib/gapless-player";

interface Ref<T> {
  current: T;
}

interface UsePlayerLifecycleRuntimeOptions {
  clearQueueRef: Ref<() => void>;
  clearTransferPlaybackGuard: () => void;
  currentTrack: Track | undefined;
  isPlaying: boolean;
  resume: () => void;
}

export interface PlayerLifecycleRuntime {
  playbackNeedsUserGesture: boolean;
  resumeAfterUserGesture: () => void;
}

export function usePlayerLifecycleRuntime({
  clearQueueRef,
  clearTransferPlaybackGuard,
  currentTrack,
  isPlaying,
  resume,
}: UsePlayerLifecycleRuntimeOptions): PlayerLifecycleRuntime {
  const [playbackNeedsUserGesture, setPlaybackNeedsUserGesture] =
    useState(false);

  const resumeAfterUserGesture = useCallback(() => {
    setPlaybackNeedsUserGesture(false);
    resume();
  }, [resume]);

  useEffect(() => {
    const handleAuthRuntimeReset = () => {
      clearQueueRef.current();
    };
    window.addEventListener(AUTH_RUNTIME_RESET_EVENT, handleAuthRuntimeReset);
    return () => {
      window.removeEventListener(
        AUTH_RUNTIME_RESET_EVENT,
        handleAuthRuntimeReset,
      );
    };
  }, [clearQueueRef]);

  useEffect(() => {
    const handleNeedsUserGesture = () => {
      setPlaybackNeedsUserGesture(true);
    };
    window.addEventListener(
      PLAYBACK_NEEDS_USER_GESTURE_EVENT,
      handleNeedsUserGesture,
    );
    return () => {
      window.removeEventListener(
        PLAYBACK_NEEDS_USER_GESTURE_EVENT,
        handleNeedsUserGesture,
      );
    };
  }, []);

  useEffect(() => {
    if (isPlaying || !currentTrack) {
      setPlaybackNeedsUserGesture(false);
    }
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    return () => {
      clearTransferPlaybackGuard();
      gpDestroyPlayer();
    };
  }, [clearTransferPlaybackGuard]);

  return { playbackNeedsUserGesture, resumeAfterUserGesture };
}
