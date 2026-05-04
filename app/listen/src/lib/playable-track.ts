import type { Track } from "@/contexts/player-types";

export interface PlayableTrackInput {
  id?: string | number | null;
  track_id?: string | number | null;
  entity_uid?: string | null;
  entityUid?: string | null;
  track_entity_uid?: string | null;
  duration?: number | null;
  title?: string | null;
  artist: string;
  artist_id?: number | null;
  artistId?: number | null;
  artist_entity_uid?: string | null;
  artistEntityUid?: string | null;
  artist_slug?: string | null;
  artistSlug?: string | null;
  album?: string | null;
  album_id?: number | null;
  albumId?: number | null;
  album_entity_uid?: string | null;
  albumEntityUid?: string | null;
  album_slug?: string | null;
  albumSlug?: string | null;
  albumCover?: string | null;
  path?: string | null;
  track_path?: string | null;
  library_track_id?: number | null;
  libraryTrackId?: number | null;
  format?: string | null;
  bitrate?: number | null;
  sample_rate?: number | null;
  sampleRate?: number | null;
  bit_depth?: number | null;
  bitDepth?: number | null;
  bpm?: number | null;
  audio_key?: string | null;
  audioKey?: string | null;
  audio_scale?: string | null;
  audioScale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  blissVector?: number[] | null;
  is_suggested?: boolean;
  isSuggested?: boolean;
  suggestion_source?: "playlist";
  suggestionSource?: "playlist";
}

export type PlayableTrackIdentityInput = Pick<
  PlayableTrackInput,
  | "id"
  | "track_id"
  | "entity_uid"
  | "entityUid"
  | "track_entity_uid"
  | "path"
  | "track_path"
  | "library_track_id"
  | "libraryTrackId"
>;

export function getPlayableTrackLibraryId(input: PlayableTrackIdentityInput): number | undefined {
  return input.libraryTrackId ?? input.library_track_id ?? (
    typeof input.track_id === "number" ? input.track_id : undefined
  ) ?? (
    typeof input.id === "number" ? input.id : undefined
  );
}

export function hasPlayableTrackReference(input: PlayableTrackIdentityInput): boolean {
  return getPlayableTrackLibraryId(input) != null
    || Boolean(
      input.entityUid
      ?? input.entity_uid
      ?? input.track_entity_uid
      ?? input.path
      ?? input.track_path,
    );
}

export function resolvePlayableTrackId(input: PlayableTrackInput): string {
  return input.entityUid
    || input.entity_uid
    || input.track_entity_uid
    || input.path
    || input.track_path
    || (input.track_id != null ? String(input.track_id) : undefined)
    || String(input.id || "");
}

export function toPlayableTrack(
  input: PlayableTrackInput,
  options: { cover?: string } = {},
): Track {
  return {
    id: resolvePlayableTrackId(input),
    entityUid: input.entityUid ?? input.entity_uid ?? input.track_entity_uid ?? undefined,
    title: input.title || "Unknown",
    artist: input.artist,
    artistId: input.artistId ?? input.artist_id ?? undefined,
    artistEntityUid: input.artistEntityUid ?? input.artist_entity_uid ?? undefined,
    artistSlug: input.artistSlug ?? input.artist_slug ?? undefined,
    album: input.album ?? undefined,
    albumId: input.albumId ?? input.album_id ?? undefined,
    albumEntityUid: input.albumEntityUid ?? input.album_entity_uid ?? undefined,
    albumSlug: input.albumSlug ?? input.album_slug ?? undefined,
    albumCover: options.cover || input.albumCover || undefined,
    path: input.path ?? input.track_path ?? undefined,
    libraryTrackId: getPlayableTrackLibraryId(input),
    format: input.format ?? undefined,
    bitrate: input.bitrate ?? null,
    sampleRate: input.sampleRate ?? input.sample_rate ?? null,
    bitDepth: input.bitDepth ?? input.bit_depth ?? null,
    bpm: input.bpm ?? null,
    audioKey: input.audioKey ?? input.audio_key ?? null,
    audioScale: input.audioScale ?? input.audio_scale ?? null,
    energy: input.energy ?? null,
    danceability: input.danceability ?? null,
    valence: input.valence ?? null,
    blissVector: input.blissVector ?? input.bliss_vector ?? null,
    isSuggested: input.isSuggested ?? input.is_suggested,
    suggestionSource: input.suggestionSource ?? input.suggestion_source,
  };
}
