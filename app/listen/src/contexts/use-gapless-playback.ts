/**
 * Hook that wraps Gapless-5 for use in PlayerContext.
 *
 * Manages the audio player lifecycle, maps Gapless-5 callbacks to
 * React state updates, and exposes an API that PlayerContext can use
 * directly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  initPlayer,
  destroyPlayer,
  loadQueue as gpLoadQueue,
  play as gpPlay,
  pause as gpPause,
  next as gpNext,
  prev as gpPrev,
  seekTo as gpSeekTo,
  setVolume as gpSetVolume,
  setShuffle as gpSetShuffle,
  updateCrossfade,
  setLoop as gpSetLoop,
  getAnalyserNode,
  type GaplessPlayerCallbacks,
} from "@/lib/gapless-player";
import { getStoredVolume } from "@/contexts/player-utils";

interface GaplessPlaybackState {
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
}

interface GaplessPlaybackActions {
  playTrack: (url: string) => void;
  playQueue: (urls: string[], startIndex: number) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (timeSeconds: number) => void;
  setVolume: (vol: number) => void;
  setShuffle: (enabled: boolean) => void;
  setRepeatAll: (enabled: boolean) => void;
  updateCrossfade: () => void;
  getAnalyser: () => AnalyserNode | null;
}

export function useGaplessPlayback(
  callbacks: {
    onTrackFinished?: (trackUrl: string) => void;
    onAllFinished?: () => void;
    onNext?: (fromUrl: string, toUrl: string) => void;
    onError?: (trackUrl: string, error: unknown) => void;
    onPlay?: (trackUrl: string) => void;
    onPause?: (trackUrl: string) => void;
  },
): GaplessPlaybackState & GaplessPlaybackActions {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Initialize Gapless-5 on mount
  useEffect(() => {
    const gpCallbacks: GaplessPlayerCallbacks = {
      onTimeUpdate: (posMs) => {
        setCurrentTime(posMs / 1000);
        // Estimate duration from the Gapless-5 internal track
        // (ontimeupdate doesn't provide duration directly)
      },
      onPlay: (path) => {
        setIsPlaying(true);
        setIsBuffering(false);
        callbacksRef.current.onPlay?.(path);
      },
      onPause: (path) => {
        setIsPlaying(false);
        setIsBuffering(false);
        callbacksRef.current.onPause?.(path);
      },
      onTrackFinished: (path) => {
        callbacksRef.current.onTrackFinished?.(path);
      },
      onAllFinished: () => {
        setIsPlaying(false);
        callbacksRef.current.onAllFinished?.();
      },
      onNext: (from, to) => {
        setCurrentTime(0);
        setDuration(0);
        callbacksRef.current.onNext?.(from, to);
      },
      onError: (path, err) => {
        setIsBuffering(false);
        callbacksRef.current.onError?.(path, err);
      },
      onBuffering: () => {
        setIsBuffering(true);
      },
      onAnalyserReady: (analyser) => {
        analyserRef.current = analyser;
      },
    };

    initPlayer(gpCallbacks);
    gpSetVolume(getStoredVolume());

    return () => {
      destroyPlayer();
    };
  }, []);

  const playTrack = useCallback((url: string) => {
    gpLoadQueue([url], 0);
    gpPlay();
    setCurrentTime(0);
    setDuration(0);
    setIsBuffering(true);
  }, []);

  const playQueue = useCallback((urls: string[], startIndex: number) => {
    gpLoadQueue(urls, startIndex);
    gpPlay();
    setCurrentTime(0);
    setDuration(0);
    setIsBuffering(true);
  }, []);

  const pause = useCallback(() => {
    gpPause();
  }, []);

  const resume = useCallback(() => {
    gpPlay();
  }, []);

  const next = useCallback(() => {
    gpNext();
  }, []);

  const prev = useCallback(() => {
    gpPrev();
  }, []);

  const seek = useCallback((timeSeconds: number) => {
    gpSeekTo(timeSeconds * 1000);
    setCurrentTime(timeSeconds);
  }, []);

  const setVolume = useCallback((vol: number) => {
    gpSetVolume(vol);
  }, []);

  const setShuffle = useCallback((enabled: boolean) => {
    gpSetShuffle(enabled);
  }, []);

  const setRepeatAll = useCallback((enabled: boolean) => {
    gpSetLoop(enabled);
  }, []);

  const getAnalyser = useCallback(() => {
    return analyserRef.current || getAnalyserNode();
  }, []);

  return {
    isPlaying,
    isBuffering,
    currentTime,
    duration,
    playTrack,
    playQueue,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
    setShuffle,
    setRepeatAll,
    updateCrossfade,
    getAnalyser,
  };
}
