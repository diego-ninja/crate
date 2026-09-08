import type { RepeatMode, Track } from "@/contexts/player-types";
import { apiStreamUrl, getApiBase } from "@/lib/api";
import { isNative } from "@/lib/capacitor-runtime";
import { recordDevLog, redactUrl } from "@/lib/dev-logs";
import { trackStreamApiPath } from "@/lib/library-routes";
import { getOfflineNativePlaybackUrl } from "@/lib/offline";
import { getEffectivePlaybackDeliveryPolicy } from "@/lib/player-playback-prefs";

export {
  ANDROID_CONTINUOUS_ALBUM_CROSSFADE_SECONDS,
  ANDROID_MEDIA_SESSION_HANDOFF_SECONDS,
  SMART_TRANSITION_BALANCED_SECONDS,
  SMART_TRANSITION_LONG_SECONDS,
  SMART_TRANSITION_MIXED_QUEUE_SECONDS,
  SMART_TRANSITION_SHORT_SECONDS,
  areTracksFromSameAlbum,
  getEffectiveCrossfadeSeconds,
  isContinuousAlbumTransition,
} from "./player-smart-transition";

export const STORAGE_KEY = "listen-player-state:v1";
export const RECENTLY_PLAYED_KEY = "listen-recently-played:v1";
export const MAX_RECENT = 10;
export function getStoredVolume(): number {
  if (isNative) return 1;
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
  savedAt: string | null;
}

export function getStoredQueue(): StoredQueue {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.queue) && parsed.queue.length > 0) {
        const queue = parsed.queue.map(normalizeStoredTrack);
        const unshuffledQueue = Array.isArray(parsed.unshuffledQueue)
          ? parsed.unshuffledQueue.map(normalizeStoredTrack)
          : null;
        return {
          queue,
          currentIndex: parsed.currentIndex ?? 0,
          currentTime: parsed.currentTime ?? 0,
          wasPlaying: parsed.wasPlaying === true,
          shuffle: parsed.shuffle === true,
          unshuffledQueue,
          savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return {
    queue: [],
    currentIndex: 0,
    currentTime: 0,
    wasPlaying: false,
    shuffle: false,
    unshuffledQueue: null,
    savedAt: null,
  };
}

function normalizeStoredTrack(track: Track): Track {
  const normalized = {
    ...track,
    albumCover: canonicalMediaUrl(track.albumCover),
  };
  // Strip remote stream URL on restore — always request fresh playback resolution
  if (normalized.remote) {
    normalized.remote = {
      ...normalized.remote,
      streamUrl: undefined,
      streamUrlExpiresAt: undefined,
    };
  }
  return normalized;
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
    const safeQueue = queue.map(sanitizeTrackForPersistence);
    const safeUnshuffled = options.unshuffledQueue
      ? options.unshuffledQueue.map(sanitizeTrackForPersistence)
      : null;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        queue: safeQueue,
        currentIndex,
        currentTime: options.currentTime ?? 0,
        wasPlaying: options.wasPlaying ?? false,
        shuffle: options.shuffle ?? false,
        unshuffledQueue: safeUnshuffled,
        savedAt: new Date().toISOString(),
      }),
    );
  } catch {
    /* ignore */
  }
}

function sanitizeTrackForPersistence(track: Track): Track {
  const safeTrack = {
    ...track,
    albumCover: canonicalMediaUrl(track.albumCover),
  };
  if (!track.remote) return safeTrack;
  return {
    ...safeTrack,
    path: undefined,
    remote: {
      ...track.remote,
      streamUrl: undefined,
      streamUrlExpiresAt: undefined,
    },
  };
}

function canonicalMediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, "https://crate.local");
    parsed.searchParams.delete("token");
    parsed.searchParams.delete("media_ticket");
    if (parsed.origin === "https://crate.local") {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return url
      .replace(/([?&])(token|media_ticket)=[^&]*&?/g, (_match, separator) =>
        separator === "?" ? "?" : "",
      )
      .replace(/[?&]$/, "");
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

export interface StreamUrlOptions {
  target?: "webview" | "android-native";
}

export function getOfflineStreamUrl(
  track: Track,
  options: StreamUrlOptions = {},
): string | null {
  if (!track.entityUid && !track.path) return null;
  return getOfflineNativePlaybackUrl(
    track.entityUid ? { entityUid: track.entityUid } : track.path ?? null,
    undefined,
    options,
  );
}

export function getStreamUrl(
  track: Track,
  options: StreamUrlOptions = {},
): string {
  const localOfflineUrl = getOfflineStreamUrl(track, options);
  if (localOfflineUrl) return localOfflineUrl;

  if (track.origin === "remote" && track.remote?.streamUrl) {
    const expired = track.remote.streamUrlExpiresAt
      ? new Date(track.remote.streamUrlExpiresAt).getTime() < Date.now()
      : false;
    if (!expired) {
      return `${_apiBase()}${track.remote.streamUrl}`;
    }
  }

  const base = _apiBase();
  const path = trackStreamApiPath(track);
  const streamPath = path || `/api/tracks/${track.id}/stream`;
  const url = withStreamQuery(`${base}${streamPath}`);
  recordDevLog(
    "stream",
    "resolved stream url",
    {
      track: track.title,
      artist: track.artist,
      policy: getEffectivePlaybackDeliveryPolicy(),
      url: redactUrl(url),
    },
    "debug",
  );
  return url;
}

/** Append playback delivery and a bounded WebView stream ticket. */
function withStreamQuery(url: string): string {
  const params = new URLSearchParams();
  const delivery = getEffectivePlaybackDeliveryPolicy();
  if (delivery !== "original") {
    params.set("delivery", delivery);
  }
  const query = params.toString();
  const resolved = query
    ? `${url}${url.includes("?") ? "&" : "?"}${query}`
    : url;
  return isNative ? apiStreamUrl(resolved) : resolved;
}

/** Lazy-read API base so server switches in native builds take effect immediately. */
function _apiBase(): string {
  return getApiBase();
}

export function getTrackCacheKey(track: Track): string {
  return [
    track.libraryTrackId ?? "",
    track.entityUid ?? "",
    track.path ?? "",
    track.id,
  ].join("::");
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
