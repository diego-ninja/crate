import type { Track } from "@/contexts/player-types";
import { ApiError } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { toTrackRowData } from "@/lib/track-row-data";
import type { TrackRowData } from "@/components/cards/TrackRow";

export interface SearchArtist {
  id?: number;
  entity_uid?: string;
  global_uid?: string;
  global_artist_uid?: string;
  slug?: string;
  name: string;
  origin?: "local" | "remote";
  node_uid?: string;
  node_name?: string;
  remote_entity_uid?: string;
  has_photo?: boolean;
}

export interface SearchAlbum {
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  name: string;
  id?: number;
  entity_uid?: string;
  global_uid?: string;
  global_album_uid?: string;
  slug?: string;
  year?: string;
  has_cover?: boolean;
  origin?: "local" | "remote";
  node_uid?: string;
  node_name?: string;
  remote_entity_uid?: string;
}

export interface SearchTrack {
  id?: number;
  entity_uid?: string;
  global_uid?: string;
  global_track_uid?: string;
  globalTrackUid?: string;
  slug?: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_entity_uid?: string;
  global_album_uid?: string;
  album_slug?: string;
  path?: string;
  duration?: number;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  origin?: "local" | "remote";
  node_uid?: string;
  node_name?: string;
  remote_entity_uid?: string;
  availability?: {
    catalog: boolean;
    stream: boolean;
    import: boolean;
    stale?: boolean;
    local?: boolean;
    remote?: boolean;
    healthy?: boolean;
  };
}

export interface SearchData {
  artists: SearchArtist[];
  albums: SearchAlbum[];
  tracks: SearchTrack[];
}

export function artistGlobalUid(input: SearchArtist): string | null {
  return input.global_artist_uid ?? input.global_uid ?? null;
}

export function albumGlobalUid(input: SearchAlbum): string | null {
  return input.global_album_uid ?? input.global_uid ?? null;
}

export function trackGlobalUid(input: SearchTrack): string | null {
  return (
    input.globalTrackUid ?? input.global_track_uid ?? input.global_uid ?? null
  );
}

function trackGlobalAlbumUid(input: SearchTrack): string | null {
  return input.global_album_uid ?? input.album_entity_uid ?? null;
}

export function trackAlbumCover(track: SearchTrack) {
  const globalAlbumUid = trackGlobalAlbumUid(track);
  if (trackGlobalUid(track) && globalAlbumUid) {
    return albumCoverApiUrl({ globalAlbumUid }, { size: 128 });
  }
  return albumCoverApiUrl(
    {
      albumId: track.album_id,
      albumEntityUid: track.album_entity_uid,
      artistEntityUid: track.artist_entity_uid,
      albumSlug: track.album_slug,
      artistName: track.artist,
      albumName: track.album,
    },
    { size: 128 },
  );
}

export function searchErrorHint(
  error: unknown,
  messages: { sessionRefresh: string; tryAgain: string },
): string {
  if (
    error instanceof ApiError &&
    (error.status === 401 || error.status === 403)
  ) {
    return messages.sessionRefresh;
  }
  return messages.tryAgain;
}

export function buildTrackRowData(tracks: SearchTrack[]): TrackRowData[] {
  return tracks.map((track, index) =>
    toTrackRowData({
      ...track,
      globalTrackUid: trackGlobalUid(track) ?? undefined,
      id:
        track.id ??
        track.path ??
        track.artist + "-" + track.title + "-" + index,
      library_track_id:
        !trackGlobalUid(track) && typeof track.id === "number"
          ? track.id
          : undefined,
    }),
  );
}

export function toSearchPlayerTrack(track: SearchTrack): Track {
  return toPlayableTrack(
    {
      ...track,
      globalTrackUid: trackGlobalUid(track) ?? undefined,
      library_track_id:
        !trackGlobalUid(track) && typeof track.id === "number"
          ? track.id
          : undefined,
    },
    {
      cover: track.album ? trackAlbumCover(track) : undefined,
    },
  );
}
