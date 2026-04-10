import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import {
  getPredictableNextTrack,
  getSharedAudio,
  getStoredQueue,
  getStoredRecentlyPlayed,
  getStoredVolume,
  getStreamUrl,
  getTrackCacheKey,
  isContinuousAlbumTransition,
  MAX_RECENT,
  NEXT_TRACK_PRELOAD_WINDOW_SECONDS,
  PLAYER_AUDIO_KEY,
  PLAYER_PRELOAD_AUDIO_KEY,
  saveQueue,
  saveRecentlyPlayed,
  STORAGE_KEY,
} from "@/contexts/player-utils";
import { usePlayEventTracker } from "@/contexts/use-play-event-tracker";
import { usePlaybackIntelligence } from "@/contexts/use-playback-intelligence";
import { usePlayerShortcuts } from "@/contexts/use-player-shortcuts";
import { useMediaSession } from "@/contexts/use-media-session";
import {
  getCrossfadeDurationPreference,
  getInfinitePlaybackPreference,
  getSmartPlaylistSuggestionsCadencePreference,
  getSmartPlaylistSuggestionsPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
} from "@/lib/player-playback-prefs";
export type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";

interface PlayerStateValue {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
}

interface PlayerActionsValue {
  queue: Track[];
  currentIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  playSource: PlaySource | null;
  recentlyPlayed: Track[];
  currentTrack: Track | undefined;
  audioElement: HTMLAudioElement | null;
  play: (track: Track, source?: PlaySource) => void;
  playAll: (tracks: Track[], startIndex?: number, source?: PlaySource) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  clearQueue: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  jumpTo: (index: number) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
}

type PlayerContextValue = PlayerStateValue & PlayerActionsValue;

const PlayerStateContext = createContext<PlayerStateValue | null>(null);
const PlayerActionsContext = createContext<PlayerActionsValue | null>(null);

export function usePlayerState(): PlayerStateValue {
  const ctx = useContext(PlayerStateContext);
  if (!ctx) throw new Error("usePlayerState must be used within PlayerProvider");
  return ctx;
}

export function usePlayerActions(): PlayerActionsValue {
  const ctx = useContext(PlayerActionsContext);
  if (!ctx) throw new Error("usePlayerActions must be used within PlayerProvider");
  return ctx;
}

export function usePlayer(): PlayerContextValue {
  const state = usePlayerState();
  const actions = usePlayerActions();
  return { ...state, ...actions };
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadAudioRef = useRef<HTMLAudioElement | null>(null);
  const preloadedTrackKeyRef = useRef<string | null>(null);
  const preloadedTrackReadyRef = useRef(false);
  const stored = useRef(getStoredQueue());
  const [queue, setQueue] = useState<Track[]>(stored.current.queue);
  const [currentIndex, setCurrentIndex] = useState(stored.current.currentIndex);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(getStoredVolume);
  const [shuffle, setShuffle] = useState(false);
  const [playSource, setPlaySource] = useState<PlaySource | null>(null);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>(getStoredRecentlyPlayed);
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(getCrossfadeDurationPreference);
  const [infinitePlaybackEnabled, setInfinitePlaybackEnabled] = useState(getInfinitePlaybackPreference);
  const [smartPlaylistSuggestionsEnabled, setSmartPlaylistSuggestionsEnabled] = useState(
    getSmartPlaylistSuggestionsPreference,
  );
  const [smartPlaylistSuggestionsCadence, setSmartPlaylistSuggestionsCadence] = useState(
    getSmartPlaylistSuggestionsCadencePreference,
  );
  const restoredRef = useRef(stored.current.queue.length > 0);
  const shouldAutoplayRef = useRef(false);
  const lastNonZeroVolumeRef = useRef(Math.max(getStoredVolume(), 0.5));

  if (!audioRef.current) {
    audioRef.current = getSharedAudio(PLAYER_AUDIO_KEY);
    audioRef.current.volume = getStoredVolume();
  }
  if (!preloadAudioRef.current) {
    preloadAudioRef.current = getSharedAudio(PLAYER_PRELOAD_AUDIO_KEY);
    preloadAudioRef.current.volume = getStoredVolume();
    preloadAudioRef.current.preload = "auto";
  }
  const audio = audioRef.current;
  const currentTrack = queue[currentIndex];
  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  const currentTrackRef = useRef(currentTrack);
  const repeatRef = useRef(repeat);
  const shuffleRef = useRef(shuffle);
  const playSourceRef = useRef(playSource);
  const crossfadeSecondsRef = useRef(crossfadeSeconds);

  useEffect(() => {
    queueRef.current = queue;
    currentIndexRef.current = currentIndex;
    currentTrackRef.current = currentTrack;
    repeatRef.current = repeat;
    shuffleRef.current = shuffle;
    playSourceRef.current = playSource;
    crossfadeSecondsRef.current = crossfadeSeconds;
  }, [crossfadeSeconds, currentIndex, currentTrack, playSource, queue, repeat, shuffle]);

  useEffect(() => {
    saveQueue(queue, currentIndex);
  }, [queue, currentIndex]);

  // Persist currentTime every 5s so reload can restore position
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = audioRef.current?.currentTime;
      if (t != null && t > 0) saveQueue(queue, currentIndex, t);
    }, 5000);
    return () => window.clearInterval(id);
  }, [queue, currentIndex]);

  const addToRecentlyPlayed = useCallback((track: Track) => {
    setRecentlyPlayed((prev) => {
      const filtered = prev.filter((t) => t.id !== track.id);
      const updated = [track, ...filtered].slice(0, MAX_RECENT);
      saveRecentlyPlayed(updated);
      return updated;
    });
  }, []);

  const clearPreloadedTrack = useCallback(() => {
    const preloadAudio = preloadAudioRef.current;
    if (!preloadAudio) return;

    preloadAudio.pause();
    if (preloadAudio.src) {
      preloadAudio.removeAttribute("src");
      preloadAudio.load();
    }
    preloadedTrackKeyRef.current = null;
    preloadedTrackReadyRef.current = false;
  }, []);

  const preloadTrack = useCallback((track: Track) => {
    const preloadAudio = preloadAudioRef.current;
    if (!preloadAudio) return;

    const trackKey = getTrackCacheKey(track);
    if (preloadedTrackKeyRef.current === trackKey) return;

    preloadAudio.pause();
    preloadAudio.src = getStreamUrl(track);
    preloadAudio.preload = "auto";
    preloadAudio.load();
    preloadedTrackKeyRef.current = trackKey;
    preloadedTrackReadyRef.current = false;
  }, []);

  const consumePreloadedSource = useCallback((track: Track): string | null => {
    const preloadAudio = preloadAudioRef.current;
    const trackKey = getTrackCacheKey(track);
    if (!preloadAudio) return null;
    if (preloadedTrackKeyRef.current !== trackKey) return null;
    if (!preloadedTrackReadyRef.current) return null;
    return preloadAudio.currentSrc || preloadAudio.src || null;
  }, []);

  const {
    flushCurrentPlayEvent,
    markSeekPosition,
    recordProgress,
  } = usePlayEventTracker(audio, currentTrack, playSource);

  const {
    continueInfinitePlayback,
    resetPlaybackIntelligence,
  } = usePlaybackIntelligence({
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
  });

  useEffect(() => {
    const track = currentTrack;
    if (!track) return;
    const preloadedSrc = consumePreloadedSource(track);
    const streamUrl = preloadedSrc || getStreamUrl(track);

    if (restoredRef.current) {
      restoredRef.current = false;
      audio.src = streamUrl;
      const savedTime = stored.current.currentTime;
      if (savedTime > 0) {
        const onLoaded = () => {
          audio.currentTime = savedTime;
          setCurrentTime(savedTime);
          audio.removeEventListener("loadedmetadata", onLoaded);
        };
        audio.addEventListener("loadedmetadata", onLoaded);
      }
      return;
    }

    if (shouldAutoplayRef.current) {
      shouldAutoplayRef.current = false;
      audio.src = streamUrl;
      setCurrentTime(0);
      setDuration(0);
      setIsBuffering(false);
      audio.play().catch((e) => console.warn("[player] autoplay failed:", e));
      setIsPlaying(true);
      addToRecentlyPlayed(track);
      clearPreloadedTrack();
    }
  }, [addToRecentlyPlayed, audio, clearPreloadedTrack, consumePreloadedSource, currentTrack]);

  useEffect(() => {
    clearPreloadedTrack();
  }, [clearPreloadedTrack, queue, repeat, shuffle]);

  useEffect(() => {
    const nextTrack = getPredictableNextTrack(queue, currentIndex, repeat, shuffle);
    if (!nextTrack || !isPlaying) {
      clearPreloadedTrack();
      return;
    }

    const nextTrackKey = getTrackCacheKey(nextTrack);
    const transitionWindowSeconds = Math.max(
      NEXT_TRACK_PRELOAD_WINDOW_SECONDS,
      crossfadeSeconds > 0 ? crossfadeSeconds + 3 : NEXT_TRACK_PRELOAD_WINDOW_SECONDS,
    );
    const maybePreloadNextTrack = () => {
      const totalDuration =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : duration;

      if (!totalDuration || !Number.isFinite(totalDuration)) return;

      const remaining = totalDuration - audio.currentTime;
      if (
        remaining <= transitionWindowSeconds &&
        preloadedTrackKeyRef.current !== nextTrackKey
      ) {
        preloadTrack(nextTrack);
      }
    };

    maybePreloadNextTrack();
    audio.addEventListener("timeupdate", maybePreloadNextTrack);
    return () => {
      audio.removeEventListener("timeupdate", maybePreloadNextTrack);
    };
  }, [audio, clearPreloadedTrack, crossfadeSeconds, currentIndex, duration, isPlaying, preloadTrack, queue, repeat, shuffle]);

  useEffect(() => {
    const preloadAudio = preloadAudioRef.current;
    if (!preloadAudio) return;

    const markReady = () => {
      preloadedTrackReadyRef.current = true;
    };
    const markNotReady = () => {
      preloadedTrackReadyRef.current = false;
    };

    preloadAudio.addEventListener("loadeddata", markReady);
    preloadAudio.addEventListener("canplay", markReady);
    preloadAudio.addEventListener("canplaythrough", markReady);
    preloadAudio.addEventListener("loadstart", markNotReady);
    preloadAudio.addEventListener("emptied", markNotReady);
    preloadAudio.addEventListener("error", markNotReady);

    return () => {
      preloadAudio.removeEventListener("loadeddata", markReady);
      preloadAudio.removeEventListener("canplay", markReady);
      preloadAudio.removeEventListener("canplaythrough", markReady);
      preloadAudio.removeEventListener("loadstart", markNotReady);
      preloadAudio.removeEventListener("emptied", markNotReady);
      preloadAudio.removeEventListener("error", markNotReady);
    };
  }, []);

  useEffect(() => {
    const onPrefsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{
        crossfadeSeconds?: number;
        infinitePlaybackEnabled?: boolean;
        smartPlaylistSuggestionsEnabled?: boolean;
        smartPlaylistSuggestionsCadence?: number;
      }>).detail;
      if (typeof detail?.crossfadeSeconds === "number") {
        setCrossfadeSeconds(detail.crossfadeSeconds);
      } else {
        setCrossfadeSeconds(getCrossfadeDurationPreference());
      }
      if (typeof detail?.infinitePlaybackEnabled === "boolean") {
        setInfinitePlaybackEnabled(detail.infinitePlaybackEnabled);
      } else {
        setInfinitePlaybackEnabled(getInfinitePlaybackPreference());
      }
      if (typeof detail?.smartPlaylistSuggestionsEnabled === "boolean") {
        setSmartPlaylistSuggestionsEnabled(detail.smartPlaylistSuggestionsEnabled);
      } else {
        setSmartPlaylistSuggestionsEnabled(getSmartPlaylistSuggestionsPreference());
      }
      if (typeof detail?.smartPlaylistSuggestionsCadence === "number") {
        setSmartPlaylistSuggestionsCadence(detail.smartPlaylistSuggestionsCadence);
      } else {
        setSmartPlaylistSuggestionsCadence(getSmartPlaylistSuggestionsCadencePreference());
      }
    };

    window.addEventListener(PLAYER_PLAYBACK_PREFS_EVENT, onPrefsChanged as EventListener);
    return () => {
      window.removeEventListener(PLAYER_PLAYBACK_PREFS_EVENT, onPrefsChanged as EventListener);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearPreloadedTrack();
    };
  }, [audio, clearPreloadedTrack]);

  useEffect(() => {
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      recordProgress(audio.currentTime);
    };
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      import("@/lib/sleep-timer").then((m) => m.onTrackEnded());
      const endedTrack = currentTrackRef.current;
      if (endedTrack) {
        flushCurrentPlayEvent("completed");
        fetch("/api/navidrome/scrobble", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            navidrome_id: endedTrack.navidromeId || (endedTrack.id.includes("/") ? "" : endedTrack.id),
            title: endedTrack.title,
            artist: endedTrack.artist,
          }),
        }).catch(() => {});

        fetch("/api/me/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            track_id: endedTrack.libraryTrackId ?? null,
            track_path: endedTrack.path || endedTrack.id,
            title: endedTrack.title,
            artist: endedTrack.artist,
            album: endedTrack.album || "",
          }),
        }).catch(() => {});
      }

      const liveQueue = queueRef.current;
      const liveCurrentIndex = currentIndexRef.current;
      const liveRepeat = repeatRef.current;
      const liveShuffle = shuffleRef.current;
      const livePlaySource = playSourceRef.current;
      const nextTrack = getPredictableNextTrack(liveQueue, liveCurrentIndex, liveRepeat, liveShuffle);
      const continuousAlbum = isContinuousAlbumTransition(endedTrack, nextTrack, livePlaySource, liveShuffle);

      if (liveRepeat === "one") {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }

      shouldAutoplayRef.current = true;
      if (crossfadeSecondsRef.current > 0 && nextTrack && !continuousAlbum) {
        setIsBuffering(false);
      }
      if (liveShuffle) {
        if (liveQueue.length > 1) {
          let nextIdx: number;
          do {
            nextIdx = Math.floor(Math.random() * liveQueue.length);
          } while (nextIdx === liveCurrentIndex && liveQueue.length > 1);
          setCurrentIndex(nextIdx);
        } else {
          shouldAutoplayRef.current = false;
          setIsPlaying(false);
        }
        return;
      }

      if (liveCurrentIndex < liveQueue.length - 1) {
        setCurrentIndex((i) => i + 1);
      } else if (liveRepeat === "all") {
        setCurrentIndex(0);
      } else if (continueInfinitePlayback()) {
        return;
      } else {
        shouldAutoplayRef.current = false;
        setIsPlaying(false);
        setIsBuffering(false);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      setIsPlaying(false);
      setIsBuffering(false);
    };
    const onLoadStart = () => setIsBuffering(true);
    const onWaiting = () => setIsBuffering(true);
    const onStalled = () => setIsBuffering(true);
    const onPlaying = () => {
      setIsPlaying(true);
      setIsBuffering(false);
    };
    const onCanPlay = () => setIsBuffering(false);
    const onSeeked = () => {
      setIsBuffering(false);
      markSeekPosition(audio.currentTime);
    };
    const onError = () => {
      console.error("[player] audio error:", audio.error?.code, audio.error?.message);
      setIsPlaying(false);
      setIsBuffering(false);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("error", onError);
    };
  }, [
    audio,
    continueInfinitePlayback,
    flushCurrentPlayEvent,
    markSeekPosition,
    recordProgress,
  ]);

  const play = useCallback((track: Track, source?: PlaySource) => {
    try {
      const w = window as unknown as Record<string, AudioContext>;
      if (!w.__crateAudioCtx) w.__crateAudioCtx = new AudioContext();
      if (w.__crateAudioCtx.state === "suspended") w.__crateAudioCtx.resume();
    } catch { /* ok */ }

    restoredRef.current = false;
    resetPlaybackIntelligence();
    flushCurrentPlayEvent("interrupted");
    clearPreloadedTrack();
    setQueue([track]);
    setCurrentIndex(0);
    setCurrentTime(0);
    setDuration(0);
    setIsBuffering(false);
    audio.src = getStreamUrl(track);
    audio.currentTime = 0;
    audio.play().catch((e) => console.warn("[player] play failed:", e));
    setIsPlaying(true);
    setPlaySource(source || { type: "track", name: track.title });
    addToRecentlyPlayed(track);
  }, [addToRecentlyPlayed, audio, clearPreloadedTrack, flushCurrentPlayEvent, resetPlaybackIntelligence]);

  const playAll = useCallback((tracks: Track[], startIndex = 0, source?: PlaySource) => {
    if (tracks.length === 0) return;
    const track = tracks[startIndex];
    if (!track) return;

    try {
      const w = window as unknown as Record<string, AudioContext>;
      if (!w.__crateAudioCtx) w.__crateAudioCtx = new AudioContext();
      if (w.__crateAudioCtx.state === "suspended") w.__crateAudioCtx.resume();
    } catch { /* ok */ }

    restoredRef.current = false;
    resetPlaybackIntelligence();
    flushCurrentPlayEvent("interrupted");
    clearPreloadedTrack();
    setQueue(tracks);
    setCurrentIndex(startIndex);
    setCurrentTime(0);
    setDuration(0);
    setIsBuffering(false);
    audio.src = getStreamUrl(track);
    audio.currentTime = 0;
    audio.play().catch((e) => console.warn("[player] playAll failed:", e));
    setIsPlaying(true);
    setPlaySource(source || (tracks.length > 1 ? { type: "queue", name: "Queue" } : { type: "track", name: track.title }));
    addToRecentlyPlayed(track);
  }, [addToRecentlyPlayed, audio, clearPreloadedTrack, flushCurrentPlayEvent, resetPlaybackIntelligence]);

  const pause = useCallback(() => {
    audio.pause();
  }, [audio]);

  const resume = useCallback(() => {
    try {
      const w = window as unknown as Record<string, AudioContext>;
      if (!w.__crateAudioCtx) w.__crateAudioCtx = new AudioContext();
      if (w.__crateAudioCtx.state === "suspended") w.__crateAudioCtx.resume();
    } catch { /* ok */ }

    setIsBuffering(true);
    audio.play().catch(() => {
      setIsBuffering(false);
    });
  }, [audio]);

  const next = useCallback(() => {
    shouldAutoplayRef.current = true;
    flushCurrentPlayEvent("skipped");
    clearPreloadedTrack();
    if (shuffle && queue.length > 1) {
      let nextIdx: number;
      do {
        nextIdx = Math.floor(Math.random() * queue.length);
      } while (nextIdx === currentIndex);
      setCurrentIndex(nextIdx);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    if (currentIndex < queue.length - 1) {
      setCurrentIndex((i) => i + 1);
      setCurrentTime(0);
      setDuration(0);
    } else if (repeat === "all") {
      setCurrentIndex(0);
      setCurrentTime(0);
      setDuration(0);
    } else if (!continueInfinitePlayback()) {
      shouldAutoplayRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
    }
  }, [clearPreloadedTrack, continueInfinitePlayback, currentIndex, flushCurrentPlayEvent, queue.length, repeat, shuffle]);

  const prev = useCallback(() => {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    if (currentIndex > 0) {
      shouldAutoplayRef.current = true;
      flushCurrentPlayEvent("skipped");
      clearPreloadedTrack();
      setCurrentIndex((i) => i - 1);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [audio, clearPreloadedTrack, currentIndex, flushCurrentPlayEvent]);

  const seek = useCallback((time: number) => {
    setIsBuffering(true);
    audio.currentTime = time;
    setCurrentTime(time);
    markSeekPosition(time);
  }, [audio, markSeekPosition]);

  const setVolume = useCallback((vol: number) => {
    audio.volume = vol;
    if (preloadAudioRef.current) {
      preloadAudioRef.current.volume = vol;
    }
    setVolumeState(vol);
    if (vol > 0) {
      lastNonZeroVolumeRef.current = vol;
    }
    try { localStorage.setItem("listen-player-volume", String(vol)); } catch { /* ignore */ }
  }, [audio]);

  const clearQueue = useCallback(() => {
    resetPlaybackIntelligence();
    flushCurrentPlayEvent("interrupted");
    clearPreloadedTrack();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setQueue([]);
    setCurrentIndex(0);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setIsBuffering(false);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, [audio, clearPreloadedTrack, flushCurrentPlayEvent, resetPlaybackIntelligence]);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => !s);
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => {
      if (r === "off") return "all";
      if (r === "all") return "one";
      return "off";
    });
  }, []);

  const jumpTo = useCallback((index: number) => {
    if (index >= 0 && index < queue.length) {
      restoredRef.current = false;
      flushCurrentPlayEvent("skipped");
      clearPreloadedTrack();
      shouldAutoplayRef.current = true;
      setCurrentIndex(index);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [clearPreloadedTrack, flushCurrentPlayEvent, queue.length]);

  const playNext = useCallback((track: Track) => {
    setQueue((prev) => {
      const nextQueue = [...prev];
      nextQueue.splice(currentIndex + 1, 0, track);
      return nextQueue;
    });
  }, [currentIndex]);

  const addToQueue = useCallback((track: Track) => {
    setQueue((prev) => [...prev, track]);
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    setQueue((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      return prev.filter((_, i) => i !== index);
    });
    if (index < currentIndex) {
      setCurrentIndex((i) => i - 1);
    } else if (index === currentIndex && index >= queue.length - 1) {
      setCurrentIndex((i) => Math.max(0, i - 1));
    }
  }, [currentIndex, queue.length]);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    setQueue((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length) return prev;
      const newQueue = [...prev];
      const moved = newQueue.splice(fromIndex, 1)[0]!;
      newQueue.splice(toIndex, 0, moved);
      return newQueue;
    });
    setCurrentIndex((prev) => {
      if (fromIndex === prev) return toIndex;
      if (fromIndex < prev && toIndex >= prev) return prev - 1;
      if (fromIndex > prev && toIndex <= prev) return prev + 1;
      return prev;
    });
  }, []);

  usePlayerShortcuts({
    hasCurrentTrack: !!currentTrack,
    isPlaying,
    audio,
    duration,
    volume,
    lastNonZeroVolume: lastNonZeroVolumeRef.current,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
  });

  useMediaSession({ currentTrack, isPlaying, currentTime, duration, pause, resume, next, prev, seek });

  const stateValue = useMemo<PlayerStateValue>(
    () => ({ currentTime, duration, isPlaying, isBuffering, volume }),
    [currentTime, duration, isPlaying, isBuffering, volume],
  );

  const actionsValue = useMemo<PlayerActionsValue>(
    () => ({
      queue,
      currentIndex,
      shuffle,
      playSource,
      repeat,
      recentlyPlayed,
      currentTrack,
      audioElement: audioRef.current,
      play,
      playAll,
      pause,
      resume,
      next,
      prev,
      seek,
      setVolume,
      clearQueue,
      toggleShuffle,
      cycleRepeat,
      jumpTo,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
    }),
    [
      queue, currentIndex, shuffle, repeat, playSource, recentlyPlayed, currentTrack,
      play, playAll, pause, resume, next, prev, seek, setVolume,
      clearQueue, toggleShuffle, cycleRepeat, jumpTo, playNext,
      addToQueue, removeFromQueue, reorderQueue,
    ],
  );

  return (
    <PlayerActionsContext.Provider value={actionsValue}>
      <PlayerStateContext.Provider value={stateValue}>
        {children}
      </PlayerStateContext.Provider>
    </PlayerActionsContext.Provider>
  );
}
