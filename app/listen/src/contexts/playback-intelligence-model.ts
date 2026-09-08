import type { MutableRefObject } from "react";

import type { PlaySource, Track } from "@/contexts/player-types";
import { getTrackCacheKey } from "@/contexts/player-utils";

export const RADIO_REFILL_THRESHOLD = 3;
export const RADIO_REFILL_BATCH_SIZE = 30;
export const SMART_PLAYLIST_SUGGESTION_BATCH_SIZE = 12;

/**
 * Actions the PlayerContext exposes to the intelligence hook. Verb-oriented
 * so the hook doesn't need to know about React setters — the context owns
 * state mutations and only exposes domain primitives.
 */
export interface PlaybackIntelligenceActions {
  /** Append tracks to the end of the queue, de-duplicated against queue + recent. */
  appendTracks: (tracks: Track[]) => void;
  /**
   * Insert a suggestion (marked isSuggested) right after the current index.
   * No-op if the slot is already a suggestion or duplicate.
   */
  insertSuggestionAfterCurrent: (candidates: Track[]) => void;
  /**
   * Append tracks AND advance cursor to the first appended one (playback
   * continues into newly fetched tracks). Used when the user hits next
   * at the end of an infinite-playback album/playlist.
   */
  appendAndAdvance: (tracks: Track[]) => void;
  /** Show the buffering spinner without committing a new track. */
  setBuffering: (buffering: boolean) => void;
}

export interface PlaybackIntelligenceOptions {
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  playSource: PlaySource | null;
  shuffle: boolean;
  infinitePlaybackEnabled: boolean;
  smartPlaylistSuggestionsEnabled: boolean;
  smartPlaylistSuggestionsCadence: number;
  recentlyPlayed: Track[];
  actions: PlaybackIntelligenceActions;
}

export interface PlaybackIntelligenceRefs {
  currentIndexRef: MutableRefObject<number>;
  playSourceRef: MutableRefObject<PlaySource | null>;
  queueRef: MutableRefObject<Track[]>;
  recentlyPlayedRef: MutableRefObject<Track[]>;
  actionsRef: MutableRefObject<PlaybackIntelligenceActions>;
}

export function getPlaySourceSignature(
  source: PlaySource | null,
): string | null {
  if (!source) return null;
  const legacySeedStorageId =
    (source.radio as { seedStorageId?: string | null } | undefined)
      ?.seedStorageId ?? "";
  return [
    source.type,
    source.name,
    source.radio?.seedType ?? "",
    source.radio?.seedId ?? "",
    source.radio?.seedEntityUid ?? "",
    source.radio?.seedEntityUid ? "" : legacySeedStorageId,
    source.radio?.seedPath ?? "",
    source.radio?.shapedSessionId ?? "",
  ].join("::");
}

export function collectUniqueTracks(
  candidates: Track[],
  queue: Track[],
  recent: Track[],
): Track[] {
  const existingKeys = new Set(
    [...queue, ...recent].map((track) => getTrackCacheKey(track)),
  );
  const uniqueTracks: Track[] = [];
  for (const track of candidates) {
    const key = getTrackCacheKey(track);
    if (!key || existingKeys.has(key)) continue;
    existingKeys.add(key);
    uniqueTracks.push(track);
  }
  return uniqueTracks;
}
