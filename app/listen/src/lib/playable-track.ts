import type { Track } from "@/contexts/player-types";

export interface PlayableTrackInput {
  id?: string | number | null;
  storage_id?: string | null;
  storageId?: string | null;
  title?: string | null;
  artist: string;
  artist_id?: number | null;
  artistId?: number | null;
  artist_slug?: string | null;
  artistSlug?: string | null;
  album?: string | null;
  album_id?: number | null;
  albumId?: number | null;
  album_slug?: string | null;
  albumSlug?: string | null;
  albumCover?: string | null;
  path?: string | null;
  library_track_id?: number | null;
  libraryTrackId?: number | null;
  format?: string | null;
  bitrate?: number | null;
  sample_rate?: number | null;
  sampleRate?: number | null;
  bit_depth?: number | null;
  bitDepth?: number | null;
  is_suggested?: boolean;
  isSuggested?: boolean;
  suggestion_source?: "playlist";
  suggestionSource?: "playlist";
}

export function resolvePlayableTrackId(input: PlayableTrackInput): string {
  return input.storageId
    || input.storage_id
    || input.path
    || String(input.id || "");
}

export function toPlayableTrack(
  input: PlayableTrackInput,
  options: { cover?: string } = {},
): Track {
  return {
    id: resolvePlayableTrackId(input),
    storageId: input.storageId ?? input.storage_id ?? undefined,
    title: input.title || "Unknown",
    artist: input.artist,
    artistId: input.artistId ?? input.artist_id ?? undefined,
    artistSlug: input.artistSlug ?? input.artist_slug ?? undefined,
    album: input.album ?? undefined,
    albumId: input.albumId ?? input.album_id ?? undefined,
    albumSlug: input.albumSlug ?? input.album_slug ?? undefined,
    albumCover: options.cover || input.albumCover || undefined,
    path: input.path ?? undefined,
    libraryTrackId: input.libraryTrackId ?? input.library_track_id ?? (
      typeof input.id === "number" ? input.id : undefined
    ),
    format: input.format ?? undefined,
    bitrate: input.bitrate ?? null,
    sampleRate: input.sampleRate ?? input.sample_rate ?? null,
    bitDepth: input.bitDepth ?? input.bit_depth ?? null,
    isSuggested: input.isSuggested ?? input.is_suggested,
    suggestionSource: input.suggestionSource ?? input.suggestion_source,
  };
}
