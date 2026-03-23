import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumCover?: string;
}

type RepeatMode = "off" | "one" | "all";

interface PlayerState {
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  playbackRate: number;
  sleepTimer: number | null;
  recentlyPlayed: Track[];
}

interface PlayerContextValue extends PlayerState {
  play: (track: Track) => void;
  playAll: (tracks: Track[], startIndex?: number) => void;
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
  setPlaybackRate: (rate: number) => void;
  setSleepTimer: (minutes: number | null) => void;
  currentTrack: Track | undefined;
  audioElement: HTMLAudioElement | null;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}

const STORAGE_KEY = "player-state";

function getStoredVolume(): number {
  try {
    const v = localStorage.getItem("player-volume");
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

const RECENTLY_PLAYED_KEY = "recently-played";
const MAX_RECENT = 10;

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

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stored = useRef(getStoredQueue());
  const [queue, setQueue] = useState<Track[]>(stored.current.queue);
  const [currentIndex, setCurrentIndex] = useState(stored.current.currentIndex);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(getStoredVolume);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [sleepTimer, setSleepTimerState] = useState<number | null>(null);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>(getStoredRecentlyPlayed);
  const restoredRef = useRef(stored.current.queue.length > 0);

  if (!audioRef.current) {
    audioRef.current = new Audio();
    audioRef.current.volume = getStoredVolume();
  }
  const audio = audioRef.current;

  // Persist queue changes
  useEffect(() => {
    saveQueue(queue, currentIndex);
  }, [queue, currentIndex]);

  // Flag: when true, the next effect should autoplay (used for next/prev/ended)
  const shouldAutoplayRef = useRef(false);

  function getStreamUrl(track: Track): string {
    return track.id.includes("/")
      ? `/api/stream/${encodeURIComponent(track.id).replace(/%2F/g, "/")}`
      : `/api/navidrome/stream/${track.id}`;
  }

  function addToRecentlyPlayed(track: Track) {
    setRecentlyPlayed((prev) => {
      const filtered = prev.filter((t) => t.id !== track.id);
      const updated = [track, ...filtered].slice(0, MAX_RECENT);
      saveRecentlyPlayed(updated);
      return updated;
    });
  }

  // Load audio src when current track changes (for autoplay on next/prev/ended)
  useEffect(() => {
    const track = queue[currentIndex];
    if (!track) return;
    const streamUrl = getStreamUrl(track);

    // Restore from localStorage — load but don't play
    if (restoredRef.current) {
      restoredRef.current = false;
      audio.src = streamUrl;
      return;
    }

    // Autoplay triggered by next/prev/ended/jumpTo
    if (shouldAutoplayRef.current) {
      shouldAutoplayRef.current = false;
      audio.src = streamUrl;
      audio.play().catch((e) => { console.warn("[player] autoplay failed:", e); });
      setIsPlaying(true);
      addToRecentlyPlayed(track);
    }
    // If not autoplay, src was already set by play()/playAll()
  }, [queue, currentIndex, audio]);

  // Audio event listeners
  useEffect(() => {
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      if (repeat === "one") {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }
      shouldAutoplayRef.current = true;
      if (shuffle) {
        if (queue.length > 1) {
          let nextIdx: number;
          do {
            nextIdx = Math.floor(Math.random() * queue.length);
          } while (nextIdx === currentIndex && queue.length > 1);
          setCurrentIndex(nextIdx);
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
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    const onError = () => {
      const e = audio.error;
      console.error("[player] audio error:", e?.code, e?.message, audio.src);
      setIsPlaying(false);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
    };
  }, [audio, currentIndex, queue.length, repeat, shuffle, queue]);

  const play = useCallback((track: Track) => {
    restoredRef.current = false;
    // Start playback synchronously within user gesture
    audio.src = getStreamUrl(track);
    audio.play().catch((e) => { console.warn("[player] play failed:", e); });
    setQueue([track]);
    setCurrentIndex(0);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(true);
    addToRecentlyPlayed(track);
  }, [audio]);

  const playAll = useCallback((tracks: Track[], startIndex = 0) => {
    if (tracks.length === 0) return;
    restoredRef.current = false;
    const track = tracks[startIndex];
    if (!track) return;
    // Start playback synchronously within user gesture
    audio.src = getStreamUrl(track);
    audio.play().catch((e) => { console.warn("[player] playAll failed:", e); });
    setQueue(tracks);
    setCurrentIndex(startIndex);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(true);
    addToRecentlyPlayed(track);
  }, [audio]);

  const pause = useCallback(() => {
    audio.pause();
  }, [audio]);

  const resume = useCallback(() => {
    audio.play().catch(() => {});
  }, [audio]);

  const next = useCallback(() => {
    shouldAutoplayRef.current = true;
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
  }, [currentIndex, queue.length, shuffle, repeat]);

  const prev = useCallback(() => {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
    } else if (currentIndex > 0) {
      shouldAutoplayRef.current = true;
      setCurrentIndex((i) => i - 1);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [audio, currentIndex]);

  const seek = useCallback((time: number) => {
    audio.currentTime = time;
    setCurrentTime(time);
  }, [audio]);

  const setVolume = useCallback((vol: number) => {
    audio.volume = vol;
    setVolumeState(vol);
    try { localStorage.setItem("player-volume", String(vol)); } catch { /* ignore */ }
  }, [audio]);

  const clearQueue = useCallback(() => {
    audio.pause();
    audio.src = "";
    setQueue([]);
    setCurrentIndex(0);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, [audio]);

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
      shouldAutoplayRef.current = true;
      setCurrentIndex(index);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [queue.length]);

  const playNext = useCallback((track: Track) => {
    setQueue((prev) => {
      const next = [...prev];
      next.splice(currentIndex + 1, 0, track);
      return next;
    });
  }, [currentIndex]);

  const addToQueue = useCallback((track: Track) => {
    setQueue((prev) => [...prev, track]);
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    setQueue((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.filter((_, i) => i !== index);
      return next;
    });
    // Adjust currentIndex if needed
    if (index < currentIndex) {
      setCurrentIndex((i) => i - 1);
    } else if (index === currentIndex && index >= queue.length - 1) {
      setCurrentIndex((i) => Math.max(0, i - 1));
    }
  }, [currentIndex, queue.length]);

  const setPlaybackRate = useCallback((rate: number) => {
    audio.playbackRate = rate;
    setPlaybackRateState(rate);
  }, [audio]);

  const setSleepTimer = useCallback((minutes: number | null) => {
    if (sleepTimerRef.current) {
      clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    if (minutes) {
      sleepTimerRef.current = setTimeout(() => {
        audio.pause();
        setSleepTimerState(null);
      }, minutes * 60 * 1000);
    }
    setSleepTimerState(minutes);
  }, [audio]);

  return (
    <PlayerContext.Provider
      value={{
        queue,
        currentIndex,
        isPlaying,
        currentTime,
        duration,
        volume,
        shuffle,
        repeat,
        playbackRate,
        sleepTimer,
        recentlyPlayed,
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
        setPlaybackRate,
        setSleepTimer,
        currentTrack: queue[currentIndex],
        audioElement: audioRef.current,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}
