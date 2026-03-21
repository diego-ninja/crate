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

  // Sync audio src when current track changes
  useEffect(() => {
    const track = queue[currentIndex];
    if (!track) return;
    // Use direct file streaming if id looks like a path, otherwise Navidrome
    const streamUrl = track.id.includes("/")
      ? `/api/stream/${track.id}`
      : `/api/navidrome/stream/${track.id}`;
    // If restoring from localStorage, load but don't autoplay
    if (restoredRef.current) {
      restoredRef.current = false;
      audio.src = streamUrl;
      return;
    }
    audio.src = streamUrl;
    audio.play().catch(() => { /* autoplay blocked */ });
    setIsPlaying(true);
    // Add to recently played
    setRecentlyPlayed((prev) => {
      const filtered = prev.filter((t) => t.id !== track.id);
      const updated = [track, ...filtered].slice(0, MAX_RECENT);
      saveRecentlyPlayed(updated);
      return updated;
    });
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
        setIsPlaying(false);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [audio, currentIndex, queue.length, repeat, shuffle, queue]);

  const play = useCallback((track: Track) => {
    restoredRef.current = false;
    setQueue([track]);
    setCurrentIndex(0);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  const playAll = useCallback((tracks: Track[], startIndex = 0) => {
    if (tracks.length === 0) return;
    restoredRef.current = false;
    setQueue(tracks);
    setCurrentIndex(startIndex);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  const pause = useCallback(() => {
    audio.pause();
  }, [audio]);

  const resume = useCallback(() => {
    audio.play().catch(() => {});
  }, [audio]);

  const next = useCallback(() => {
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
      setCurrentIndex(index);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [queue.length]);

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
        currentTrack: queue[currentIndex],
        audioElement: audioRef.current,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}
