import type { Track } from "@/contexts/player-types";
import { getTrackQualityBadge, type QualityBadge as QualityBadgeData } from "@/components/player/bar/player-bar-utils";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";

export interface AlbumPlaybackTrack {
  id: number;
  storage_id?: string;
  filename: string;
  format: string;
  bitrate: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  path: string;
  tags: {
    title: string;
  };
}

export interface AlbumPlaybackData {
  id: number;
  slug?: string;
  artist_id?: number;
  artist_slug?: string;
  artist: string;
  name: string;
  display_name: string;
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
  const cover = albumCoverApiUrl({
    albumId: data.id,
    albumSlug: data.slug,
    artistName: data.artist,
    albumName: data.name,
  }, { size: 512 });

  return data.tracks.map((track) => toPlayableTrack({
    id: track.id,
    storage_id: track.storage_id,
    title: track.tags.title || track.filename,
    artist: data.artist,
    artist_id: data.artist_id,
    artist_slug: data.artist_slug,
    album: data.display_name || data.name,
    album_id: data.id,
    album_slug: data.slug,
    path: track.path,
    library_track_id: track.id,
    format: track.format || undefined,
    bitrate: track.bitrate,
    sample_rate: track.sample_rate,
    bit_depth: track.bit_depth,
  }, { cover }));
}

export function buildAlbumQualityBadges(tracks: AlbumPlaybackTrack[]): QualityBadgeData[] {
  const byFormat = new Map<string, AlbumPlaybackTrack>();

  for (const track of tracks) {
    const format = (track.format || "").trim().toLowerCase();
    if (!format) continue;

    const current = byFormat.get(format);
    if (!current || scoreTrackQuality(track) > scoreTrackQuality(current)) {
      byFormat.set(format, track);
    }
  }

  return Array.from(byFormat.values())
    .map((track) => getTrackQualityBadge(toPlayableTrack({
      id: track.id,
      storage_id: track.storage_id,
      title: track.tags.title || track.filename,
      artist: "",
      path: track.path,
      format: track.format || undefined,
      bitrate: track.bitrate,
      sample_rate: track.sample_rate,
      bit_depth: track.bit_depth,
    })))
    .filter((badge): badge is QualityBadgeData => Boolean(badge));
}
