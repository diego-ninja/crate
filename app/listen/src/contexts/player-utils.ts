import type { Track } from "@/contexts/player-types";
import type { PlaySource, RepeatMode } from "@/contexts/player-types";
import { getOfflineNativePlaybackUrl } from "@/lib/offline";

export const STORAGE_KEY = "listen-player-state";
export const RECENTLY_PLAYED_KEY = "listen-recently-played";
export const MAX_RECENT = 10;

export function getStoredVolume(): number {
  try {
    const v = localStorage.getItem("listen-player-volume");
    if (v !== null) return parseFloat(v);
  } catch {
    /* ignore */
  }
  return 0.8;
}

export interface StoredQueue {
  queue: Track[];
  currentIndex: number;
  currentTime: number;
  wasPlaying: boolean;
  /**
   * True if the persisted `queue` is in shuffled order. When true, the
   * `unshuffledQueue` below holds the original sequential order for
   * round-trip correctness (toggle shuffle off after reload restores it).
   */
  shuffle: boolean;
  /**
   * Original unshuffled order snapshot. Present only when shuffle was
   * active at persistence time. `null` when shuffle was off.
   */
  unshuffledQueue: Track[] | null;
}

export function getStoredQueue(): StoredQueue {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.queue) && parsed.queue.length > 0) {
        return {
          queue: parsed.queue,
          currentIndex: parsed.currentIndex ?? 0,
          currentTime: parsed.currentTime ?? 0,
          wasPlaying: parsed.wasPlaying === true,
          shuffle: parsed.shuffle === true,
          unshuffledQueue: Array.isArray(parsed.unshuffledQueue) ? parsed.unshuffledQueue : null,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return { queue: [], currentIndex: 0, currentTime: 0, wasPlaying: false, shuffle: false, unshuffledQueue: null };
}

export interface SaveQueueOptions {
  currentTime?: number;
  wasPlaying?: boolean;
  shuffle?: boolean;
  unshuffledQueue?: Track[] | null;
}

export function saveQueue(
  queue: Track[],
  currentIndex: number,
  options: SaveQueueOptions = {},
) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        queue,
        currentIndex,
        currentTime: options.currentTime ?? 0,
        wasPlaying: options.wasPlaying ?? false,
        shuffle: options.shuffle ?? false,
        unshuffledQueue: options.unshuffledQueue ?? null,
      }),
    );
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

export function getStreamUrl(track: Track): string {
  if (track.storageId) {
    const localOfflineUrl = getOfflineNativePlaybackUrl(track.storageId);
    if (localOfflineUrl) return localOfflineUrl;
  }

  const base = _apiBase();
  const suffix = _tokenSuffix();

  if (track.storageId) {
    return `${base}/api/tracks/by-storage/${encodeURIComponent(track.storageId)}/stream${suffix}`;
  }

  if (track.libraryTrackId != null) {
    return `${base}/api/tracks/${track.libraryTrackId}/stream${suffix}`;
  }

  const playbackPath = track.path || track.id;
  if (playbackPath.includes("/")) {
    return `${base}/api/stream/${encodeURIComponent(playbackPath).replace(/%2F/g, "/")}${suffix}`;
  }

  return `${base}/api/tracks/${track.id}/stream${suffix}`;
}

/** Append ?token= for auth. Gapless-5 creates its own Audio elements
 *  that don't inherit browser cookies, so always include token. */
function _tokenSuffix(): string {
  try {
    // Import would be circular, so read directly. Native Capacitor
    // stores the token in the server store; web keeps it here.
    const { isNative } = _capacitorRuntime();
    let token: string | null = null;
    if (isNative) {
      // getCurrentServer() is cheap (localStorage read)
      const raw = localStorage.getItem("crate-servers");
      const currentId = localStorage.getItem("crate-current-server");
      if (raw && currentId) {
        const servers = JSON.parse(raw) as Array<{ id: string; token: string | null }>;
        token = servers.find((s) => s.id === currentId)?.token ?? null;
      }
    }
    if (!token) {
      token = localStorage.getItem("listen-auth-token") || localStorage.getItem("crate-auth-token");
    }
    return token ? `?token=${encodeURIComponent(token)}` : "";
  } catch {
    return "";
  }
}

function _capacitorRuntime(): { isNative: boolean } {
  try {
    const w = window as any;
    return { isNative: w?.Capacitor?.isNativePlatform?.() ?? false };
  } catch {
    return { isNative: false };
  }
}

/** Lazy-read API base so this module doesn't import from lib/api (circular risk). */
function _apiBase(): string {
  return import.meta.env.VITE_API_URL || "";
}

export function getTrackCacheKey(track: Track): string {
  return [track.libraryTrackId ?? "", track.storageId ?? "", track.path ?? "", track.id].join("::");
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

export function getEffectiveCrossfadeSeconds(
  currentTrack: Track | undefined,
  nextTrack: Track | null,
  playSource: PlaySource | null,
  shuffle: boolean,
  configuredSeconds: number,
  smartCrossfadeEnabled: boolean,
): number {
  const clampedSeconds = Math.max(0, configuredSeconds || 0);
  if (clampedSeconds <= 0) return 0;
  if (!smartCrossfadeEnabled) return clampedSeconds;
  return isContinuousAlbumTransition(currentTrack, nextTrack, playSource, shuffle) ? 0 : clampedSeconds;
}
