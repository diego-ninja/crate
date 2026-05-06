import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { getApiBase, getAuthToken, resolveMaybeApiAssetUrl } from "@/lib/api";
import { trackStreamApiPath } from "@/lib/library-routes";
import { stableMobileAudioPipeline } from "@/lib/mobile-audio-mode";
import { getOfflineNativePlaybackUrl } from "@/lib/offline";
import { getPlaybackDeliveryPolicyPreference } from "@/lib/player-playback-prefs";

export const STORAGE_KEY = "listen-player-state";
export const RECENTLY_PLAYED_KEY = "listen-recently-played";
export const MAX_RECENT = 10;
export const ANDROID_CONTINUOUS_ALBUM_CROSSFADE_SECONDS = 1;
export const SMART_TRANSITION_SHORT_SECONDS = 2;
export const SMART_TRANSITION_BALANCED_SECONDS = 4;
export const SMART_TRANSITION_LONG_SECONDS = 6;
export const SMART_TRANSITION_MIXED_QUEUE_SECONDS = 3;

const SMART_TRANSITION_MIN_SIGNAL_WEIGHT = 0.35;
const KEY_TO_PITCH_CLASS: Record<string, number> = {
  c: 0,
  "b#": 0,
  "c#": 1,
  db: 1,
  d: 2,
  "d#": 3,
  eb: 3,
  e: 4,
  fb: 4,
  "e#": 5,
  f: 5,
  "f#": 6,
  gb: 6,
  g: 7,
  "g#": 8,
  ab: 8,
  a: 9,
  "a#": 10,
  bb: 10,
  b: 11,
  cb: 11,
};

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
        };
      }
    }
  } catch {
    /* ignore */
  }
  return { queue: [], currentIndex: 0, currentTime: 0, wasPlaying: false, shuffle: false, unshuffledQueue: null };
}

function normalizeStoredTrack(track: Track): Track {
  const albumCover = resolveMaybeApiAssetUrl(track.albumCover);
  return albumCover && albumCover !== track.albumCover
    ? { ...track, albumCover }
    : track;
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
  if (track.entityUid || track.path) {
    const localOfflineUrl = getOfflineNativePlaybackUrl(
      track.entityUid ? { entityUid: track.entityUid } : (track.path ?? null),
    );
    if (localOfflineUrl) return localOfflineUrl;
  }

  const base = _apiBase();
  const path = trackStreamApiPath(track);
  const streamPath = path || `/api/tracks/${track.id}/stream`;
  return withStreamQuery(`${base}${streamPath}`);
}

/** Append playback-delivery policy and auth token. Gapless-5 creates
 *  its own Audio elements that don't inherit browser cookies, so always
 *  include token when present. */
function withStreamQuery(url: string): string {
  const params = new URLSearchParams();
  const delivery = getPlaybackDeliveryPolicyPreference();
  if (delivery !== "original") {
    params.set("delivery", delivery);
  }
  try {
    const token = getAuthToken();
    if (token) params.set("token", token);
  } catch {
    // ignore token lookup failures
  }
  const query = params.toString();
  return query ? `${url}${url.includes("?") ? "&" : "?"}${query}` : url;
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

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeScale(scale: string | null | undefined): "major" | "minor" | null {
  const normalized = scale?.trim().toLowerCase();
  if (normalized === "major" || normalized === "minor") return normalized;
  return null;
}

function pitchClass(key: string | null | undefined): number | null {
  const normalized = key?.trim().toLowerCase().replace("\u266f", "#").replace("\u266d", "b");
  if (!normalized) return null;
  return KEY_TO_PITCH_CLASS[normalized] ?? null;
}

function bpmCompatibility(currentBpm: number | null | undefined, nextBpm: number | null | undefined): number | null {
  const current = finiteNumber(currentBpm);
  const next = finiteNumber(nextBpm);
  if (!current || !next || current <= 0 || next <= 0) return null;
  const candidates = [next, next / 2, next * 2];
  const diff = Math.min(...candidates.map((candidate) => Math.abs(current - candidate)));
  return Math.max(0, 1 - diff / 32);
}

function scalarCompatibility(
  currentValue: number | null | undefined,
  nextValue: number | null | undefined,
): number | null {
  const current = finiteNumber(currentValue);
  const next = finiteNumber(nextValue);
  if (current == null || next == null) return null;
  return Math.max(0, 1 - Math.abs(current - next));
}

function keyCompatibility(currentTrack: Track, nextTrack: Track): number | null {
  const currentKey = pitchClass(currentTrack.audioKey);
  const nextKey = pitchClass(nextTrack.audioKey);
  if (currentKey == null || nextKey == null) return null;

  const currentScale = normalizeScale(currentTrack.audioScale);
  const nextScale = normalizeScale(nextTrack.audioScale);
  const distance = Math.min(
    Math.abs(currentKey - nextKey),
    12 - Math.abs(currentKey - nextKey),
  );

  if (distance === 0 && currentScale === nextScale) return 1;
  if (distance === 0) return 0.72;
  if (currentScale === "major" && nextScale === "minor" && nextKey === (currentKey + 9) % 12) return 0.9;
  if (currentScale === "minor" && nextScale === "major" && nextKey === (currentKey + 3) % 12) return 0.9;
  if (distance === 5 || distance === 7) return currentScale === nextScale ? 0.78 : 0.62;
  if (distance <= 2) return 0.58;
  return 0.28;
}

function blissCompatibility(currentTrack: Track, nextTrack: Track): number | null {
  const current = currentTrack.blissVector;
  const next = nextTrack.blissVector;
  if (!Array.isArray(current) || !Array.isArray(next) || current.length < 3 || current.length !== next.length) {
    return null;
  }

  let dot = 0;
  let currentMagnitude = 0;
  let nextMagnitude = 0;
  for (let i = 0; i < current.length; i += 1) {
    const a = finiteNumber(current[i]);
    const b = finiteNumber(next[i]);
    if (a == null || b == null) return null;
    dot += a * b;
    currentMagnitude += a * a;
    nextMagnitude += b * b;
  }
  if (currentMagnitude <= 0 || nextMagnitude <= 0) return null;
  const cosine = dot / (Math.sqrt(currentMagnitude) * Math.sqrt(nextMagnitude));
  return Math.max(0, Math.min(1, (cosine + 1) / 2));
}

function smartTransitionFeatureScore(currentTrack: Track, nextTrack: Track): number | null {
  const signals: Array<[number, number | null]> = [
    [0.4, blissCompatibility(currentTrack, nextTrack)],
    [0.2, bpmCompatibility(currentTrack.bpm, nextTrack.bpm)],
    [0.15, keyCompatibility(currentTrack, nextTrack)],
    [0.15, scalarCompatibility(currentTrack.energy, nextTrack.energy)],
    [0.05, scalarCompatibility(currentTrack.danceability, nextTrack.danceability)],
    [0.05, scalarCompatibility(currentTrack.valence, nextTrack.valence)],
  ];

  let weightedScore = 0;
  let totalWeight = 0;
  for (const [weight, score] of signals) {
    if (score == null) continue;
    weightedScore += weight * score;
    totalWeight += weight;
  }
  if (totalWeight < SMART_TRANSITION_MIN_SIGNAL_WEIGHT) return null;
  return weightedScore / totalWeight;
}

function fallbackSmartTransitionSeconds(
  currentTrack: Track | undefined,
  nextTrack: Track | null,
  playSource: PlaySource | null,
  shuffle: boolean,
): number {
  if (!currentTrack || !nextTrack) return 0;
  if (playSource?.type === "radio") return SMART_TRANSITION_BALANCED_SECONDS;
  if (playSource?.type === "playlist") return SMART_TRANSITION_BALANCED_SECONDS;
  if (shuffle) return SMART_TRANSITION_BALANCED_SECONDS;
  if (currentTrack.isSuggested || nextTrack.isSuggested) return SMART_TRANSITION_BALANCED_SECONDS;
  return SMART_TRANSITION_MIXED_QUEUE_SECONDS;
}

function smartTransitionSeconds(
  currentTrack: Track | undefined,
  nextTrack: Track | null,
  playSource: PlaySource | null,
  shuffle: boolean,
): number {
  if (!currentTrack || !nextTrack) {
    return fallbackSmartTransitionSeconds(currentTrack, nextTrack, playSource, shuffle);
  }
  const featureScore = smartTransitionFeatureScore(currentTrack, nextTrack);
  if (featureScore == null) {
    return fallbackSmartTransitionSeconds(currentTrack, nextTrack, playSource, shuffle);
  }
  if (featureScore >= 0.78) return SMART_TRANSITION_LONG_SECONDS;
  if (featureScore >= 0.55) return SMART_TRANSITION_BALANCED_SECONDS;
  return SMART_TRANSITION_SHORT_SECONDS;
}

export function getEffectiveCrossfadeSeconds(
  currentTrack: Track | undefined,
  nextTrack: Track | null,
  playSource: PlaySource | null,
  shuffle: boolean,
  configuredSeconds: number,
  smartCrossfadeEnabled: boolean,
  options: { androidNative?: boolean; html5OnlyPlayback?: boolean; mobileEnhancedAudio?: boolean } = {},
): number {
  const clampedSeconds = Math.max(0, configuredSeconds || 0);
  if (clampedSeconds <= 0) return 0;
  if (!smartCrossfadeEnabled) return clampedSeconds;
  const continuousAlbumTransition = isContinuousAlbumTransition(currentTrack, nextTrack, playSource, shuffle);
  if (continuousAlbumTransition) {
    const mobileHtml5Pipeline = (options.androidNative || stableMobileAudioPipeline)
      && !options.mobileEnhancedAudio;
    const shouldMaskHtml5Gap = options.html5OnlyPlayback ?? mobileHtml5Pipeline;
    return shouldMaskHtml5Gap ? Math.min(clampedSeconds, ANDROID_CONTINUOUS_ALBUM_CROSSFADE_SECONDS) : 0;
  }
  return Math.min(clampedSeconds, smartTransitionSeconds(currentTrack, nextTrack, playSource, shuffle));
}
