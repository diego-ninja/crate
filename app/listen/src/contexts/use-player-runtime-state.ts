import {
  useCallback,
  useRef,
  useState,
} from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import type { CrossfadeTransition } from "@/contexts/player-context";
import { clampIndex } from "@/contexts/player-queue-helpers";
import {
  getStreamUrl,
  getStoredQueue,
  getStoredRecentlyPlayed,
  getStoredVolume,
  getTrackCacheKey,
} from "@/contexts/player-utils";
import {
  initPlayer as initGaplessPlayer,
  type GaplessPlayerCallbacks,
} from "@/lib/gapless-player";
import {
  getCrossfadeDurationPreference,
  getInfinitePlaybackPreference,
  getSmartCrossfadePreference,
  getSmartPlaylistSuggestionsCadencePreference,
  getSmartPlaylistSuggestionsPreference,
} from "@/lib/player-playback-prefs";

export function usePlayerRuntimeState() {
  const stored = useRef(getStoredQueue());
  const [queue, setQueueState] = useState<Track[]>(stored.current.queue);
  const [currentIndex, setCurrentIndexState] = useState(
    clampIndex(stored.current.currentIndex, stored.current.queue.length),
  );
  const [isPlaying, setIsPlayingState] = useState(false);
  const [isBuffering, setIsBufferingState] = useState(false);
  const [currentTime, setCurrentTimeState] = useState(0);
  const [duration, setDurationState] = useState(0);
  const [volume, setVolumeState] = useState(getStoredVolume);
  const [analyserVersion, setAnalyserVersion] = useState(0);
  const [crossfadeTransition, setCrossfadeTransition] = useState<CrossfadeTransition | null>(null);
  const [shuffle, setShuffleState] = useState(() => stored.current.shuffle);
  const [playSource, setPlaySource] = useState<PlaySource | null>(null);
  const [repeat, setRepeatState] = useState<RepeatMode>("off");
  const [smartCrossfadeEnabled, setSmartCrossfadeEnabled] = useState(getSmartCrossfadePreference);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>(getStoredRecentlyPlayed);
  const [infinitePlaybackEnabled, setInfinitePlaybackEnabled] = useState(getInfinitePlaybackPreference);
  const [smartPlaylistSuggestionsEnabled, setSmartPlaylistSuggestionsEnabled] = useState(
    getSmartPlaylistSuggestionsPreference,
  );
  const [smartPlaylistSuggestionsCadence, setSmartPlaylistSuggestionsCadence] = useState(
    getSmartPlaylistSuggestionsCadencePreference,
  );

  const currentTrack = queue[currentIndex];

  const crossfadeTimerRef = useRef<number | null>(null);
  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  const currentTrackRef = useRef(currentTrack);
  const repeatRef = useRef(repeat);
  const shuffleRef = useRef(shuffle);
  const playSourceRef = useRef(playSource);
  const smartCrossfadeEnabledRef = useRef(smartCrossfadeEnabled);
  const effectiveCrossfadeMsRef = useRef(getCrossfadeDurationPreference() * 1000);
  const isPlayingRef = useRef(isPlaying);
  const isBufferingRef = useRef(isBuffering);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const bufferingIntentRef = useRef(false);
  const lastNonZeroVolumeRef = useRef(Math.max(getStoredVolume(), 0.5));
  const activatedTrackKeyRef = useRef<string | null>(null);
  const prevRestartTrackKeyRef = useRef<string | null>(null);
  const prevRestartedAtRef = useRef(0);
  const callbacksRef = useRef<GaplessPlayerCallbacks>({});
  const engineInitRef = useRef(false);

  if (!engineInitRef.current) {
    engineInitRef.current = true;
    initGaplessPlayer({
      onTimeUpdate: (ms, idx) => callbacksRef.current.onTimeUpdate?.(ms, idx),
      onDurationChange: (ms) => callbacksRef.current.onDurationChange?.(ms),
      onLoad: (path, full, ms) => callbacksRef.current.onLoad?.(path, full, ms),
      onPlayRequest: (path) => callbacksRef.current.onPlayRequest?.(path),
      onPlay: (path) => callbacksRef.current.onPlay?.(path),
      onPause: (path) => callbacksRef.current.onPause?.(path),
      onPrev: (from, to) => callbacksRef.current.onPrev?.(from, to),
      onNext: (from, to) => callbacksRef.current.onNext?.(from, to),
      onTrackFinished: (path) => callbacksRef.current.onTrackFinished?.(path),
      onAllFinished: () => callbacksRef.current.onAllFinished?.(),
      onError: (path, err) => callbacksRef.current.onError?.(path, err),
      onBuffering: (path) => callbacksRef.current.onBuffering?.(path),
      onAnalyserReady: (analyser) => callbacksRef.current.onAnalyserReady?.(analyser),
    });
  }

  const unshuffledQueueRef = useRef<Track[] | null>(stored.current.unshuffledQueue);
  const engineTrackMapRef = useRef<Map<string, Track[]>>(new Map());

  const resetEngineTrackMap = useCallback(() => {
    engineTrackMapRef.current = new Map();
  }, []);

  const commitQueue = useCallback((nextQueue: Track[]) => {
    queueRef.current = nextQueue;
    setQueueState(nextQueue);
  }, []);

  const buildEngineUrls = useCallback((tracks: Track[]): string[] => {
    const urls = tracks.map(getStreamUrl);

    const nextMap = new Map<string, Track[]>();
    tracks.forEach((track, index) => {
      const url = urls[index];
      if (!url) return;
      const bucket = nextMap.get(url);
      if (bucket) {
        bucket.push(track);
      } else {
        nextMap.set(url, [track]);
      }
    });
    engineTrackMapRef.current = nextMap;
    return urls;
  }, []);

  const registerEngineTrack = useCallback((track: Track): string => {
    const url = getStreamUrl(track);
    const bucket = engineTrackMapRef.current.get(url);
    if (bucket) {
      bucket.push(track);
    } else {
      engineTrackMapRef.current.set(url, [track]);
    }
    return url;
  }, []);

  const unregisterEngineTrack = useCallback((track: Track): void => {
    const url = getStreamUrl(track);
    const bucket = engineTrackMapRef.current.get(url);
    if (!bucket) return;
    const trackKey = getTrackCacheKey(track);
    const index = bucket.findIndex((candidate) => getTrackCacheKey(candidate) === trackKey);
    if (index < 0) return;
    bucket.splice(index, 1);
    if (bucket.length === 0) {
      engineTrackMapRef.current.delete(url);
    }
  }, []);

  const clearPrevRestartLatch = useCallback(() => {
    prevRestartTrackKeyRef.current = null;
    prevRestartedAtRef.current = 0;
  }, []);

  const commitCurrentIndex = useCallback((nextIndex: number) => {
    currentIndexRef.current = nextIndex;
    currentTrackRef.current = queueRef.current[nextIndex];
    setCurrentIndexState(nextIndex);
  }, []);

  const commitCurrentTime = useCallback((nextTime: number) => {
    currentTimeRef.current = nextTime;
    setCurrentTimeState(nextTime);
  }, []);

  const commitDuration = useCallback((nextDuration: number) => {
    durationRef.current = nextDuration;
    setDurationState(nextDuration);
  }, []);

  const commitIsPlaying = useCallback((nextIsPlaying: boolean) => {
    isPlayingRef.current = nextIsPlaying;
    setIsPlayingState(nextIsPlaying);
  }, []);

  const commitIsBuffering = useCallback((nextIsBuffering: boolean) => {
    isBufferingRef.current = nextIsBuffering;
    setIsBufferingState(nextIsBuffering);
  }, []);

  return {
    queue,
    currentIndex,
    currentTrack,
    isPlaying,
    isBuffering,
    currentTime,
    duration,
    volume,
    analyserVersion,
    crossfadeTransition,
    shuffle,
    playSource,
    repeat,
    smartCrossfadeEnabled,
    recentlyPlayed,
    infinitePlaybackEnabled,
    smartPlaylistSuggestionsEnabled,
    smartPlaylistSuggestionsCadence,
    setPlaySource,
    setRepeatState,
    setShuffleState,
    setVolumeState,
    setAnalyserVersion,
    setCrossfadeTransition,
    setSmartCrossfadeEnabled,
    setRecentlyPlayed,
    setInfinitePlaybackEnabled,
    setSmartPlaylistSuggestionsEnabled,
    setSmartPlaylistSuggestionsCadence,
    crossfadeTimerRef,
    queueRef,
    currentIndexRef,
    currentTrackRef,
    repeatRef,
    shuffleRef,
    playSourceRef,
    smartCrossfadeEnabledRef,
    effectiveCrossfadeMsRef,
    isPlayingRef,
    isBufferingRef,
    currentTimeRef,
    durationRef,
    bufferingIntentRef,
    lastNonZeroVolumeRef,
    activatedTrackKeyRef,
    prevRestartTrackKeyRef,
    prevRestartedAtRef,
    callbacksRef,
    unshuffledQueueRef,
    engineTrackMapRef,
    resetEngineTrackMap,
    commitQueue,
    buildEngineUrls,
    registerEngineTrack,
    unregisterEngineTrack,
    clearPrevRestartLatch,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsPlaying,
    commitIsBuffering,
  };
}
