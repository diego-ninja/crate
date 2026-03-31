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
import {
  getCrossfadeDurationPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
} from "@/lib/player-playback-prefs";
import { fetchRadioContinuation } from "@/lib/radio";

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumCover?: string;
  path?: string;
  navidromeId?: string;
  libraryTrackId?: number;
}

type RepeatMode = "off" | "one" | "all";
type RadioSeedType = "track" | "album" | "artist" | "playlist";

interface RadioSession {
  seedType: RadioSeedType;
  seedId?: string | number | null;
  seedPath?: string | null;
}

export interface PlaySource {
  type: "album" | "playlist" | "radio" | "track" | "queue";
  name: string;
  radio?: RadioSession;
}

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

const STORAGE_KEY = "listen-player-state";
const RECENTLY_PLAYED_KEY = "listen-recently-played";
const MAX_RECENT = 10;
const NEXT_TRACK_PRELOAD_WINDOW_SECONDS = 15;
const RADIO_REFILL_THRESHOLD = 3;
const RADIO_REFILL_BATCH_SIZE = 30;
const PLAYER_AUDIO_KEY = "__listenPlayerAudio";
const PLAYER_PRELOAD_AUDIO_KEY = "__listenPlayerPreloadAudio";

function getStoredVolume(): number {
  try {
    const v = localStorage.getItem("listen-player-volume");
    if (v !== null) return parseFloat(v);
  } catch { /* ignore */ }
  return 0.8;
}

function getStoredQueue(): { queue: Track[]; currentIndex: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.queue) && parsed.queue.length > 0) {
        return { queue: parsed.queue, currentIndex: parsed.currentIndex ?? 0 };
      }
    }
  } catch { /* ignore */ }
  return { queue: [], currentIndex: 0 };
}

function saveQueue(queue: Track[], currentIndex: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ queue, currentIndex }));
  } catch { /* ignore */ }
}

function getStoredRecentlyPlayed(): Track[] {
  try {
    const raw = localStorage.getItem(RECENTLY_PLAYED_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveRecentlyPlayed(tracks: Track[]) {
  try {
    localStorage.setItem(RECENTLY_PLAYED_KEY, JSON.stringify(tracks));
  } catch { /* ignore */ }
}

function getSharedAudio(key: string): HTMLAudioElement {
  const w = window as unknown as Record<string, HTMLAudioElement | undefined>;
  if (!w[key]) {
    w[key] = new Audio();
  }
  return w[key]!;
}

function getStreamUrl(track: Track): string {
  if (track.navidromeId) {
    return `/api/navidrome/stream/${track.navidromeId}`;
  }

  const playbackPath = track.path || track.id;
  if (playbackPath.includes("/")) {
    return `/api/stream/${encodeURIComponent(playbackPath).replace(/%2F/g, "/")}`;
  }

  return `/api/navidrome/stream/${track.id}`;
}

function getTrackCacheKey(track: Track): string {
  return [track.libraryTrackId ?? "", track.navidromeId ?? "", track.path ?? "", track.id].join("::");
}

function getPredictableNextTrack(
  queue: Track[],
  currentIndex: number,
  repeat: RepeatMode,
  shuffle: boolean,
): Track | null {
  if (shuffle || repeat === "one" || queue.length < 2) return null;
  if (currentIndex < 0 || currentIndex >= queue.length) return null;

  if (currentIndex < queue.length - 1) {
    return queue[currentIndex + 1] ?? null;
  }

  if (repeat === "all") {
    return queue[0] ?? null;
  }

  return null;
}

function isContinuousAlbumTransition(
  currentTrack: Track | undefined,
  nextTrack: Track | null,
  playSource: PlaySource | null,
  shuffle: boolean,
): boolean {
  if (!currentTrack || !nextTrack) return false;
  if (shuffle) return false;
  if (playSource?.type !== "album") return false;
  return (
    !!currentTrack.album &&
    !!nextTrack.album &&
    !!currentTrack.artist &&
    !!nextTrack.artist &&
    currentTrack.album === nextTrack.album &&
    currentTrack.artist === nextTrack.artist
  );
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
  const restoredRef = useRef(stored.current.queue.length > 0);
  const shouldAutoplayRef = useRef(false);
  const lastNonZeroVolumeRef = useRef(Math.max(getStoredVolume(), 0.5));
  const radioRefillInFlightRef = useRef(false);
  const radioRefillSignatureRef = useRef<string | null>(null);

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

  useEffect(() => {
    saveQueue(queue, currentIndex);
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

  useEffect(() => {
    const track = queue[currentIndex];
    if (!track) return;
    const preloadedSrc = consumePreloadedSource(track);
    const streamUrl = preloadedSrc || getStreamUrl(track);

    if (restoredRef.current) {
      restoredRef.current = false;
      audio.src = streamUrl;
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
  }, [addToRecentlyPlayed, audio, clearPreloadedTrack, consumePreloadedSource, currentIndex, queue]);

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
      const detail = (event as CustomEvent<{ crossfadeSeconds?: number }>).detail;
      if (typeof detail?.crossfadeSeconds === "number") {
        setCrossfadeSeconds(detail.crossfadeSeconds);
      } else {
        setCrossfadeSeconds(getCrossfadeDurationPreference());
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
      playSource.name,
      playSource.radio.seedType,
      playSource.radio.seedId ?? "",
      playSource.radio.seedPath ?? "",
      currentTrack.id,
      queue.length,
    ].join("::");
    if (radioRefillSignatureRef.current === signature) return;
    radioRefillSignatureRef.current = signature;
    radioRefillInFlightRef.current = true;

    const existingKeys = new Set(
      [...queue, ...recentlyPlayed].map((track) => getTrackCacheKey(track)),
    );

    fetchRadioContinuation(playSource, RADIO_REFILL_BATCH_SIZE)
      .then((tracks) => {
        const uniqueTracks = tracks.filter((track) => {
          const key = getTrackCacheKey(track);
          if (!key || existingKeys.has(key)) return false;
          existingKeys.add(key);
          return true;
        });
        if (uniqueTracks.length > 0) {
          setQueue((prev) => [...prev, ...uniqueTracks]);
        }
      })
      .catch((error) => {
        console.warn("[player] radio refill failed:", error);
      })
      .finally(() => {
        radioRefillInFlightRef.current = false;
      });
  }, [currentIndex, isPlaying, playSource, queue, recentlyPlayed]);

  useEffect(() => {
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      const endedTrack = queue[currentIndex];
      if (endedTrack) {
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

      const nextTrack = getPredictableNextTrack(queue, currentIndex, repeat, shuffle);
      const continuousAlbum = isContinuousAlbumTransition(endedTrack, nextTrack, playSource, shuffle);

      if (repeat === "one") {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }

      shouldAutoplayRef.current = true;
      if (crossfadeSeconds > 0 && nextTrack && !continuousAlbum) {
        setIsBuffering(false);
      }
      if (shuffle) {
        if (queue.length > 1) {
          let nextIdx: number;
          do {
            nextIdx = Math.floor(Math.random() * queue.length);
          } while (nextIdx === currentIndex && queue.length > 1);
          setCurrentIndex(nextIdx);
        } else {
          shouldAutoplayRef.current = false;
          setIsPlaying(false);
        }
        return;
      }

      if (currentIndex < queue.length - 1) {
        setCurrentIndex((i) => i + 1);
      } else if (repeat === "all") {
        setCurrentIndex(0);
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
    const onSeeked = () => setIsBuffering(false);
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
  }, [audio, crossfadeSeconds, currentIndex, playSource, queue, repeat, shuffle]);

  const play = useCallback((track: Track, source?: PlaySource) => {
    try {
      const w = window as unknown as Record<string, AudioContext>;
      if (!w.__crateAudioCtx) w.__crateAudioCtx = new AudioContext();
      if (w.__crateAudioCtx.state === "suspended") w.__crateAudioCtx.resume();
    } catch { /* ok */ }

    restoredRef.current = false;
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
  }, [addToRecentlyPlayed, audio, clearPreloadedTrack]);

  const playAll = useCallback((tracks: Track[], startIndex = 0, source?: PlaySource) => {
    if (tracks.length === 0) return;
    const track = tracks[startIndex];
    if (!track) return;

    restoredRef.current = false;
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
  }, [addToRecentlyPlayed, audio, clearPreloadedTrack]);

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
    }
  }, [clearPreloadedTrack, currentIndex, queue.length, repeat, shuffle]);

  const prev = useCallback(() => {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    if (currentIndex > 0) {
      shouldAutoplayRef.current = true;
      clearPreloadedTrack();
      setCurrentIndex((i) => i - 1);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [audio, clearPreloadedTrack, currentIndex]);

  const seek = useCallback((time: number) => {
    setIsBuffering(true);
    audio.currentTime = time;
    setCurrentTime(time);
  }, [audio]);

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
  }, [audio, clearPreloadedTrack]);

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
      clearPreloadedTrack();
      shouldAutoplayRef.current = true;
      setCurrentIndex(index);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [clearPreloadedTrack, queue.length]);

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

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        el.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON"
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (!queue[currentIndex]) return;

      if (event.code === "Space" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (isPlaying) pause();
        else resume();
        return;
      }

      if (event.shiftKey && event.key === "ArrowRight") {
        event.preventDefault();
        next();
        return;
      }

      if (event.shiftKey && event.key === "ArrowLeft") {
        event.preventDefault();
        prev();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        seek(Math.min(audio.duration || duration || 0, audio.currentTime + 10));
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seek(Math.max(0, audio.currentTime - 10));
        return;
      }

      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        if (volume === 0) setVolume(lastNonZeroVolumeRef.current || 0.8);
        else setVolume(0);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [audio, currentIndex, duration, isPlaying, next, pause, prev, queue, resume, seek, setVolume, volume]);

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
      currentTrack: queue[currentIndex],
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
      queue, currentIndex, shuffle, repeat, playSource, recentlyPlayed,
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
