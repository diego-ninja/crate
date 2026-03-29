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

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumCover?: string;
}

type RepeatMode = "off" | "one" | "all";

export interface PlaySource {
  type: "album" | "playlist" | "radio" | "track" | "queue";
  name: string;
}

interface PlayerStateValue {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
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

const RECENTLY_PLAYED_KEY = "listen-recently-played";
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

function getStreamUrl(track: Track): string {
  return track.id.includes("/")
    ? `/api/stream/${encodeURIComponent(track.id).replace(/%2F/g, "/")}`
    : `/api/navidrome/stream/${track.id}`;
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
  const [playSource, setPlaySource] = useState<PlaySource | null>(null);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>(getStoredRecentlyPlayed);
  const restoredRef = useRef(stored.current.queue.length > 0);
  const shouldAutoplayRef = useRef(false);

  if (!audioRef.current) {
    audioRef.current = new Audio();
    audioRef.current.volume = getStoredVolume();
  }
  const audio = audioRef.current;

  useEffect(() => {
    saveQueue(queue, currentIndex);
  }, [queue, currentIndex]);

  function addToRecentlyPlayed(track: Track) {
    setRecentlyPlayed((prev) => {
      const filtered = prev.filter((t) => t.id !== track.id);
      const updated = [track, ...filtered].slice(0, MAX_RECENT);
      saveRecentlyPlayed(updated);
      return updated;
    });
  }

  // Load audio src when current track changes
  useEffect(() => {
    const track = queue[currentIndex];
    if (!track) return;
    const streamUrl = getStreamUrl(track);

    if (restoredRef.current) {
      restoredRef.current = false;
      audio.src = streamUrl;
      return;
    }

    if (shouldAutoplayRef.current) {
      shouldAutoplayRef.current = false;
      audio.src = streamUrl;
      audio.play().catch((e) => console.warn("[player] autoplay failed:", e));
      setIsPlaying(true);
      addToRecentlyPlayed(track);
    }
  }, [queue, currentIndex, audio]);

  // Audio event listeners
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
            navidrome_id: endedTrack.id.includes("/") ? "" : endedTrack.id,
            title: endedTrack.title,
            artist: endedTrack.artist,
          }),
        }).catch(() => {});

        // Record play in history
        fetch("/api/me/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            track_path: endedTrack.id,
            title: endedTrack.title,
            artist: endedTrack.artist,
            album: endedTrack.album || "",
          }),
        }).catch(() => {});
      }

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
      console.error("[player] audio error:", audio.error?.code, audio.error?.message);
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

  const play = useCallback((track: Track, source?: PlaySource) => {
    // Warm up AudioContext synchronously on user gesture (browsers require this)
    try {
      const w = window as unknown as Record<string, AudioContext>;
      if (!w.__crateAudioCtx) w.__crateAudioCtx = new AudioContext();
      if (w.__crateAudioCtx.state === "suspended") w.__crateAudioCtx.resume();
    } catch { /* ok */ }
    restoredRef.current = false;
    audio.src = getStreamUrl(track);
    audio.play().catch((e) => console.warn("[player] play failed:", e));
    setQueue([track]);
    setCurrentIndex(0);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(true);
    setPlaySource(source || { type: "track", name: track.title });
    addToRecentlyPlayed(track);
  }, [audio]);

  const playAll = useCallback((tracks: Track[], startIndex = 0, source?: PlaySource) => {
    if (tracks.length === 0) return;
    const track = tracks[startIndex];
    if (!track) return;
    restoredRef.current = false;
    audio.src = getStreamUrl(track);
    audio.play().catch((e) => console.warn("[player] playAll failed:", e));
    setQueue(tracks);
    setCurrentIndex(startIndex);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(true);
    setPlaySource(source || (tracks.length > 1 ? { type: "queue", name: "Queue" } : { type: "track", name: track.title }));
    addToRecentlyPlayed(track);
  }, [audio]);

  const pause = useCallback(() => {
    audio.pause();
  }, [audio]);

  const resume = useCallback(() => {
    try {
      const w = window as unknown as Record<string, AudioContext>;
      if (!w.__crateAudioCtx) w.__crateAudioCtx = new AudioContext();
      if (w.__crateAudioCtx.state === "suspended") w.__crateAudioCtx.resume();
    } catch { /* ok */ }
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
    try { localStorage.setItem("listen-player-volume", String(vol)); } catch { /* ignore */ }
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

  const stateValue = useMemo<PlayerStateValue>(
    () => ({ currentTime, duration, isPlaying, volume }),
    [currentTime, duration, isPlaying, volume],
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
