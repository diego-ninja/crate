import type { Track } from "@/contexts/player-types";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";

export interface RadioTrackPayload {
  track_id?: number | null;
  global_track_uid?: string | null;
  global_artist_uid?: string | null;
  global_album_uid?: string | null;
  track_entity_uid?: string | null;
  track_slug?: string | null;
  track_path?: string | null;
  title: string;
  artist: string;
  artist_id?: number | null;
  artist_entity_uid?: string | null;
  artist_slug?: string | null;
  album?: string | null;
  album_id?: number | null;
  album_entity_uid?: string | null;
  album_slug?: string | null;
  duration?: number | null;
  score?: number | null;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
}

export interface ShapedRadioTrack {
  track_id?: number | null;
  global_track_uid?: string | null;
  global_artist_uid?: string | null;
  global_album_uid?: string | null;
  entity_uid?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  album_id?: number | null;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  distance: number;
}

function radioTrackCover(payload: RadioTrackPayload): string | undefined {
  if (payload.album) {
    return (
      albumCoverApiUrl(
        {
          albumId: payload.album_id,
          albumEntityUid: payload.album_entity_uid,
          artistEntityUid: payload.artist_entity_uid,
          albumSlug: payload.album_slug,
          artistName: payload.artist,
          albumName: payload.album,
        },
        { size: 512 },
      ) ||
      artistPhotoApiUrl(
        {
          artistId: payload.artist_id,
          artistEntityUid: payload.artist_entity_uid,
          artistSlug: payload.artist_slug,
          artistName: payload.artist,
        },
        { size: 512 },
      ) ||
      undefined
    );
  }
  return (
    artistPhotoApiUrl(
      {
        artistId: payload.artist_id,
        artistEntityUid: payload.artist_entity_uid,
        artistSlug: payload.artist_slug,
        artistName: payload.artist,
      },
      { size: 512 },
    ) || undefined
  );
}

export function toRadioTrack(payload: RadioTrackPayload): Track {
  return toPlayableTrack(
    {
      ...payload,
      id:
        payload.track_id ??
        `radio:${payload.artist || "unknown"}:${payload.album || "unknown"}:${
          payload.title || "unknown"
        }`,
      path: payload.track_path,
      library_track_id: payload.track_id,
    },
    { cover: radioTrackCover(payload) },
  );
}

export function toShapedRadioTrack(track: ShapedRadioTrack): Track {
  return toPlayableTrack(
    {
      id: track.global_track_uid ?? track.track_id,
      global_track_uid: track.global_track_uid,
      global_artist_uid: track.global_artist_uid,
      global_album_uid: track.global_album_uid,
      entity_uid: track.entity_uid,
      title: track.title,
      artist: track.artist,
      album: track.album,
      album_id: track.album_id,
      library_track_id: track.track_id,
      bpm: track.bpm,
      audio_key: track.audio_key,
      audio_scale: track.audio_scale,
      energy: track.energy,
      danceability: track.danceability,
      valence: track.valence,
      bliss_vector: track.bliss_vector,
    },
    {
      cover: track.album_id
        ? albumCoverApiUrl({ albumId: track.album_id }, { size: 512 }) ||
          undefined
        : track.global_album_uid
          ? albumCoverApiUrl(
              { globalAlbumUid: track.global_album_uid },
              { size: 512 },
            ) || undefined
          : undefined,
    },
  );
}
