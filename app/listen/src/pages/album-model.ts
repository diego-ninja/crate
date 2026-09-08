import type { Track } from "@/contexts/player-types";
import {
  getTrackQualityBadge,
  type QualityBadge as QualityBadgeData,
} from "@/components/player/bar/player-bar-utils";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";

export interface AlbumPlaybackTrack {
  id: number | string;
  entity_uid?: string;
  globalTrackUid?: string;
  global_track_uid?: string;
  global_uid?: string;
  filename: string;
  format: string;
  bitrate: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  path?: string | null;
  is_available?: boolean;
  tags: {
    title: string;
  };
}

export interface AlbumPlaybackData {
  id?: number | null;
  entity_uid?: string;
  global_album_uid?: string;
  global_artist_uid?: string;
  global_uid?: string;
  slug?: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  artist: string;
  name: string;
  display_name: string;
  cover_url?: string | null;
  tracks: AlbumPlaybackTrack[];
}

function scoreTrackQuality(track: AlbumPlaybackTrack): number {
  return (
    (track.bit_depth || 0) * 1_000_000 +
    (track.sample_rate || 0) * 1_000 +
    (track.bitrate || 0)
  );
}

export function buildAlbumPlayerTracks(data: AlbumPlaybackData): Track[] {
  const globalAlbumUid = data.global_album_uid ?? data.global_uid;
  const localAlbumId =
    typeof data.id === "number" && data.id > 0 ? data.id : undefined;
  const cover =
    albumCoverApiUrl(
      {
        albumId: localAlbumId,
        globalAlbumUid,
        albumEntityUid: data.entity_uid,
        artistEntityUid: data.artist_entity_uid,
        albumSlug: data.slug,
        artistName: data.artist,
        albumName: data.name,
      },
      { size: 512 },
    ) ||
    data.cover_url ||
    undefined;

  return data.tracks.reduce<Track[]>((tracks, track) => {
    if (track.is_available === false) return tracks;
    tracks.push(
      toPlayableTrack(
        {
          id: track.id,
          globalTrackUid:
            track.globalTrackUid ?? track.global_track_uid ?? track.global_uid,
          global_artist_uid: data.global_artist_uid,
          global_album_uid: globalAlbumUid,
          entity_uid: track.entity_uid,
          title: track.tags.title || track.filename,
          artist: data.artist,
          artist_id: data.artist_id,
          artist_entity_uid: data.artist_entity_uid,
          artist_slug: data.artist_slug,
          album: data.display_name || data.name,
          album_id: localAlbumId,
          album_entity_uid: data.entity_uid,
          album_slug: data.slug,
          path: track.path,
          library_track_id:
            typeof track.id === "number" && track.id > 0 ? track.id : undefined,
          format: track.format || undefined,
          bitrate: track.bitrate,
          sample_rate: track.sample_rate,
          bit_depth: track.bit_depth,
          bpm: track.bpm,
          audio_key: track.audio_key,
          audio_scale: track.audio_scale,
          energy: track.energy,
          danceability: track.danceability,
          valence: track.valence,
          bliss_vector: track.bliss_vector,
        },
        { cover },
      ),
    );
    return tracks;
  }, []);
}

export function buildAlbumQualityBadges(
  tracks: AlbumPlaybackTrack[],
): QualityBadgeData[] {
  const byFormat = new Map<string, AlbumPlaybackTrack>();

  for (const track of tracks) {
    if (track.is_available === false) continue;
    const format = (track.format || "").trim().toLowerCase();
    if (!format) continue;

    const current = byFormat.get(format);
    if (!current || scoreTrackQuality(track) > scoreTrackQuality(current)) {
      byFormat.set(format, track);
    }
  }

  return Array.from(byFormat.values())
    .map((track) =>
      getTrackQualityBadge(
        toPlayableTrack({
          id: track.id,
          globalTrackUid:
            track.globalTrackUid ?? track.global_track_uid ?? track.global_uid,
          entity_uid: track.entity_uid,
          title: track.tags.title || track.filename,
          artist: "",
          path: track.path,
          format: track.format || undefined,
          bitrate: track.bitrate,
          sample_rate: track.sample_rate,
          bit_depth: track.bit_depth,
        }),
      ),
    )
    .filter((badge): badge is QualityBadgeData => Boolean(badge));
}
