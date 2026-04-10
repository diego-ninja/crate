import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";

export const STORAGE_KEY = "listen-player-state";
export const RECENTLY_PLAYED_KEY = "listen-recently-played";
export const MAX_RECENT = 10;
export const NEXT_TRACK_PRELOAD_WINDOW_SECONDS = 15;
export const PLAYER_AUDIO_KEY = "__listenPlayerAudio";
export const PLAYER_PRELOAD_AUDIO_KEY = "__listenPlayerPreloadAudio";

export function getStoredVolume(): number {
  try {
    const v = localStorage.getItem("listen-player-volume");
    if (v !== null) return parseFloat(v);
  } catch {
    /* ignore */
  }
  return 0.8;
}

export function getStoredQueue(): { queue: Track[]; currentIndex: number; currentTime: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.queue) && parsed.queue.length > 0) {
        return { queue: parsed.queue, currentIndex: parsed.currentIndex ?? 0, currentTime: parsed.currentTime ?? 0 };
      }
    }
  } catch {
    /* ignore */
  }
  return { queue: [], currentIndex: 0, currentTime: 0 };
}

export function saveQueue(queue: Track[], currentIndex: number, currentTime?: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ queue, currentIndex, currentTime: currentTime ?? 0 }));
  } catch {
    /* ignore */
  }
}

export function getStoredRecentlyPlayed(): Track[] {
  try {
    const raw = localStorage.getItem(RECENTLY_PLAYED_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

export function saveRecentlyPlayed(tracks: Track[]) {
  try {
    localStorage.setItem(RECENTLY_PLAYED_KEY, JSON.stringify(tracks));
  } catch {
    /* ignore */
  }
}

export function getSharedAudio(key: string): HTMLAudioElement {
  const w = window as unknown as Record<string, HTMLAudioElement | undefined>;
  if (!w[key]) {
    const el = new Audio();
    // Enable cross-origin playback for Capacitor (streams come from api.* domain)
    el.crossOrigin = "anonymous";
    w[key] = el;
  }
  return w[key]!;
}

export function getStreamUrl(track: Track): string {
  const base = _apiBase();
  const suffix = _tokenSuffix();

  if (track.libraryTrackId != null) {
    return `${base}/api/tracks/${track.libraryTrackId}/stream${suffix}`;
  }

  if (track.navidromeId) {
    return `${base}/api/navidrome/stream/${track.navidromeId}${suffix}`;
  }

  const playbackPath = track.path || track.id;
  if (playbackPath.includes("/")) {
    return `${base}/api/stream/${encodeURIComponent(playbackPath).replace(/%2F/g, "/")}${suffix}`;
  }

  return `${base}/api/navidrome/stream/${track.id}${suffix}`;
}

/** Append ?token= for native apps where audio element can't send Bearer headers. */
function _tokenSuffix(): string {
  const base = _apiBase();
  if (!base) return ""; // web: cookies work, no token needed
  try {
    const token = localStorage.getItem("crate-auth-token");
    return token ? `?token=${encodeURIComponent(token)}` : "";
  } catch {
    return "";
  }
}

/** Lazy-read API base so this module doesn't import from lib/api (circular risk). */
function _apiBase(): string {
  return import.meta.env.VITE_API_URL || "";
}

export function getTrackCacheKey(track: Track): string {
  return [track.libraryTrackId ?? "", track.navidromeId ?? "", track.path ?? "", track.id].join("::");
}

export function areTracksFromSameAlbum(currentTrack: Track | undefined, nextTrack: Track | null | undefined): boolean {
  if (!currentTrack || !nextTrack) return false;
  return (
    !!currentTrack.album &&
    !!nextTrack.album &&
    !!currentTrack.artist &&
    !!nextTrack.artist &&
    currentTrack.album === nextTrack.album &&
    currentTrack.artist === nextTrack.artist
  );
}

export function getPredictableNextTrack(
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

export function isContinuousAlbumTransition(
  currentTrack: Track | undefined,
  nextTrack: Track | null,
  playSource: PlaySource | null,
  shuffle: boolean,
): boolean {
  if (!currentTrack || !nextTrack) return false;
  if (shuffle) return false;
  if (playSource?.type !== "album") return false;
  return areTracksFromSameAlbum(currentTrack, nextTrack);
}
